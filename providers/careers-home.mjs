// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { resolveMaxPages, isProbing } from './_paging.mjs';

// careers-home provider — the "careers-home" career-site platform (Jibe, fronting
// iCIMS) exposes a clean public JSON search endpoint:
//   GET https://{host}/api/jobs?keywords=<q>&page=<n>&sortBy=relevance&descending=false&internal=false[&<extra>]
//   -> { jobs: [ { req_id, slug, title, location_name, city, state, country } ], totalCount }
// Used by AMD (careers.amd.com) and Rivian (careers.rivian.com; needs extra
// tags2=Rivian Automotive). Page size is 10; paginate by `page` (1-based).
//
// Config (portals.yml):
//   provider: careers-home
//   careershome:
//     host: careers.amd.com
//     extra: ""                 # optional extra query string, e.g. "tags2=Rivian Automotive"
//     queries: ["strategy", "business operations", ...]

const PAGE_CAP = 6;              // ≤60 results per query — bounded; relevance-sorted
const DEFAULT_QUERIES = [
  'corporate strategy', 'business operations', 'strategy', 'corporate development',
  'chief of staff', 'financial planning',
];

function getConfig(entry) {
  const c = entry.careershome || {};
  const queries = Array.isArray(c.queries) && c.queries.length ? c.queries : DEFAULT_QUERIES;
  return { host: c.host, extra: c.extra || '', queries };
}

function locationOf(j) {
  if (j.location_name) return String(j.location_name);
  return [j.city, j.state, j.country].filter(Boolean).join(', ');
}

/** @type {Provider} */

export default {
  id: 'careers-home',

  detect(entry) {
    return entry.careershome ? { url: `https://${getConfig(entry).host || ''}/api/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const pageCap = resolveMaxPages(entry, ctx, PAGE_CAP);
    const { host, extra, queries } = getConfig(entry);
    if (!host) throw new Error(`careers-home: "${entry.name}" needs careershome.host in portals.yml`);
    const extraQs = extra ? `&${extra.replace(/\s/g, '%20')}` : '';
    const byId = new Map();
    for (const q of (isProbing(ctx) ? queries.slice(0, 1) : queries)) {
      for (let page = 1; page <= pageCap; page++) {
        const url = `https://${host}/api/jobs?keywords=${encodeURIComponent(q)}&page=${page}`
          + `&sortBy=relevance&descending=false&internal=false${extraQs}`;
        const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error', headers: { accept: 'application/json' } }));
        const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
        for (const raw of jobs) {
          const j = raw && raw.data ? raw.data : raw;  // careers-home wraps fields under .data
          const id = j.req_id ?? j.slug ?? j.id;
          if (id == null || !j.title || byId.has(id)) continue;
          byId.set(id, {
            title: String(j.title).trim(),
            url: `https://${host}/careers-home/jobs/${j.req_id ?? id}`,
            company: entry.name,
            location: locationOf(j),
          });
        }
        if (jobs.length < 10) break;  // last page for this query
      }
    }
    return [...byId.values()];
  },
};
