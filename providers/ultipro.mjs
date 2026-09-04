// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// UKG Pro / UltiPro Recruiting provider — hits the public, no-auth "JobBoard"
// search API behind a tenant's public job board. A single-company ATS
// adapter: configure it as a `tracked_companies:` entry, one per tenant.
// Auto-detects from careers_url pattern
// `https://{host}/{tenant}/JobBoard/{boardId}/...`
// where {host} is one of several UKG-owned recruiting hosts a tenant's board
// may live on (`recruiting.ultipro.ca`, `recruiting.ultipro.com`,
// `recruiting2.ultipro.com`, `recruiting3.ultipro.com`, possibly others not
// yet observed) — see HOST_RE below.
//
//   List:   POST {origin}/{tenant}/JobBoard/{boardId}/JobBoardView/LoadSearchResults
//   Detail: GET  {origin}/{tenant}/JobBoard/{boardId}/OpportunityDetail?opportunityId={Id}
//
// Pagination is a plain Top/Skip row offset (Top=50, Skip starts at 0,
// advances by Top each page) — stop once the returned array is empty,
// shorter than Top, or Skip + count reaches the response's own `totalCount`.
// A dedicated page-count safety cap applies independently of `totalCount`
// (ADDING_A_PROVIDER.md, "Absolute page ceiling") — a tenant that still has
// postings left when the cap is hit is flagged incomplete, not silently
// reported as done.
//
// ── Host handling (do not "fix" this) ───────────────────────────────────────
// UKG Pro public boards are NOT all on one canonical host. The origin this
// provider talks to is whichever host the tenant's own board URL actually
// uses, preserved verbatim — never rewritten to a single canonical TLD/host.
// HOST_RE is an allowlist PATTERN (recruiting[N].ultipro.{com,ca}), not a
// fixed string-equality check: a fixed check against exactly
// "recruiting.ultipro.com" would incorrectly reject the `.ca` tenants and any
// numbered host (recruiting2/recruiting3) — a known bug in at least one other
// open-source UKG client, reproduced here as a regex test instead of `===`.
//
// ── The detail page is not JSON ─────────────────────────────────────────────
// The full JD lives in the detail page's HTML, inside a `<script>` block as
// `new US.Opportunity.CandidateOpportunityDetail({...})`. That object is
// extracted with a string-aware brace-balancing walk (see
// extractCandidateOpportunityDetail below) — real JD text routinely contains
// unescaped-looking braces/quotes inside JSON string values, which a naive
// regex extraction breaks on.
//
// An invalid/expired opportunityId answers HTTP 200 with an empty app-shell
// page (no CandidateOpportunityDetail( marker at all) rather than a 404 —
// extractCandidateOpportunityDetail reports that as status:'not-found', which
// callers must NOT treat as "zero-content but successful".
//
// The list payload does not carry the full JD (only a brief description), so
// — mirroring smartrecruiters.mjs/vdab.mjs — full-JD
// enrichment is opt-in per tracked_companies entry:
//
//   ultipro:
//     fetchDetails: true   # fetch each posting's detail page for a full description
//     detailLimit: 25      # max detail calls per sweep when fetchDetails=true

import { fetchJsonWithRetry, fetchTextWithRetry, sleep } from './_http.mjs';
import { intInRange } from './_config-utils.mjs';
import { htmlToText } from './_html-to-text.mjs';

// Allowlist PATTERN, not a fixed host string — see the header comment above
// for why a fixed `=== 'recruiting.ultipro.com'` check is wrong here. `\d*`
// (zero or more digits) covers the bare host and any numbered variant
// (recruiting2, recruiting3, ...) without hardcoding a finite list of them.
const HOST_RE = /^recruiting\d*\.ultipro\.(?:com|ca)$/i;

// A careers/job-board page or the list API itself:
// `https://{host}/{tenant}/JobBoard/{boardId}/...`. `tenant` and `boardId`
// are taken verbatim from the URL's own path segments — no decode/re-encode
// round trip, so whatever percent-encoding the tenant's own URL already used
// is preserved exactly.
const PATH_RE = /^\/([^/]+)\/JobBoard\/([^/]+)(?:\/|$)/;

const PAGE_SIZE = 50; // Top, per the spec'd LoadSearchResults request shape.

// Safety cap on pagination, independent of what the API reports as
// totalCount — a tampered/misbehaving response must not turn one
// portals.yml line into an unbounded request loop (ADDING_A_PROVIDER.md,
// "Absolute page ceiling"). Override with max_pages on the entry for a
// tenant that genuinely has more postings than this covers.
const DEFAULT_MAX_PAGES = 100; // 100 * 50 = 5000 postings
const MAX_PAGES_CAP = 1500; // hard ceiling even for an explicit override

// Retry policy for transient list/detail failures (429, 5xx, timeouts/aborts).
// No rate-limit behavior has been characterized for this API beyond what's in
// the issue — the default shared policy (2 retries) is conservative enough
// without inventing tuning this provider has no evidence for (same reasoning
// getro.mjs used). Values below are identical to withRetry's own default and
// passed explicitly on purpose, as documentation of that choice — not a
// different cadence like workday.mjs/oraclecloud.mjs's WAF-fronted override.
const RETRY_POLICY = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

// Delay between successive LIST pages within one tenant's pagination loop,
// and between successive per-posting detail fetches. Same rationale as
// workday.mjs's INTER_PAGE_DELAY_MS: a burst of same-host requests with zero
// delay risks tripping a rate limiter on any tenant deep enough to paginate.
const INTER_PAGE_DELAY_MS = 250;

/**
 * Resolve {origin, tenant, boardId} from an entry, honouring an explicit
 * `api:` URL over `careers_url` (mirrors greenhouse/workday).
 * `origin` is built from the URL's OWN hostname — never normalized to a
 * canonical host — so the tenant keeps whichever recruiting host it actually
 * uses.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{ origin: string, tenant: string, boardId: string } | null}
 */
function resolveTenant(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    if (!HOST_RE.test(parsed.hostname)) continue;
    const m = parsed.pathname.match(PATH_RE);
    if (!m) continue;
    const [, tenant, boardId] = m;
    if (!tenant || !boardId) continue;
    return { origin: `https://${parsed.hostname}`, tenant, boardId };
  }
  return null;
}

/** @param {string} url */
function assertUltiproUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`ultipro: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`ultipro: URL must use HTTPS: ${url}`);
  if (!HOST_RE.test(parsed.hostname)) {
    throw new Error(`ultipro: untrusted hostname "${parsed.hostname}" — must match recruiting[N].ultipro.com/.ca`);
  }
  return url;
}

/**
 * `opportunityId` is host-controlled (it comes back off the API response, not
 * out of portals.yml) and becomes a URL query-value here — encodeURIComponent
 * throws a URIError on a lone UTF-16 surrogate, which would otherwise abort
 * an entire batch of detail fetches over one bad record. This codebase's
 * shared `_safe-url.mjs` helper (documented in ADDING_A_PROVIDER.md) isn't
 * present in this checkout, so the same fail-safe behavior — return null,
 * drop just that one job/detail-fetch, never throw out of a loop — is
 * reproduced locally.
 * @param {string} s
 * @returns {string | null}
 */
function encodeSegment(s) {
  try {
    return encodeURIComponent(s);
  } catch {
    return null;
  }
}

/** @param {string} origin @param {string} tenant @param {string} boardId */
function buildListUrl(origin, tenant, boardId) {
  return `${origin}/${tenant}/JobBoard/${boardId}/JobBoardView/LoadSearchResults`;
}

/** @param {string} origin @param {string} tenant @param {string} boardId @param {string} opportunityId */
function buildDetailUrl(origin, tenant, boardId, opportunityId) {
  const seg = encodeSegment(opportunityId);
  if (seg === null) return null;
  return `${origin}/${tenant}/JobBoard/${boardId}/OpportunityDetail?opportunityId=${seg}`;
}

/** @param {number} skip @param {number} top */
function buildListBody(skip, top) {
  return {
    opportunitySearch: {
      Top: top,
      Skip: skip,
      QueryString: '',
      OrderBy: [{ Value: 'postedDateDesc', PropertyName: 'PostedDate', Ascending: false }],
      Filters: [],
    },
    matchCriteria: {
      PreferredJobs: [],
      Educations: [],
      LicenseAndCertifications: [],
      Skills: [],
      hasNoLicenses: false,
      SkippedSkills: [],
    },
  };
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
/** @param {unknown} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * `Locations` on a list-page opportunity is an array of location objects —
 * verified live (several YMCA of Greater Toronto postings, 2026-09):
 * `{ LocalizedName, Address: { City, State: { Code }, Country: { Code } } }`.
 * Prefers "City, StateCode" (matches the convention other providers use —
 * workday.mjs — for a filterable location string) and
 * falls back to `LocalizedName` (a site/branch name, not a city) only when
 * the structured address is absent — some tenants may omit it. A bare string
 * element is also accepted defensively, since nothing in the spec rules it
 * out for every tenant. Deduped and joined with " / ", same convention as
 * csod.mjs / successfactors.mjs.
 * @param {any} locations
 */
export function extractLocations(locations) {
  if (!Array.isArray(locations)) return '';
  const out = [];
  for (const loc of locations) {
    let label = '';
    if (typeof loc === 'string') {
      label = loc.trim();
    } else if (loc && typeof loc === 'object') {
      const city = String(loc.Address?.City || '').trim();
      const state = String(loc.Address?.State?.Code || '').trim();
      label = [city, state].filter(Boolean).join(', ');
      if (!label) label = String(loc.LocalizedName || '').trim();
    }
    if (label && !out.includes(label)) out.push(label);
  }
  return out.join(' / ');
}

/**
 * Parse one `LoadSearchResults` list-page response into raw job rows.
 *
 * UKG returns `{ opportunities: [...], totalCount }`. A row missing a usable
 * `Id` or `Title` is dropped (both required — Id is the dedup/detail key, and
 * a blank job.url would collapse distinct postings — same discipline as
 * bamboohr.mjs's id/name filter). `Id` may come back as a string or a number
 * depending on tenant; normalized to a trimmed string either way.
 *
 * @param {any} json
 * @param {{ origin: string, tenant: string, boardId: string, companyName: string }} cfg
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string, postedAt?: number, description?: string}>, total: number | null, raw: any[] }}
 */
export function parseListPage(json, cfg) {
  const raw = Array.isArray(json?.opportunities) ? json.opportunities : [];
  const total = typeof json?.totalCount === 'number' ? json.totalCount : null;
  const jobs = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.Id === 'number' ? String(item.Id) : (typeof item.Id === 'string' ? item.Id.trim() : '');
    const title = typeof item.Title === 'string' ? item.Title.trim() : '';
    if (!id || !title) continue;
    const seg = encodeSegment(id);
    if (seg === null) continue; // a lone-surrogate id — drop just this one posting
    const url = `${cfg.origin}/${cfg.tenant}/JobBoard/${cfg.boardId}/OpportunityDetail?opportunityId=${seg}`;
    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number, description?: string}} */
    const row = {
      title,
      url,
      company: cfg.companyName,
      location: extractLocations(item.Locations),
    };
    const postedAt = toEpochMs(item.PostedDate);
    if (postedAt !== undefined) row.postedAt = postedAt;
    const description = htmlToText(item.BriefDescription);
    if (description) row.description = description;
    jobs.push(Object.assign(row, { _id: id }));
  }
  return { jobs, total, raw };
}

/**
 * Extract the `CandidateOpportunityDetail({...})` JSON object embedded in an
 * OpportunityDetail page's HTML.
 *
 * A regex over the raw HTML would break the moment the JD text itself
 * contains an unescaped-looking `{`/`}`/`"` — real job descriptions do this
 * routinely. This instead walks the string char-by-char from the first `{`
 * after the marker, tracking whether it is currently inside a JSON string
 * value (and whether the next char is escaped) so quotes/braces INSIDE
 * string values never affect the brace-depth count. Depth returning to 0
 * marks the end of the object, which is then parsed with `JSON.parse`.
 *
 * An invalid/expired `opportunityId` answers HTTP 200 with an empty app-shell
 * page — no marker present at all — which is reported as `status:
 * 'not-found'`, distinct from a real parse/shape failure (which throws). A
 * caller must not conflate the two: 'not-found' means "this posting is gone",
 * a throw means "the page changed shape and this needs attention".
 *
 * @param {string} html
 * @param {string | number} expectedId
 * @returns {{ status: 'not-found' } | { status: 'ok', detail: any }}
 */
export function extractCandidateOpportunityDetail(html, expectedId) {
  if (typeof html !== 'string' || !html) return { status: 'not-found' };
  const marker = 'CandidateOpportunityDetail(';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return { status: 'not-found' };
  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) throw new Error('ultipro: detail marker has no JSON object');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        let detail;
        try {
          detail = JSON.parse(html.slice(start, i + 1));
        } catch (err) {
          throw new Error(`ultipro: malformed detail JSON — ${/** @type {Error} */ (err).message}`);
        }
        if (!detail || !detail.Id || !detail.Title) {
          throw new Error('ultipro: malformed UKG detail — missing Id/Title');
        }
        if (String(detail.Id) !== String(expectedId)) {
          throw new Error(`ultipro: detail ID mismatch — expected ${expectedId}, got ${detail.Id}`);
        }
        return { status: 'ok', detail };
      }
    }
  }
  throw new Error('ultipro: unbalanced detail JSON');
}

/** @param {any} entry */
function parseUltiproConfig(entry) {
  const cfg = (entry && entry.ultipro) || {};
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, 25, 1, 100),
  };
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'ultipro',

  detect(entry) {
    const tenant = resolveTenant(entry);
    return tenant ? { url: buildListUrl(tenant.origin, tenant.tenant, tenant.boardId) } : null;
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) throw new Error(`ultipro: cannot derive tenant/boardId for ${entry.name}`);
    const { origin, tenant: tenantId, boardId } = tenant;
    const cfg = { origin, tenant: tenantId, boardId, companyName: entry.name };
    const listUrl = assertUltiproUrl(buildListUrl(origin, tenantId, boardId));

    const maxPages = resolveMaxPages(entry);
    // verify-portals' liveness probe sets ctx.maxPages — cooperate the same
    // way workday.mjs does, so the probe costs one request.
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pageLimit = Math.min(maxPages, ctxCap);

    const jobs = [];
    const seen = new Set();
    let skip = 0;
    let total = null;
    // True only when the walk stopped because it ran out of page budget with
    // known postings still unreached — the difference between "this is the
    // whole board" and "this is as much of it as the cap allowed" (never set
    // while ctxCap is finite: a probe's single-page cap is expected, not an
    // incomplete-board condition).
    let cappedIncomplete = false;

    for (let page = 0; page < pageLimit; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const body = JSON.stringify(buildListBody(skip, PAGE_SIZE));
      const json = await fetchJsonWithRetry(ctx, listUrl, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
      }, RETRY_POLICY);

      // The endpoint documents an `opportunities` array plus a `totalCount` —
      // a response with neither is not "zero postings", it's a shape we don't
      // recognize (surface it loudly rather than silently reporting an empty
      // board forever).
      if (json && typeof json === 'object' && !Array.isArray(json.opportunities) && json.totalCount === undefined) {
        throw new Error(`ultipro: unrecognized LoadSearchResults response for ${entry.name} — keys: ${Object.keys(json).join(', ') || '(none)'}`);
      }

      const { jobs: pageJobs, total: pageTotal, raw } = parseListPage(json, cfg);
      if (pageTotal !== null) total = pageTotal;

      // An empty page — whether "no rows at all" or "every row on this page
      // was unusable" — is the pagination stop condition either way; a
      // response that never advances would otherwise loop until pageLimit.
      if (raw.length === 0) break;

      for (const job of pageJobs) {
        const { _id, ...clean } = /** @type {any} */ (job);
        if (seen.has(_id)) continue;
        seen.add(_id);
        jobs.push(Object.assign(clean, { _id }));
      }

      const shortPage = raw.length < PAGE_SIZE;
      const reachedTotal = total !== null && skip + raw.length >= total;
      if (shortPage || reachedTotal) break;

      skip += PAGE_SIZE;

      // This was the last iteration the for-loop will run — if the board
      // still has more (or an unknown amount) left, the cap truncated it.
      if (page === pageLimit - 1) cappedIncomplete = true;
    }

    const truncated = cappedIncomplete && ctxCap === Infinity;
    if (truncated) {
      const jobsSummary = `${jobs.length}${total !== null ? ` of ${total}` : ''} jobs`;
      console.error(`⚠️  ultipro: ${entry.name} truncated at max_pages=${maxPages} (${jobsSummary}) — raise max_pages on this entry for more`);
    }

    // Detail enrichment answers "what does this job say", not "is this
    // endpoint alive" — skip it entirely while a health probe is running
    // (ctx.maxPages set), same rule as smartrecruiters.mjs/vdab.mjs.
    const { fetchDetails, detailLimit } = parseUltiproConfig(entry);
    const probing = ctxCap !== Infinity;
    if (fetchDetails && !probing) {
      const targets = jobs.slice(0, detailLimit);
      // Sequential, not batched/concurrent — no rate-limit behavior has been
      // characterized for this API, so this stays as conservative as
      // vdab.mjs's/smartrecruiters.mjs's detail loop until real data says otherwise.
      for (const job of /** @type {any[]} */ (targets)) {
        await sleep(INTER_PAGE_DELAY_MS, ctx);
        try {
          const detailUrl = buildDetailUrl(origin, tenantId, boardId, job._id);
          if (!detailUrl) continue; // lone-surrogate id — skip this one detail fetch
          assertUltiproUrl(detailUrl);
          const html = await fetchTextWithRetry(ctx, detailUrl, { redirect: 'error' }, RETRY_POLICY);
          const result = extractCandidateOpportunityDetail(html, job._id);
          // 'not-found' means the posting expired/was pulled between the list
          // fetch and now — keep the listing row as-is, do NOT treat the
          // empty page as a successful "no description" result.
          if (result.status !== 'ok') continue;
          const description = htmlToText(result.detail.Description);
          if (description) job.description = description;
        } catch {
          // Detail fetch is an enrichment only — keep the listing result
          // (same fail-open contract as vdab.mjs/smartrecruiters.mjs).
        }
      }
    }

    // _id drove dedup/detail lookups above; it's internal plumbing and must
    // not leak into the pipeline's Job rows (mirrors vdab.mjs).
    const result = jobs.map(({ _id, ...job }) => job);
    // The tag lives on the returned array (mirrors workday.mjs's
    // workdayTruncated / workdayNoDateSkip pattern) — re-applied here because
    // .map() above produces a fresh array that wouldn't otherwise carry it.
    if (truncated) /** @type {any} */ (result).ultiproTruncated = true;
    return result;
  },
};
