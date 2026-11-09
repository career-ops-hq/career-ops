// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ADP Recruiting Management "myjobs" career-site provider. A single-company
// ATS adapter: configure it as a `tracked_companies:` entry, one per career
// site. Distinct from adp-workforcenow.mjs, which reads a different ADP
// product (workforcenow.adp.com). The myjobs sites are an Angular SPA at
//
//   https://myjobs.adp.com/{site}/cx/job-listing        (e.g. /apply/cx/..., ADP's own)
//   https://myjobs.adp.com/{site}/cx/job-details?reqId=...
//
// and auto-detect from any myjobs.adp.com URL whose first path segment is the
// career-site slug. The SPA calls a public, no-auth JSON API on the same host:
//
//   Site:   GET /public/staffing/v1/career-site/{site}
//             -> { orgoid, clientName, ... }   (the site slug -> orgoid lookup)
//   List:   GET /public/staffing/v1/job-requisitions?rb=CareerSite&$top=N&$skip=M
//             header `orgoid: {orgoid}` -> { count, jobRequisitions: [...] }
//   Detail: GET /public/staffing/v1/job-requisitions/{reqId}?rb=CareerSite&lang=en_US
//             -> { jobRequisitions: [{ jobDescription, postingDate, ... }] }
//
// ── orgoid ──────────────────────────────────────────────────────────────────
// Every list/detail call needs the tenant's `orgoid` header (a missing one is
// HTTP 400 "Missing orgoid header"). It is not in the careers URL, so by
// default it is resolved once from the site slug through the career-site
// endpoint above and kept in `ctx.idCache` between scans. To skip that lookup,
// or if the endpoint ever changes, set it on the entry:
//
//   adpMyjobs:
//     orgoid: 0F18AC8F6B800272
//
// ── Accept-Language ─────────────────────────────────────────────────────────
// The list endpoint filters on the request's Accept-Language. Node's fetch
// sends `Accept-Language: *`, which the API answers with a well-formed
// `{"count":0,"jobRequisitions":[]}` — a silent empty board, not an error. Every
// request therefore sends an explicit `Accept-Language: en-US`.
//
// ── Paging ──────────────────────────────────────────────────────────────────
// `$top` / `$skip` (zero-based row offset). `limit` / `offset` are silently
// ignored and return page one forever, so they are not used. The walk advances
// by rows actually returned and ends on an empty page, once `$skip` reaches the
// response's own `count`, or on a short page when no `count` was given. Both
// are bounded by DEFAULT_MAX_PAGES / MAX_PAGES_CAP regardless of what the API
// reports.
//
// The list payload has a title and locations but no date and no JD. Detail
// enrichment (description + postedAt) is opt-in per entry:
//
//   adpMyjobs:
//     fetchDetails: true   # one detail call per posting, paced
//     detailLimit: 25      # max detail calls per sweep when fetchDetails=true
//
// Some list rows carry no title at all (observed live: a `type: "Sourcing"`
// talent-pool pseudo-requisition). They are not postings and are dropped.

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { cachedLookup } from './_cached-lookup.mjs';
import { intInRange } from './_config-utils.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { coerceId } from './_ids.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const HOST = 'myjobs.adp.com';
const API_BASE = `https://${HOST}/public/staffing/v1`;

const PAGE_SIZE = 200; // verified live: $top=200 is honored
const DEFAULT_MAX_PAGES = 100; // 100 * 200 = 20000 postings; ADP's own site has ~1800
const MAX_PAGES_CAP = 1500;
const INTER_PAGE_DELAY_MS = 250;
const RETRY_POLICY = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

const SITE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ORGOID_RE = /^[A-Za-z0-9]{8,64}$/;
// First path segments on myjobs.adp.com that are API/static routes, not sites.
const RESERVED_SEGMENTS = new Set(['public', 'admin', 'myadp_prefix']);

/**
 * The career-site slug from a myjobs URL, or null. Only the hostname and the
 * first path segment are read; the rest of the URL is opaque.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveSite(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    if (parsed.hostname.toLowerCase() !== HOST) continue;
    const seg = parsed.pathname.split('/').filter(Boolean)[0];
    if (!seg || !SITE_RE.test(seg) || RESERVED_SEGMENTS.has(seg.toLowerCase())) continue;
    return seg;
  }
  return null;
}

/** @param {any} entry */
function parseConfig(entry) {
  const cfg = (entry && entry.adpMyjobs) || {};
  return {
    orgoid: typeof cfg.orgoid === 'string' && ORGOID_RE.test(cfg.orgoid.trim()) ? cfg.orgoid.trim() : null,
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, 25, 1, 100),
  };
}

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * @param {any} ctx
 * @param {string} site
 * @param {string | null} override
 * @returns {Promise<string>}
 */
async function resolveOrgoid(ctx, site, override) {
  if (override) return override;
  return cachedLookup(ctx?.idCache, site.toLowerCase(), async () => {
    const json = await fetchJsonWithRetry(
      ctx,
      `${API_BASE}/career-site/${encodeURIComponent(site)}`,
      { redirect: 'error', headers: { accept: 'application/json', 'accept-language': 'en-US' } },
      RETRY_POLICY,
    );
    const orgoid = typeof json?.orgoid === 'string' ? json.orgoid.trim() : '';
    if (!ORGOID_RE.test(orgoid)) {
      throw new Error(`adp-myjobs: could not resolve orgoid for career site "${site}" — set adpMyjobs.orgoid on this entry`);
    }
    return orgoid;
  }, {
    isValid: v => typeof v === 'string' && ORGOID_RE.test(v),
    // An unknown site slug answers 404/400/403: the board is gone, drop the cached id.
    isGone: err => err?.status === 404 || err?.status === 400,
  });
}

/** @param {string} orgoid */
function apiHeaders(orgoid) {
  return { accept: 'application/json', 'accept-language': 'en-US', orgoid };
}

/** @param {number} skip */
function buildListUrl(skip) {
  const u = new URL(`${API_BASE}/job-requisitions`);
  u.searchParams.set('rb', 'CareerSite');
  u.searchParams.set('$top', String(PAGE_SIZE));
  u.searchParams.set('$skip', String(skip));
  return u.href;
}

/** @param {string} reqId */
function buildDetailUrl(reqId) {
  const seg = safeEncodeURIComponent(reqId);
  if (seg === null) return null;
  const u = new URL(`${API_BASE}/job-requisitions/${seg}`);
  u.searchParams.set('rb', 'CareerSite');
  u.searchParams.set('lang', 'en_US');
  return u.href;
}

/**
 * Public posting page. `site` is config-derived and already validated by
 * SITE_RE; reqId is host-controlled and goes through URLSearchParams.
 * @param {string} site @param {string} reqId
 */
export function buildPostingUrl(site, reqId) {
  if (safeEncodeURIComponent(reqId) === null) return null;
  const u = new URL(`https://${HOST}/${encodeURIComponent(site)}/cx/job-details`);
  u.searchParams.set('rb', 'CareerSite');
  u.searchParams.set('reqId', reqId);
  return u.href;
}

// NaN-safe: `Date.parse(s) || undefined` would also null a valid epoch 0.
/** @param {unknown} value */
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * "City, ST, USA" from the structured address; the nameCode label ("Stamford
 * CT (1266 East Main St. - 17011)") is an internal site name and is only the
 * fallback. Multiple locations are deduped and joined with " / ".
 * @param {any} row
 */
export function extractLocation(row) {
  const list = Array.isArray(row?.requisitionLocations) ? row.requisitionLocations : [];
  const out = [];
  for (const loc of list) {
    const addr = loc?.address;
    const str = (/** @type {any} */ v) => (typeof v === 'string' ? v.trim() : '');
    const city = str(addr?.cityName);
    const sub = addr?.countrySubdivisionLevel1;
    const subCode = str(sub?.codeValue);
    const region = /^[A-Za-z]{2,3}$/.test(subCode) ? subCode : str(sub?.longName) || subCode;
    const country = str(addr?.country?.codeValue) || str(addr?.country?.longName);
    let label = [city, region, country].filter(Boolean).join(', ');
    if (!label) label = str(loc?.nameCode?.longName) || str(loc?.nameCode?.shortName);
    if (label && !out.includes(label)) out.push(label);
  }
  return out.join(' / ');
}

/**
 * Parse one list page. Throws on a body that is not the documented envelope;
 * a malformed row is dropped.
 * @param {any} json
 * @param {{ site: string, companyName: string }} cfg
 * @returns {{ jobs: Array<Record<string, any>>, total: number | null, rawCount: number }}
 */
export function parseListPage(json, cfg) {
  const rows = json && typeof json === 'object' && Array.isArray(json.jobRequisitions) ? json.jobRequisitions : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`adp-myjobs: unexpected response — expected jobRequisitions[], got: [${got}]`);
  }
  const total = Number.isInteger(json.count) && json.count >= 0 ? json.count : null;
  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const reqId = coerceId(row.reqId);
    const title = [row.jobTitle, row.publishedJobTitle, row.requisitionTitle]
      .find(t => typeof t === 'string' && t.trim());
    if (!reqId || !title) continue;
    const url = buildPostingUrl(cfg.site, reqId);
    if (!url) continue;
    /** @type {Record<string, any>} */
    const job = { title: title.trim(), url, company: cfg.companyName, location: extractLocation(row) };
    const requisitionId = coerceId(row.clientRequisitionID);
    if (requisitionId !== undefined) job.requisitionId = requisitionId;
    jobs.push(Object.assign(job, { _reqId: reqId }));
  }
  return { jobs, total, rawCount: rows.length };
}

/** @type {Provider} */
export default {
  id: 'adp-myjobs',

  detect(entry) {
    const site = resolveSite(entry);
    return site ? { url: buildListUrl(0) } : null;
  },

  async fetch(entry, ctx) {
    const site = resolveSite(entry);
    if (!site) throw new Error(`adp-myjobs: cannot derive the career-site slug (myjobs.adp.com/{site}/...) for ${entry.name}`);
    const { orgoid: override, fetchDetails, detailLimit } = parseConfig(entry);
    const orgoid = await resolveOrgoid(ctx, site, override);
    const headers = apiHeaders(orgoid);
    const cfg = { site, companyName: entry.name };

    const maxPages = resolveMaxPages(entry);
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pageLimit = Math.min(maxPages, ctxCap);

    /** @type {Array<Record<string, any>>} */
    const jobs = [];
    const seen = new Set();
    let skip = 0;
    let total = null;
    let hitCeiling = false; // ran out of page budget with a full page and more to read
    let repeatPages = 0; // consecutive pages that yielded no new reqId
    let sawRepeat = false; // a repeated page left a possible gap, even if later pages had new rows
    let stalled = false; // the API stopped advancing ($skip ignored) before the board's own end

    for (let page = 0; page < pageLimit; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const json = await fetchJsonWithRetry(ctx, buildListUrl(skip), { redirect: 'error', headers }, RETRY_POLICY);
      const { jobs: pageJobs, total: pageTotal, rawCount } = parseListPage(json, cfg);
      if (pageTotal !== null) total = pageTotal;
      if (rawCount === 0) break;

      let fresh = 0;
      for (const job of pageJobs) {
        if (seen.has(job._reqId)) continue;
        seen.add(job._reqId);
        fresh++;
        jobs.push(job);
      }
      skip += rawCount;
      // Every row on this page was a repeat: $skip is being ignored. Checked
      // before the count test, since a repeated page can push `skip` past
      // `count` without the board being complete. A short page with no count
      // is still a natural end.
      // One repeated page is tolerated (a later page may still carry new rows);
      // two in a row mean the API is not advancing.
      if (fresh === 0 && pageJobs.length > 0 && (total !== null || rawCount >= PAGE_SIZE)) {
        sawRepeat = true;
        if (++repeatPages >= 2) { stalled = true; break; }
      } else {
        repeatPages = 0;
      }
      // Natural end: the source's own count is reached, or (no count) a short page.
      // Reaching the count on a page that added nothing new is not completion.
      if (total !== null ? skip >= total : rawCount < PAGE_SIZE) {
        if (fresh === 0 && pageJobs.length > 0) stalled = true;
        break;
      }
      if (page === pageLimit - 1) hitCeiling = true;
    }

    const truncated = hitCeiling && ctxCap === Infinity;
    if (truncated) {
      console.error(`⚠️  adp-myjobs: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length}${total !== null ? ` of ${total}` : ''} jobs) — raise max_pages on this entry for more`);
    }

    // A stall is not a ceiling: never blame max_pages for it, but do not let a
    // partial board pass as complete either.
    const incomplete = stalled || sawRepeat;
    if (incomplete) {
      console.error(`⚠️  adp-myjobs: ${entry.name} incomplete — the API returned a page of only repeated rows (stopped at $skip=${skip}) (${jobs.length}${total !== null ? ` of ${total}` : ''} jobs); the board may be incomplete`);
    }

    // Detail enrichment is opt-in, paced, best-effort, and skipped while a
    // health probe runs (ctx.maxPages set).
    if (fetchDetails && ctxCap === Infinity) {
      for (const job of jobs.slice(0, detailLimit)) {
        const detailUrl = buildDetailUrl(job._reqId);
        if (!detailUrl) continue;
        await sleep(INTER_PAGE_DELAY_MS, ctx);
        try {
          const detail = await fetchJsonWithRetry(ctx, detailUrl, { redirect: 'error', headers }, RETRY_POLICY);
          const d = Array.isArray(detail?.jobRequisitions) ? detail.jobRequisitions[0] : null;
          const description = htmlToText([d?.jobDescription, d?.jobQualifications].filter(Boolean).join('\n'));
          if (description) job.description = description;
          const postedAt = toEpochMs(d?.postingDate);
          if (postedAt !== undefined) job.postedAt = postedAt;
        } catch {
          // enrichment only — keep the listing row (same contract as smartrecruiters.mjs)
        }
      }
    }

    const result = jobs.map(({ _reqId, ...job }) => job);
    if (truncated || incomplete) /** @type {any} */ (result).adpMyjobsTruncated = true;
    return /** @type {any} */ (result);
  },
};
