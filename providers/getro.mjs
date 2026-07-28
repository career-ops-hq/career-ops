// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Getro provider — VC "talent network" portfolio job boards (jobs at a fund's
// portfolio companies). Powers b2venture, Earlybird, Point Nine, Speedinvest,
// Cherry, HV Capital, Atomico, and many other VC boards.
//
// The public search API is:
//   POST https://api.getro.com/api/v2/collections/{collection_id}/search/jobs
//   body: {"hitsPerPage":N,"page":P}
//   -> { results: { jobs: [ {title,url,organization:{name},locations[],created_at} ], count } }
//
// A board's numeric collection_id is the `network.id` embedded in the board
// page's __NEXT_DATA__. We don't derive it from the URL — set it explicitly in
// portals.yml:
//
//   - name: b2venture (portfolio)
//     provider: getro
//     getro_collection: 4283
//     careers_url: https://jobs.b2venture.vc   # reference only
//     enabled: true
//
// These boards are large (1000-2000 jobs) but the API returns them
// created_at-DESCENDING (newest first), so we paginate newest-first and STOP
// once postings fall older than `getro_max_age_days`. This is a PAGINATION
// BOUND for efficiency (don't page through 2000 stale jobs); each job still
// carries `postedAt` (epoch ms) for any downstream freshness handling. The
// bound default (90d) is deliberately wide. `getro_max_pages` (default 40) is a
// hard safety cap. Jobs with no created_at are kept ("missing data = pass",
// same rule as the location filter).

// Getro returns `created_at` as Unix seconds, but older boards have been seen
// emitting ISO strings, so both shapes are handled. Non-positive values return
// null: the pagination cutoff below treats null as "undated, keep", whereas a
// 0 would read as 1970 and stop the walk on the first malformed row.
function toEpochMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    // Values below 1e12 are Unix seconds; at or above, already ms.
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) || ms <= 0 ? null : ms;
}

const API_BASE = 'https://api.getro.com/api/v2/collections';
const HITS_PER_PAGE = 20;          // API hard-caps page size at 20
const DEFAULT_MAX_PAGES = 40;      // safety cap: 40 x 20 = 800 newest jobs/board
// Ceiling on the per-entry `getro_max_pages` override. Without it a typo'd or
// hostile portals.yml value (getro_max_pages: 10000) turns one board into
// 10k sequential API calls against a third party.
const HARD_MAX_PAGES = 200;        // 200 x 20 = 4000 newest jobs/board
const DEFAULT_MAX_AGE_DAYS = 90;   // pagination bound only; global filter does the real cut

function resolveCollection(entry) {
  const id = entry.getro_collection;
  if (id == null) return null;
  const s = String(id).trim();
  if (!/^\d+$/.test(s)) return null;
  return s;
}

/** @type {Provider} */
export default {
  id: 'getro',

  detect(entry) {
    const id = resolveCollection(entry);
    return id ? { url: `${API_BASE}/${id}/search/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const id = resolveCollection(entry);
    if (!id) throw new Error(`getro: ${entry.name} needs a numeric 'getro_collection' in portals.yml`);
    const apiUrl = `${API_BASE}/${id}/search/jobs`;
    const maxPages = Number.isInteger(entry.getro_max_pages) && entry.getro_max_pages > 0
      ? Math.min(entry.getro_max_pages, HARD_MAX_PAGES) : DEFAULT_MAX_PAGES;
    const maxAgeDays = Number.isFinite(entry.getro_max_age_days) && entry.getro_max_age_days >= 0
      ? entry.getro_max_age_days : DEFAULT_MAX_AGE_DAYS;
    const cutoffMs = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86_400_000 : 0;

    const out = [];
    let total = Infinity;
    for (let page = 0; page < maxPages && page * HITS_PER_PAGE < total; page++) {
      const json = await ctx.fetchJson(apiUrl, {
        method: 'POST',
        // redirect:'error' — apiUrl is pinned to api.getro.com (https), so a 3xx
        // to a private/metadata IP must not be followed (matches every provider).
        redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ hitsPerPage: HITS_PER_PAGE, page }),
      });
      const results = json?.results || {};
      const jobs = Array.isArray(results.jobs) ? results.jobs : [];
      if (typeof results.count === 'number') total = results.count;
      if (jobs.length === 0) break;

      let reachedOld = false;
      for (const j of jobs) {
        const url = j.url || '';
        if (!url) continue;
        // Jobs are newest-first; a dated posting older than the cutoff (and
        // everything after it) is stale. Keep undated jobs (missing = pass).
        const createdMs = toEpochMs(j.created_at);
        if (cutoffMs > 0 && createdMs != null && createdMs < cutoffMs) {
          reachedOld = true;
          continue;
        }
        out.push({
          title: j.title || '',
          url,
          // Portfolio jobs belong to the portfolio company, not the fund —
          // expose the real employer so dedup and the tracker read correctly.
          company: j.organization?.name || j.organization_name || entry.name,
          location: (Array.isArray(j.locations) && j.locations[0])
            || (Array.isArray(j.searchable_locations) && j.searchable_locations[0])
            || '',
          postedAt: createdMs,
        });
      }
      // Once we've crossed the age cutoff, all later pages are older still.
      if (reachedOld) break;
    }
    return out;
  },
};
