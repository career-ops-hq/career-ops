// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { resolveMaxPages, isProbing } from './_paging.mjs';

// Uber provider — Uber runs its own careers site backed by a public JSON search
// endpoint (POST):
//   POST https://www.uber.com/api/loadSearchJobsResults?localeCode=en
//   body: {"params":{"query":"<q>","location":[{"country":"USA"}]},"page":<n>,"limit":100}
// Response: { data: { results: [...], totalResults: { low: N } } }
// A dummy x-csrf-token header is required (any non-empty value passes).
//
// Uber's board is large, so we run specific phrase queries (configurable) and
// let scan.mjs's title filter do the final cut. Results de-dup by job id.
//
// Config (portals.yml):
//   provider: uber
//   uber:
//     country: "USA"                  # optional, default below
//     queries: ["strategy", "business operations", ...]

const ALLOWED_HOST = 'www.uber.com';
const ENDPOINT = 'https://www.uber.com/api/loadSearchJobsResults?localeCode=en';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;                 // ≤500 results per query — bounded
const DEFAULT_COUNTRY = 'USA';
const DEFAULT_QUERIES = [
  'corporate strategy', 'business operations', 'strategy and operations',
  'corporate development', 'chief of staff', 'strategic finance',
];

function locationOf(job) {
  const fmt = (l) => [l.city, l.region, l.countryName || l.country].filter(Boolean).join(', ');
  const all = Array.isArray(job.allLocations) && job.allLocations.length ? job.allLocations : [job.location].filter(Boolean);
  return [...new Set(all.map(fmt).filter(Boolean))].join('; ');
}

function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @type {Provider} */

export default {
  id: 'uber',

  detect(entry) {
    const url = entry.careers_url || '';
    try {
      if (new URL(url).hostname === ALLOWED_HOST) return { url: ENDPOINT };
    } catch {
      // not a URL — fall through
    }
    return null;
  },

  async fetch(entry, ctx) {
    const pageCap = resolveMaxPages(entry, ctx, MAX_PAGES);
    const cfg = entry.uber || {};
    const queries = Array.isArray(cfg.queries) && cfg.queries.length ? cfg.queries : DEFAULT_QUERIES;
    const country = typeof cfg.country === 'string' && cfg.country ? cfg.country : DEFAULT_COUNTRY;

    const byId = new Map();
    for (const q of (isProbing(ctx) ? queries.slice(0, 1) : queries)) {
      for (let page = 0; page < pageCap; page++) {
        const body = JSON.stringify({
          params: { query: q, location: [{ country }] },
          page,
          limit: PAGE_SIZE,
        });
        const json = /** @type {any} */ (await ctx.fetchJson(ENDPOINT, {
          method: 'POST',
          body,
          redirect: 'error',
          headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': 'x' },
        }));
        const results = Array.isArray(json?.data?.results) ? json.data.results : [];
        for (const j of results) {
          if (j.id == null || !j.title) continue;
          if (byId.has(j.id)) continue;
          byId.set(j.id, {
            title: j.title,
            url: `https://www.uber.com/careers/list/${j.id}/`,
            company: entry.name,
            location: locationOf(j),
            postedAt: toEpochMs(j.updatedDate || j.creationDate),
          });
        }
        if (results.length < PAGE_SIZE) break;  // last page for this query
      }
    }
    return [...byId.values()];
  },
};
