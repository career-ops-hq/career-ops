// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ApplicantPro provider (now branded "isolved Talent Acquisition").
// Target list: `tracked_companies:` — one entry per employer tenant at
// `<tenant>.applicantpro.com`. A single-company ATS adapter: there is no
// public directory of tenants to enumerate, so users list the tenants they
// want, and a tenant that also runs a second subdomain gets a second entry.
//
// robots.txt on a tenant host disallows only /admin/, /stats/ and the
// /internaljobs* routes; the listing page, `/core/jobs/…`, the detail pages
// and the sitemap are all open to `User-agent: *`.
//
// ── How the list is read (and why not the sitemap) ──
//
// `https://<tenant>.applicantpro.com/job_site_map.xml` lists every open
// posting, but only as `https://www.applicantpro.com/openings/<tenant>/jobs/<id>`
// plus `<lastmod>` — no titles, and those URLs 302 to the tenant host (this
// layer never follows redirects). Titling N postings from the sitemap costs N
// detail requests per scan. The `/jobs/` listing page itself is a client-side
// Vue component, so its HTML holds no postings either. But that component
// fills itself from one public, unauthenticated JSON request on the same host:
//
//   GET https://<tenant>.applicantpro.com/core/jobs/<domainId>?getParams={}
//
// which returns the tenant's whole open inventory in one response (title,
// id, location, posting date, pay range, …); `jobCount` equals the row count.
// So a scan is two requests: one for `<domainId>` (the numeric site id the
// component is given inline on `/jobs/`; cached in `ctx.idCache` after the
// first scan, or pinned with `applicantpro: { domainId }`) and one for the
// list. The same JSON shape is what `providers/prevueaps.mjs` reads on a
// white-label sibling of this platform.
//
// Opt-in `applicantpro: { fetchDetails: true, detailLimit: N }` additionally
// fetches each posting's server-rendered page (capped at `detailLimit`,
// default 25, max 100; sequential and paced) for the JSON-LD `JobPosting`
// description. That is the only per-posting request fan-out and it is off by
// default and skipped while a health probe runs.
//
// Gotchas, all from live observation of the JSON-LD / list data:
//   - `validThrough` can sit years in the future, so it is never used to
//     decide whether a posting is open — presence in the list is the signal.
//   - `employmentType` can be wrong (a permanent management posting tagged
//     CONTRACTOR), so it is not mapped to anything.
//   - the JSON-LD title is the posting's title and wins over the list title
//     on enrichment; the body text is left untouched even when it disagrees.
//   - pay is attached as `salary` only for an annual range with a positive
//     figure; hourly or missing ranges are left off, never inferred.
//   - `identifier` in the JSON-LD carries the POSTING id, so no
//     `requisitionId` is set (the payload has no employer requisition field);
//     the posting id goes to `externalId`.

import { cachedLookup } from './_cached-lookup.mjs';
import { intInRange } from './_config-utils.mjs';
import { coerceId } from './_ids.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchJsonWithRetry, fetchTextWithRetry, sleep } from './_http.mjs';
import { compensationPeriod, parseAmount } from './_salary-text.mjs';

const HOST_RE = /^[a-z0-9][a-z0-9-]*\.applicantpro\.com$/;
// Platform hosts that are not employer tenants.
const NON_TENANT_LABELS = new Set(['www', 'feeds']);
const TENANT_RE = /^[a-z0-9][a-z0-9-]*$/;
const DETAIL_DEFAULT_LIMIT = 25;
const DETAIL_MAX_LIMIT = 100;
// Courtesy pause between back-to-back detail pages on the same tenant.
const DETAIL_PACE_MS = 250;

/**
 * Tenant origin (`https://<tenant>.applicantpro.com`) from an entry. Only the
 * hostname is trusted: the origin is rebuilt from it, so any path or port on
 * the input is discarded. A `www.applicantpro.com/openings/<tenant>/…` link
 * (what the tenant's sitemap and aggregators hand out) maps to its tenant.
 * @param {any} entry
 * @returns {string | null}
 */
function resolveOrigin(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let parsed;
    try { parsed = new URL(raw.trim()); } catch { continue; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
    const host = parsed.hostname.toLowerCase();
    if (host === 'www.applicantpro.com') {
      const tenant = parsed.pathname.match(/^\/openings\/([^/]+)(?:\/|$)/i)?.[1]?.toLowerCase();
      if (tenant && TENANT_RE.test(tenant) && !NON_TENANT_LABELS.has(tenant)) {
        return `https://${tenant}.applicantpro.com`;
      }
      continue;
    }
    if (!HOST_RE.test(host) || NON_TENANT_LABELS.has(host.split('.')[0])) continue;
    return `https://${host}`;
  }
  return null;
}

/**
 * Numeric site id from a tenant's `/jobs/` page. The listing component is
 * handed it inline (`organizationId : 1, domainId : 2, getParams : …`); the
 * case-sensitive lookbehind keeps `rootDomainId` (a different number, used by
 * the social widget further down the page) from matching.
 * @param {unknown} html
 * @returns {number | null}
 */
export function extractDomainId(html) {
  if (typeof html !== 'string' || !html) return null;
  const match = html.match(/(?<![A-Za-z0-9_])domainId["']?\s*[:=]\s*["']?(\d+)/)
    || html.match(/\/core\/jobs\/(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** @param {any} entry @param {string} origin @param {any} ctx */
async function resolveDomainId(entry, origin, ctx) {
  const pinned = entry?.applicantpro?.domainId;
  if (Number.isSafeInteger(pinned) && pinned > 0) return pinned;
  const host = new URL(origin).hostname;
  return cachedLookup(ctx?.idCache, host, async () => {
    const html = await fetchTextWithRetry(ctx, `${origin}/jobs/`, { redirect: 'error' });
    const id = extractDomainId(html);
    if (id === null) throw new Error(`applicantpro: could not find the site id on ${origin}/jobs/`);
    return id;
  }, {
    isValid: (v) => Number.isSafeInteger(v) && v > 0,
    isGone: (err) => err?.status === 404 || err?.status === 410,
  });
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  // The list gives "Sep 02, 2026" and the JSON-LD "2026-09-02 00:00:00", both
  // calendar dates with no zone: read them as UTC so the day does not depend
  // on the machine's timezone.
  const text = value.trim();
  const parsed = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text} UTC`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {any} row */
function locationOf(row) {
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  if (text(row.jobLocation)) return text(row.jobLocation);
  return [text(row.city), text(row.abbreviation) || text(row.stateName)].filter(Boolean).join(', ');
}

/** Annual pay range only; hourly, per-period or zero/missing figures are left off. @param {any} row */
function salaryOf(row) {
  if (compensationPeriod(row.payTypeFrame) !== 'annual') return undefined;
  const lo = parseAmount(row.minSalary);
  const hi = parseAmount(row.maxSalary);
  const min = lo && lo.min > 0 ? lo.min : undefined;
  const max = hi && hi.max > 0 ? hi.max : undefined;
  if (min === undefined && max === undefined) return undefined;
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

/**
 * Normalize a `/core/jobs/<domainId>` response. Exported for unit tests.
 *
 * Shape: `{ success: true, data: { jobs: [{ id, title, jobLocation, city,
 * abbreviation, startDateRef, minSalary, maxSalary, payTypeFrame, … }],
 * jobCount } }`. A tenant with no openings answers `jobs: []`. Anything else
 * (no `data.jobs` array, `success: false`) is an API change and throws; one
 * malformed row is dropped.
 * @param {any} json
 * @param {string} origin
 * @param {string} companyName
 */
export function parseListResponse(json, origin, companyName) {
  const rows = json && json.success !== false && Array.isArray(json?.data?.jobs) ? json.data.jobs : null;
  if (!rows) {
    const got = json && typeof json === 'object'
      ? Object.keys(json.data && typeof json.data === 'object' ? json.data : json).join(', ')
      : typeof json;
    throw new Error(`applicantpro: unexpected response — expected data.jobs[], got: [${got}]`);
  }
  const jobs = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = coerceId(row.id);
    const title = typeof row.title === 'string' ? row.title.replace(/\s+/g, ' ').trim() : '';
    // The id becomes a URL path segment: digits only, so nothing host
    // controlled can add a path, query or lone surrogate to the dedup key.
    if (!title || !id || !/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const postedAt = toEpochMs(row.startDateRef);
    const salary = salaryOf(row);
    jobs.push({
      title,
      url: `${origin}/jobs/${id}`,
      company: companyName,
      location: locationOf(row),
      externalId: id,
      ...(postedAt !== undefined ? { postedAt } : {}),
      ...(salary ? { salary } : {}),
    });
  }
  return jobs;
}

/** @param {any} value @returns {any[]} */
function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== 'object') return [];
  return [value, ...flattenJsonLd(value['@graph'])];
}

/**
 * Title, description and posted date from a detail page's `JobPosting`
 * JSON-LD. `validThrough`, `employmentType` and `baseSalary` are deliberately
 * not read (see the header). Exported for unit tests.
 * @param {unknown} html
 * @returns {{ title?: string, description?: string, postedAt?: number, location?: string }}
 */
export function parseDetail(html) {
  if (typeof html !== 'string') return {};
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let parsed;
    try { parsed = JSON.parse(match[1]); } catch { continue; }
    const node = flattenJsonLd(parsed).find((item) => {
      const type = item?.['@type'];
      return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
    });
    if (!node) continue;
    const title = typeof node.title === 'string' ? node.title.replace(/\s+/g, ' ').trim() : '';
    const description = htmlToText(typeof node.description === 'string' ? node.description : '');
    const postedAt = toEpochMs(node.datePosted);
    const places = Array.isArray(node.jobLocation) ? node.jobLocation : [node.jobLocation];
    const address = places.find((p) => p?.address)?.address || {};
    const location = [address.addressLocality, address.addressRegion]
      .filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()).join(', ');
    return {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(postedAt !== undefined ? { postedAt } : {}),
      ...(location ? { location } : {}),
    };
  }
  return {};
}

/** @param {any} entry */
function parseConfig(entry) {
  const cfg = entry?.applicantpro || {};
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, DETAIL_DEFAULT_LIMIT, 1, DETAIL_MAX_LIMIT),
  };
}

/** @type {Provider} */
export default {
  id: 'applicantpro',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/jobs/` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`applicantpro: cannot derive an <tenant>.applicantpro.com origin for ${entry?.name}`);
    const domainId = await resolveDomainId(entry, origin, ctx);
    // `getParams` is the listing's filter object, sent as JSON; `{}` is "no
    // filter" and returns the full public inventory.
    const listUrl = `${origin}/core/jobs/${domainId}?getParams=${encodeURIComponent('{}')}`;
    const json = await fetchJsonWithRetry(ctx, listUrl, { redirect: 'error' });
    const jobs = parseListResponse(json, origin, String(entry?.name || ''));

    const reported = Number(json?.data?.jobCount);
    if (Number.isFinite(reported) && reported > (json?.data?.jobs?.length ?? 0)) {
      console.error(`⚠️  applicantpro: ${entry?.name} returned ${json.data.jobs.length} of ${reported} postings — the list may be incomplete`);
    }

    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const { fetchDetails, detailLimit } = parseConfig(entry);
    if (!fetchDetails || probing) return jobs;

    const targets = jobs.slice(0, detailLimit);
    for (let i = 0; i < targets.length; i++) {
      if (i > 0) await sleep(DETAIL_PACE_MS, ctx);
      const job = targets[i];
      try {
        const html = await fetchTextWithRetry(ctx, job.url, { redirect: 'error' });
        const detail = parseDetail(html);
        if (detail.title) job.title = detail.title;
        if (detail.description) job.description = detail.description;
        if (job.postedAt === undefined && detail.postedAt !== undefined) job.postedAt = detail.postedAt;
        if (!job.location && detail.location) job.location = detail.location;
      } catch { /* optional enrichment: keep the list row */ }
    }
    return jobs;
  },
};
