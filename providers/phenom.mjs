// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Phenom People provider — the "CareerConnect" career sites many large
// enterprises run (careers.allianz.com and countless others). The search SPA
// talks to a public, no-auth JSON widget endpoint on the BRANDED host:
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
// slugify the title. applyUrl points at the downstream ATS (Allianz: SF
// career5) and is NOT the public listing, so we don't use it as the job URL.
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
// Detection: branded hosts carry no "phenom" token, so detect() only auto-claims
// literal *.phenompeople.com URLs; branded tenants are wired with an explicit
// `provider: phenom` (which bypasses detect()).

const PAGE_SIZE = 100; // max the widget serves per page (verified)
const MAX_PAGES = 40; // safety cap on request count (40*100 = 4000 postings)
const MAX_JOBS = 1000; // cap total postings pulled per site
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
  const direct = String(job?.location || job?.cityStateCountry || job?.cityState || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
    const title = String(job.title || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

/** Resolve the page cap: positive integer `max_pages`, else default. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES);
  return MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'phenom',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
    if (host === 'phenompeople.com' || host.endsWith('.phenompeople.com')) return { url };
    return null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`phenom: cannot resolve origin for ${entry.name}`);

    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const maxPages = resolveMaxPages(entry);
    const jobs = [];
    const seen = new Set();
    let total = null;

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await wait(PAGE_DELAY_MS);
      let json;
      try {
        json = await ctx.fetchJson(cfg.widgetsApi, {
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
      } catch {
        break; // keep jobs collected so far — a transient mid-scan failure shouldn't discard earlier pages
      }
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
        if (jobs.length >= MAX_JOBS) break;
      }
      if (fresh === 0) break; // server ignored `from` (or we've looped)
      if (jobs.length >= MAX_JOBS) break;
      if (total !== null && (page + 1) * PAGE_SIZE >= total) break;
    }
    return jobs;
  },
};
