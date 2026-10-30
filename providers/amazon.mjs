// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Amazon / AWS provider — hits the public amazon.jobs search JSON API.
// Auto-detects from a careers_url on `amazon.jobs`; the whole board is one
// global endpoint, so a tracked_companies entry narrows it with an `amazon:`
// config block whose keys are passed straight through as query params:
//
//   - name: Amazon / AWS
//     provider: amazon
//     amazon:
//       loc_query: Germany          # free-text location filter
//       base_query: machine learning  # optional keyword filter
//       category: software-development # optional facet (repeatable via array)
//
// The board is enormous (100k+ postings), so a location and/or keyword filter
// is effectively required — without one the MAX_PAGES cap just returns the most
// recent slice. result_limit is fixed at 100 (the API's hard per-page max;
// larger values return an empty `jobs`), and we page via `offset`.

const PAGE_SIZE = 100; // amazon.jobs caps result_limit at 100
const MAX_PAGES = 20; // safety cap — at most 2000 postings per entry
const ORIGIN = 'https://www.amazon.jobs';

/** @param {import('./_types.js').PortalEntry & {amazon?: Record<string, unknown>}} entry */
function buildQuery(entry, offset) {
  const cfg = entry.amazon && typeof entry.amazon === 'object' ? entry.amazon : {};
  const params = new URLSearchParams();
  // Pass config keys through verbatim (base_query, loc_query, category, …).
  // Array values are amazon.jobs facet filters and MUST use the `key[]=`
  // bracket form to filter (e.g. normalized_country_code[]=DEU); a bare
  // `key=DEU` is silently ignored and the board stays global.
  for (const [k, v] of Object.entries(cfg)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      const name = k.endsWith('[]') ? k : `${k}[]`;
      for (const item of v) params.append(name, String(item));
    } else {
      params.append(k, String(v));
    }
  }
  if (!params.has('base_query')) params.set('base_query', '');
  if (!params.has('loc_query')) params.set('loc_query', '');
  params.set('sort', cfg.sort ? String(cfg.sort) : 'recent');
  params.set('result_limit', String(PAGE_SIZE));
  params.set('offset', String(offset));
  return `${ORIGIN}/en/search.json?${params.toString()}`;
}

// amazon.jobs posted_date reads "July  3, 2026" (note the padded day);
// Date.parse handles it once whitespace is collapsed. (updated_time is a
// relative string like "10 minutes" / "about 1 hour" — unparseable, skip it.)
function toEpochMs(job) {
  const raw = job.posted_date;
  if (!raw || typeof raw !== 'string') return undefined;
  const parsed = Date.parse(raw.replace(/\s+/g, ' ').trim());
  return Number.isNaN(parsed) ? undefined : parsed;
}

// A multi-city req names only its primary city in normalized_location /
// location; every city is in `locations`, an array of JSON-encoded strings.
// Keep the primary first and join the rest with " · ", the multi-location
// shape location_filter already expects (see workable.mjs), so a req that
// also lists another city is not filtered out on its primary alone.
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function formatLocation(job) {
  const primary = str(job.normalized_location) || str(job.location);
  const cities = primary ? [primary] : [];
  // Every spelling seen so far: one city can arrive as "Denver, Colorado, USA"
  // in one entry and only as "US, CO, Denver" in another.
  const seen = new Set(cities);
  for (const entry of Array.isArray(job.locations) ? job.locations : []) {
    let loc;
    try {
      loc = typeof entry === 'string' ? JSON.parse(entry) : entry;
    } catch {
      continue;
    }
    const spelled = str(loc?.location);
    const name = str(loc?.normalizedLocation) || spelled;
    // The primary may be either spelling ("Arlington, Virginia, USA" or
    // "US, VA, Arlington"), so check both before appending.
    if (name && !seen.has(name) && !seen.has(spelled)) cities.push(name);
    for (const s of [name, spelled]) if (s) seen.add(s);
  }
  return cities.join(' · ');
}

/** @type {Provider} */
export default {
  id: 'amazon',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    // Match the host, not a path segment, to avoid spoofed URLs.
    try {
      const host = new URL(url).host.toLowerCase();
      if (host === 'amazon.jobs' || host.endsWith('.amazon.jobs')) return { url };
    } catch {
      /* not an absolute URL */
    }
    return null;
  },

  async fetch(entry, ctx) {
    const jobs = [];
    const seen = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = buildQuery(entry, page * PAGE_SIZE);
      const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error' }));
      const postings = Array.isArray(json?.jobs) ? json.jobs : [];
      if (postings.length === 0) break;

      let fresh = 0;
      for (const j of postings) {
        const path = j.job_path;
        if (!path || typeof path !== 'string') continue;
        const url2 = /^https?:\/\//i.test(path) ? path : ORIGIN + (path.startsWith('/') ? path : '/' + path);
        if (seen.has(url2)) continue;
        seen.add(url2);
        fresh++;
        jobs.push({
          title: (j.title || '').trim(),
          url: url2,
          company: j.company_name || entry.name,
          location: formatLocation(j),
          postedAt: toEpochMs(j),
        });
      }
      if (fresh === 0) break; // API ignored offset / looped
      if (postings.length < PAGE_SIZE) break; // last page
    }
    return jobs;
  },
};
