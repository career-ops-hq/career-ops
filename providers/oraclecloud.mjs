// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Oracle Recruiting Cloud (ORC) / Fusion Candidate Experience provider — hits
// the public recruitingCEJobRequisitions REST API (zero-auth, GET). Large
// employers (JPMorgan Chase, Oracle, BNY Mellon, American Express, Honeywell, …)
// run their careers site on ORC.
//
// Host patterns (per-tenant, dynamic):
//   <tenant>.fa.oraclecloud.com
//   <tenant>.fa.<region>.oraclecloud.com   (e.g. us2)
//   <tenant>.fa.ocs.oraclecloud.com
//
// Career page URL:
//   https://<host>/hcmUI/CandidateExperience/<lang>/sites/<siteNumber>/jobs
//   siteNumber is the segment after `sites/` (usually CX_1, CX_1002, …; default CX_1).
//
// JSON API (GET, zero-auth, no token/cookie):
//   https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions
//   ?onlyData=true
//   &expand=requisitionList.workLocation,requisitionList.secondaryLocations
//   &finder=findReqs;siteNumber=<site>,facetsList=...,limit=<n>,sortBy=POSTING_DATES_DESC,offset=<n>
//   &limit=<n>&offset=<n>   (set in BOTH finder and top-level — some tenants only honor one)
//   Optional: locationId=<numericId> (some tenants, e.g. BNY/Amex, need it to scope results).
//   The `expand` is REQUIRED: without it the API returns TotalJobsCount but an
//   empty/absent requisitionList (verified live against JPMC).
//   Response: items[0].requisitionList[] (jobs), items[0].TotalJobsCount (total),
//   top-level hasMore. Per item: Id, Title, PostedDate, PrimaryLocation,
//   WorkplaceTypeCode, ShortDescriptionStr, and (sometimes) ExternalURL.
//
// Known limitation: some tenants front the API with a WAF (e.g. Imperva) that
// 403s datacenter/cloud egress IPs. That's an environment/IP issue, not a
// provider bug — the same request succeeds from a residential IP. A browser-like
// User-Agent is sent to reduce (not eliminate) WAF friction.

import { decodeEntities } from './_html-entities.mjs';

const ORACLE_HOST_RE = /^[a-z0-9-]+\.fa\.(?:[a-z0-9-]+\.)?(?:ocs\.)?oraclecloud\.com$/i;

const PAGE_SIZE = 200;
const MAX_PAGES = 25;             // safety cap (~5000 jobs); hard ceiling like workday
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;
const INTER_PAGE_DELAY_MS = 150;  // WAF-aware spacing between same-host pages

// Browser-like UA reduces WAF friction; ORC's requisitions API needs no auth.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// facetsList is a fixed constant on the finder; %3B is the encoded ';' separator.
const FACETS_LIST = 'LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS';

/** @param {string} url */
function assertOracleUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`oraclecloud: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`oraclecloud: URL must use HTTPS: ${url}`);
  if (!ORACLE_HOST_RE.test(parsed.hostname)) {
    throw new Error(`oraclecloud: untrusted hostname "${parsed.hostname}" — must match *.fa[.<region>][.ocs].oraclecloud.com`);
  }
  return url;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
// (copied from greenhouse.mjs)
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses a `Retry-After` header value (seconds, or an HTTP-date) to ms, or null. */
function parseRetryAfterMs(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

function isRetryableError(err) {
  const status = err?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  return status === undefined; // network error / timeout / abort — no status set
}

/** Fetches a single page, retrying transient failures with backoff + jitter. */
async function fetchPageWithRetry(ctx, api, opts) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await ctx.fetchJson(api, opts);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryableError(err)) throw err;
      const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
      const retryAfterMs = parseRetryAfterMs(err?.retryAfter);
      const delayMs = retryAfterMs !== null ? Math.min(retryAfterMs, RETRY_MAX_DELAY_MS * 4) : (backoff + Math.random() * 250);
      await sleep(delayMs, ctx);
    }
  }
  throw lastErr;
}

/**
 * Resolve ORC coordinates from a portal entry. `entry.api` takes precedence
 * over `entry.careers_url` (mirrors greenhouse/ashby/smartrecruiters) so a
 * branded careers page can stay as careers_url while the ORC host/site is
 * pinned via api:. Honors optional `entry.siteNumber` / `entry.locationId`.
 *
 * @param {import('./_types.js').PortalEntry & {siteNumber?:string, locationId?:string|number}} entry
 * @returns {{host:string, lang:string, siteNumber:string, locationId:(string|null)}|null}
 */
export function resolveSite(entry) {
  for (const raw of [entry.api, entry.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    if (!ORACLE_HOST_RE.test(parsed.hostname)) continue;

    const segs = parsed.pathname.split('/').filter(Boolean);
    // Path shape: /hcmUI/CandidateExperience/<lang>/sites/<siteNumber>/...
    const ceIdx = segs.findIndex((s) => s === 'CandidateExperience');
    const lang = ceIdx !== -1 && segs[ceIdx + 1] ? segs[ceIdx + 1] : 'en';
    const sitesIdx = segs.indexOf('sites');
    const siteFromUrl = sitesIdx !== -1 && segs[sitesIdx + 1] ? segs[sitesIdx + 1] : null;

    const overrideSite = typeof entry.siteNumber === 'string' && entry.siteNumber ? entry.siteNumber : null;
    const siteNumber = overrideSite || siteFromUrl || 'CX_1';
    const locationId = entry.locationId != null && `${entry.locationId}` !== ''
      ? `${entry.locationId}`
      : null;

    return { host: parsed.hostname, lang, siteNumber, locationId };
  }
  return null;
}

/**
 * Build the requisitions API URL. Params are set in BOTH the finder segment
 * and top-level (some tenants only honor one). facetsList uses %3B-encoded ';'.
 *
 * @param {{host:string, siteNumber:string, locationId?:(string|null)}} site
 * @param {number} offset
 * @param {number} limit
 */
export function buildApiUrl(site, offset = 0, limit = PAGE_SIZE) {
  // Finder grammar: `findReqs;key=val,key=val,...` — a ';' after the finder
  // name, then comma-separated key/value pairs. (A comma after findReqs 400s.)
  const finderParams = [
    `siteNumber=${site.siteNumber}`,
    `facetsList=${FACETS_LIST}`,
    `limit=${limit}`,
    'sortBy=POSTING_DATES_DESC',
    `offset=${offset}`,
  ];
  if (site.locationId) finderParams.push(`locationId=${site.locationId}`);
  const finder = `findReqs;${finderParams.join(',')}`;
  const expand = 'requisitionList.workLocation,requisitionList.secondaryLocations';
  return `https://${site.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
    + `?onlyData=true`
    + `&expand=${encodeURIComponent(expand)}`
    + `&finder=${finder}`
    + `&limit=${limit}&offset=${offset}`;
}

/**
 * Build the public posting URL for a requisition Id.
 * @param {{host:string, lang:string, siteNumber:string}} site
 * @param {string} id
 */
export function buildJobUrl(site, id) {
  return `https://${site.host}/hcmUI/CandidateExperience/${site.lang}/sites/${site.siteNumber}/job/${id}`;
}

/**
 * Assemble a location string for a requisition. Prefers PrimaryLocation; else
 * builds from the expanded workLocation object; appends a remote/hybrid hint
 * from WorkplaceTypeCode. Returns "" when nothing is available.
 * @param {any} req
 */
function assembleLocation(req) {
  let base = typeof req.PrimaryLocation === 'string' ? req.PrimaryLocation.trim() : '';
  if (!base && Array.isArray(req.workLocation) && req.workLocation.length) {
    const wl = req.workLocation[0] || {};
    base = [wl.TownOrCity, wl.Region, wl.Country].filter((v) => typeof v === 'string' && v.trim()).join(', ');
  }
  const wt = req.WorkplaceTypeCode;
  const remoteHint = wt === 'ORA_REMOTE' ? 'Remote' : wt === 'ORA_HYBRID' ? 'Hybrid' : '';
  return [base, remoteHint].filter(Boolean).join(' · ');
}

/**
 * Pure normalizer for an ORC requisitions response. Exported for unit tests.
 * Reads items[0].requisitionList[], maps each to the Job shape, drops rows with
 * no resolvable URL. Returns [] for null / {} / non-array / {items:null}.
 *
 * @param {any} json
 * @param {{host:string, lang:string, siteNumber:string}} site
 * @param {string} companyName
 * @returns {Array<{title:string, url:string, company:string, location:string, description?:string, postedAt?:number}>}
 */
export function parseOracleResponse(json, site, companyName) {
  const item = Array.isArray(json?.items) ? json.items[0] : null;
  const list = item && Array.isArray(item.requisitionList) ? item.requisitionList : null;
  if (!list) return [];
  const out = [];
  for (const req of list) {
    if (!req || typeof req !== 'object') continue;
    const id = req.Id != null ? String(req.Id) : (req.RequisitionNumber != null ? String(req.RequisitionNumber) : '');
    const externalUrl = typeof req.ExternalURL === 'string' && req.ExternalURL.trim() ? req.ExternalURL.trim() : '';
    const url = externalUrl || (id ? buildJobUrl(site, id) : '');
    if (!url) continue; // dedup key — drop rows we can't link to
    const job = {
      title: typeof req.Title === 'string' ? req.Title : '',
      url,
      company: companyName,
      location: assembleLocation(req),
    };
    if (typeof req.ShortDescriptionStr === 'string' && req.ShortDescriptionStr.trim()) {
      job.description = decodeEntities(req.ShortDescriptionStr);
    }
    const postedAt = toEpochMs(req.PostedDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'oraclecloud',

  detect(entry) {
    try {
      const site = resolveSite(entry);
      return site ? { url: buildApiUrl(site, 0, PAGE_SIZE) } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const site = resolveSite(entry);
    if (!site) throw new Error(`oraclecloud: cannot derive API URL for ${entry.name}`);

    const maxPages = Number.isInteger(entry.max_pages) && entry.max_pages > 0
      ? Math.min(entry.max_pages, MAX_PAGES)
      : MAX_PAGES;

    const all = [];
    let total = null;
    for (let page = 0; page < maxPages; page++) {
      const offset = page * PAGE_SIZE;
      const apiUrl = buildApiUrl(site, offset, PAGE_SIZE);
      assertOracleUrl(apiUrl); // SSRF guard before every fetch
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);

      const json = await fetchPageWithRetry(ctx, apiUrl, {
        redirect: 'error',
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      });

      const parsed = parseOracleResponse(json, site, entry.name);
      all.push(...parsed);

      const item = Array.isArray(json?.items) ? json.items[0] : null;
      if (total === null && item && typeof item.TotalJobsCount === 'number') total = item.TotalJobsCount;
      const listLen = item && Array.isArray(item.requisitionList) ? item.requisitionList.length : 0;

      // Stop conditions. NOTE: `hasMore` is unreliable on some tenants (e.g.
      // JPMC returns hasMore:false on EVERY page even with 7000+ jobs), so it's
      // NOT used to stop — trusting it caps the scan at one page. The
      // authoritative signals are the returned list length and TotalJobsCount:
      //   - an empty or short page means we've reached the end;
      //   - once we've paged past TotalJobsCount there's nothing left to fetch.
      if (listLen === 0 || listLen < PAGE_SIZE) break;
      if (total !== null && offset + PAGE_SIZE >= total) break;
    }
    return all;
  },
};
