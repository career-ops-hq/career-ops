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
//   ...and the same three shapes on the numbered apex `oraclecloud<NN>.com`
//   that Oracle issues to newer tenants (observed live: a Fusion board on
//   `<tenant>.fa.ocs.oraclecloud26.com` whose unnumbered `oraclecloud.com`
//   sibling host does not resolve at all).
//
// The numeric suffix is BOUNDED (1-99), not open-ended: this regex exists to
// PIN the host before every fetch, so it enumerates a finite apex family and
// never degrades into `oraclecloud<anything>.com`.
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
import { BROWSER_LIKE_USER_AGENT, fetchJsonWithRetry, sleep } from './_http.mjs';

// `oraclecloud(?:[1-9][0-9]?)?` = oraclecloud.com plus oraclecloud1.com …
// oraclecloud99.com. No leading zero, at most two digits — a bounded family,
// so this stays a host pin and never becomes a wildcard apex match.
const ORACLE_HOST_RE = /^[a-z0-9-]+\.fa\.(?:[a-z0-9-]+\.)?(?:ocs\.)?oraclecloud(?:[1-9][0-9]?)?\.com$/i;

const PAGE_SIZE = 200;
const MAX_PAGES = 25;             // default cap (~5000 jobs) when the entry sets no max_pages and the tenant reports no total
// Upper bound an entry may opt in to with `max_pages` (~20000 jobs, 100 requests
// of 200 rows at 250ms spacing). JPMorgan Chase alone has 7000+ postings, which
// the default cannot cover; the bound stays finite so a typo can't walk a board
// forever.
export const HARD_MAX_PAGES = 100;
const RETRY_POLICY = { retries: 3 };
const INTER_PAGE_DELAY_MS = 250;  // WAF-aware spacing between same-host pages

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
    throw new Error(`oraclecloud: untrusted hostname "${parsed.hostname}" — must match *.fa[.<region>][.ocs].oraclecloud[1-99].com`);
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

/**
 * Page cap for an entry: a positive integer `max_pages` up to HARD_MAX_PAGES,
 * else the default. Exported for unit tests.
 * @param {{max_pages?: unknown}} entry
 */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  return Number.isInteger(v) && /** @type {number} */ (v) > 0
    ? Math.min(/** @type {number} */ (v), HARD_MAX_PAGES)
    : MAX_PAGES;
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

    let entryMaxPages = resolveMaxPages(entry);
    // An entry's own max_pages is the user's choice and is kept as set. Without
    // one, a tenant that reports TotalJobsCount already bounds the walk, so the
    // default rises to cover that total, up to HARD_MAX_PAGES: a fixed 25 pages
    // read 5000 of JPMorgan's 7118 postings. MAX_PAGES stays the cap only for a
    // tenant that reports no total, where nothing else ends the walk.
    const autoRaise = !(Number.isInteger(entry?.max_pages) && entry.max_pages > 0);
    // Health probes / audits pass ctx.maxPages (1) to ask for a single page;
    // honour it as the upper bound, and don't call that deliberate stop a truncation.
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    let maxPages = Math.min(entryMaxPages, ctxCap);

    const all = [];
    let total = null;
    let capped = true; // flips to false whenever a stop condition ends the walk
    for (let page = 0; page < maxPages; page++) {
      const offset = page * PAGE_SIZE;
      const apiUrl = buildApiUrl(site, offset, PAGE_SIZE);
      assertOracleUrl(apiUrl); // SSRF guard before every fetch
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);

      const json = await fetchJsonWithRetry(ctx, apiUrl, {
        redirect: 'error',
        headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, Accept: 'application/json' },
      }, RETRY_POLICY);

      const parsed = parseOracleResponse(json, site, entry.name);
      all.push(...parsed);

      const item = Array.isArray(json?.items) ? json.items[0] : null;
      if (total === null && item && typeof item.TotalJobsCount === 'number') {
        total = item.TotalJobsCount;
        if (autoRaise) {
          entryMaxPages = Math.max(entryMaxPages, Math.min(Math.ceil(total / PAGE_SIZE), HARD_MAX_PAGES));
          maxPages = Math.min(entryMaxPages, ctxCap);
        }
      }
      const listLen = item && Array.isArray(item.requisitionList) ? item.requisitionList.length : 0;

      // Stop conditions. NOTE: `hasMore` is unreliable on some tenants (e.g.
      // JPMC returns hasMore:false on EVERY page even with 7000+ jobs), so it's
      // NOT used to stop — trusting it caps the scan at one page.
      //
      // An empty page is always the end. A SHORT page is not: ORC serves fewer
      // rows than the limit mid-list (American Express reports TotalJobsCount
      // 454 and serves 200, 199, 54 — one row is filtered server-side), and
      // treating that 199 as the end dropped the last 54 postings, 12% of the
      // board. Matching the wider convention: "the API may return fewer results
      // than the number requested … even if not at the end of the collection"
      // (Google AIP-158). So a short page only ends the walk when the tenant
      // reports no total to check it against.
      if (listLen === 0) { capped = false; break; }
      if (total !== null) {
        if (offset + PAGE_SIZE >= total) { capped = false; break; }
      } else if (listLen < PAGE_SIZE) { capped = false; break; }
    }

    // The page cap ended the walk with rows still unread (or, when the tenant
    // reports no total, with no sign the board ended). Say so: a silently
    // short board reads as a complete one.
    if (capped && entryMaxPages < ctxCap) {
      const counts = total === null ? `${all.length} jobs fetched, total unknown` : `${all.length} of ${total} jobs`;
      const advice = maxPages < HARD_MAX_PAGES
        ? `raise max_pages on this entry for more (up to ${HARD_MAX_PAGES})`
        : `max_pages is already at the ${HARD_MAX_PAGES}-page ceiling`;
      console.error(`⚠️  oraclecloud: ${entry.name} truncated at max_pages=${maxPages} (${counts}) — ${advice}`);
      // Same tag workday.mjs / eightfold.mjs put on a cut-short board, so a
      // caller that cannot see stderr can still tell.
      /** @type {any} */ (all).oraclecloudTruncated = true;
      // Canonical shape read by lib/board-truncation.mjs (scan.mjs).
      /** @type {any} */ (all).truncated = { reason: 'page-cap', fetched: all.length, ...(total === null ? {} : { total }) };
    }
    return all;
  },
};
