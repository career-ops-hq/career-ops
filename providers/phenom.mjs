// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry } from './_http.mjs';
// Titles arrive HTML-escaped, so the tag strip below is not enough on its own:
// an undecoded "R&amp;D Engineer" fails the user's own title_filter positive
// "r&d" and is silently dropped, and a negative like "sales & marketing" never
// vetoes "Sales &amp; Marketing Lead". Shared decoder, same as softgarden and
// radancy (#2487, #2921).
import { decodeEntities } from './_html-entities.mjs';

// Phenom People provider — the "CareerConnect" career sites many large
// enterprises run (branded domains like careers.exampleco.com). The search
// SPA talks to a public, no-auth JSON widget endpoint on the BRANDED host:
//
//   POST {origin}/widgets
//   Content-Type: application/json
//   {"lang":"en_global","country":"global","ddoKey":"refineSearch",
//    "pageName":"search-results","siteType":"external","jobs":true,"counts":true,
//    "from":0,"size":100,"keywords":"","selected_fields":{…facet filters…},
//    "all_fields":["category","country","city"], …}
//   → {"refineSearch":{"status":200,"totalHits":N,
//        "data":{"jobs":[{"jobId":"98098","title":…,"city":…,"state":…,
//          "country":…,"location":…,"postedDate":"…ISO…","applyUrl":…}]}}}
//
// `from` is a 0-based offset; `size` up to 100/page (verified). The public job
// page the SPA links to is {origin}/{urlPrefix}/job/{jobId}/{slug} — the slug is
// cosmetic (Phenom keys on jobId; a stub slug resolves the same posting), so we
// slugify the title. applyUrl points at the downstream ATS (tenant-specific,
// observed live) and is NOT the public listing, so we don't use it as the
// job URL.
//
// Facets use human-readable values here (unlike CSOD/beesite numeric codes):
// selected_fields:{"country":["Germany"]} narrows to the DACH set. A portals
// entry configures the tenant via a `phenom:` block:
//   phenom:
//     lang: en_global        # widget locale (default en_global)
//     country: global        # widget country scope (default global)
//     urlPrefix: global/en   # public job-page path prefix (default global/en)
//     selectedFields: { country: ["Germany"] }   # optional facet filter
//
// No auto-detection: every tenant we've found (Marsh McLennan, Baker Hughes,
// Omnicable, KCE, ...) permanently 301-redirects its legacy
// <tenant>.phenompeople.com host to its own branded domain, and this
// provider's fetch() uses `redirect: 'error'` (never follows a redirect), so
// even matching that legacy host would still fail to fetch. There is no
// known live tenant reachable via a phenompeople.com URL. Always wire a
// tenant with an explicit `provider: phenom` + `careers_url` pointed at its
// branded origin (the /widgets endpoint lives on that same origin, so no
// separate `api:` is needed).

const PAGE_SIZE = 100; // max the widget serves per page (verified)

// Safety cap on pagination — applied regardless of what the widget reports as
// `totalHits`, so a misbehaving API can't drive this into fetching an
// unbounded number of pages. Override with `max_pages` on the portal entry
// for a tenant that genuinely exceeds it (mirrors providers/workday.mjs).
const DEFAULT_MAX_PAGES = 20; // 20*100 = 2,000 postings
// Hard ceiling even for an explicit override. 300 pages (30,000 postings) is
// an arbitrary 15x default headroom multiplier, NOT verified against any
// confirmed large Phenom tenant — unlike workday.mjs's identical 30,000
// figure, which is backed by three named, verified tenants (dollartree
// 23,609; oreillyauto 17,061; cvshealth ~16,800). The only Phenom tenant
// actually measured here is Allianz (~1,900), already well within
// DEFAULT_MAX_PAGES above; workday's retail/pharmacy chains post per-store
// listings at a scale nothing in this codebase's Phenom deployments (branded
// corporate HQ career sites) has been shown to reach. Revisit if a real
// tenant is found sitting near this ceiling.
const MAX_PAGES_CAP = 300;

const PAGE_DELAY_MS = 150; // polite pacing between page requests

/** @param {import('./_types.js').PortalEntry} entry */
export function resolveConfig(entry) {
  const raw = entry.api || entry.careers_url || '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const block = entry.phenom && typeof entry.phenom === 'object' ? entry.phenom : {};
  const urlPrefix = String(block.urlPrefix || 'global/en').replace(/^\/+|\/+$/g, '');
  return {
    origin: u.origin,
    widgetsApi: `${u.origin}/widgets`,
    lang: typeof block.lang === 'string' ? block.lang : 'en_global',
    country: typeof block.country === 'string' ? block.country : 'global',
    urlPrefix,
    selectedFields: block.selectedFields && typeof block.selectedFields === 'object' ? block.selectedFields : {},
  };
}

// Slugify a title the way Phenom builds the cosmetic job-page slug: keep
// alphanumerics, collapse every other run to a single hyphen, trim hyphens.
/** @param {string} title */
export function slugify(title) {
  return String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks (ü→u, é→e)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'job';
}

// Phenom postedDate is an ISO-8601 instant ("2026-05-07T18:25:30.000+0000").
/** @param {unknown} raw @returns {number | undefined} */
export function parsePhenomDate(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const ms = Date.parse(raw.trim());
  return Number.isFinite(ms) ? ms : undefined;
}

// The widget returns a flat "City, State, Country" via several fields; prefer
// the explicit `location`, else assemble from city/state/country. Strips markup
// and collapses whitespace.
/** @param {any} job @returns {string} */
export function jobLocation(job) {
  const direct = decodeEntities(String(job?.location || job?.cityStateCountry || job?.cityState || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (direct) return direct;
  const parts = [job?.city, job?.state, job?.country].map((p) => String(p || '').trim()).filter(Boolean);
  return [...new Set(parts)].join(', ');
}

/**
 * Map one refineSearch response to {total, rows}. A record without a jobId or a
 * title is skipped (no stable dedup key / no meaningful listing).
 * @param {any} json @param {{origin:string, urlPrefix:string}} cfg
 */
export function parseRefineSearch(json, cfg) {
  const rs = json?.refineSearch;
  const total = typeof rs?.totalHits === 'number' ? rs.totalHits : null;
  const list = Array.isArray(rs?.data?.jobs) ? rs.data.jobs : [];
  const rows = [];
  for (const job of list) {
    if (!job || typeof job !== 'object') continue;
    const id = job.jobId != null ? String(job.jobId) : '';
    const title = decodeEntities(String(job.title || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!id || !title) continue;
    rows.push({
      id,
      title,
      url: `${cfg.origin}/${cfg.urlPrefix}/job/${encodeURIComponent(id)}/${slugify(title)}`,
      location: jobLocation(job),
      postedAt: parsePhenomDate(job.postedDate || job.dateCreated),
    });
  }
  return { total, rows };
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'phenom',

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`phenom: cannot resolve origin for ${entry.name}`);

    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const maxPages = resolveMaxPages(entry);
    // Honor a context page cap — verify-portals' liveness probe sets
    // `ctx.maxPages: 1` so it only needs to know a board is live, not its
    // full count (mirrors providers/workday.mjs). Kept separate from
    // maxPages so the entry-cap warning below (page === maxPages) doesn't
    // misfire when it was really the probe's cap that stopped pagination.
    // No effect on real scans, which don't set ctx.maxPages.
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pagesToFetch = Math.min(maxPages, ctxCap);
    const jobs = [];
    const seen = new Set();
    let total = null;

    // Why pagination stopped — drives the truncation warning below. Only a
    // 'cap' stop is worth surfacing: 'complete' means the widget ran out of
    // fresh rows on its own, and a fetch failure already keeps whatever was
    // collected without needing a second warning.
    let stopReason = 'complete';
    let page = 0;
    let anyPageSucceeded = false;
    for (; page < pagesToFetch; page++) {
      if (page > 0) await wait(PAGE_DELAY_MS);
      let json;
      try {
        // Retries transient failures (429/5xx/timeout) with backoff before
        // giving up on the page.
        json = await fetchJsonWithRetry(ctx, cfg.widgetsApi, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            lang: cfg.lang,
            deviceType: 'desktop',
            country: cfg.country,
            pageName: 'search-results',
            ddoKey: 'refineSearch',
            sortBy: '',
            subsearch: '',
            from: page * PAGE_SIZE,
            jobs: true,
            counts: true,
            all_fields: ['category', 'country', 'city'],
            size: PAGE_SIZE,
            clearAll: false,
            jdsource: 'facets',
            isSliderEnable: false,
            pageId: 'page10',
            siteType: 'external',
            keywords: '',
            global: cfg.country === 'global',
            selected_fields: cfg.selectedFields,
            locationData: {},
          }),
        });
      } catch (err) {
        // Reached only once fetchJsonWithRetry's retries are exhausted, or
        // immediately for a non-retryable error (e.g. a 4xx). Keep jobs
        // collected so far — a page failure doesn't discard earlier pages —
        // and log it, so a rate-limit/WAF block on page N is distinguishable
        // from a tenant that genuinely only has N*PAGE_SIZE postings.
        // If not even the first page ever succeeded, this tenant is
        // completely broken (wrong endpoint, dead board, hard-blocked) — a
        // silent empty result would look identical to "zero postings" to
        // callers. Rethrow so it surfaces as a failure instead (mirrors
        // providers/workday.mjs, which never wraps its first-page fetch in
        // try/catch for the same reason).
        if (!anyPageSucceeded) throw err;
        const jobsSummary = `${jobs.length}${total !== null ? ` of ${total}` : ''} jobs`;
        console.error(`⚠️  phenom: ${entry.name} truncated at page ${page + 1} of ${maxPages} (${jobsSummary}): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }
      anyPageSucceeded = true;
      const { total: pageTotal, rows } = parseRefineSearch(json, cfg);
      if (total === null) total = pageTotal;
      if (rows.length === 0) break;

      let fresh = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        fresh++;
        const job = { title: row.title, url: row.url, company: entry.name, location: row.location };
        if (typeof row.postedAt === 'number') job.postedAt = row.postedAt;
        jobs.push(job);
      }
      if (fresh === 0) break; // server ignored `from` (or we've looped)
      if (total !== null && (page + 1) * PAGE_SIZE >= total) break;
    }
    if (stopReason === 'complete' && page === maxPages) stopReason = 'cap';

    // The cap is a safety net, not a working limit — silent by design, but a
    // tenant that actually hits it needs to be surfaced (mirrors
    // providers/workday.mjs's identical "raise max_pages" warning).
    if (stopReason === 'cap') {
      const jobsSummary = `${jobs.length}${total !== null ? ` of ${total}` : ''} jobs`;
      console.error(`⚠️  phenom: ${entry.name} truncated at max_pages=${maxPages} (${jobsSummary}) — raise max_pages on this entry for more`);
    }

    return jobs;
  },
};
