// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// beesite (milch & zucker GJB) provider — the search backend behind branded
// portals like jobs.mercedes-benz.com. The SPA calls a public, no-auth JSON
// endpoint on the tenant's *.app.beesite.de host:
//
//   GET {origin}/search?data={URL-encoded JSON}
//   data = {"LanguageCode":"EN",
//           "SearchParameters":{"FirstItem":1,"CountItem":100,
//             "Sort":[{"Criterion":"PublicationStartDate","Direction":"DESC"}],
//             "MatchedObjectDescriptor":[…field list…]},
//           "SearchCriteria":[…optional facet filters…]}
//   → {"SearchResult":{"SearchResultCount":N,"SearchResultCountAll":TOTAL,
//        "SearchResultItems":[{"MatchedObjectId":"200325",
//          "MatchedObjectDescriptor":{"PositionID":"mer0003yhd",
//            "PositionTitle":…,"PositionURI":"https://jobs.mercedes-benz.com/…",
//            "PositionLocation":[{"CityName":"Bremen"}],
//            "PublicationStartDate":"2026-07-04"}}]}}
//
// PositionURI is the BRANDED job page (jobs.mercedes-benz.com/…), so listings
// link straight to the public posting. FirstItem is 1-based; requesting past
// the end returns an empty item list. We sort newest-first so a bounded walk
// (max_pages / MAX_JOBS) keeps the most recent postings.
//
// Facet criteria use tenant-internal numeric term codes (Mercedes: country
// 329 = Germany, discoverable via MatchedObjectDescriptor "Facet:…" queries).
// A portals.yml entry can pin them via:
//   beesite:
//     searchCriteria:
//       - { CriterionName: PositionLocation.Country, CriterionValue: [329] }

const PAGE_SIZE = 100; // verified: the endpoint happily serves 100+/page
const MAX_PAGES = 40; // safety cap on request count (40*100 = 4000 postings)
const MAX_JOBS = 1000; // cap total postings pulled (newest-first sort)
const PAGE_DELAY_MS = 150; // polite pacing between page requests

const DESCRIPTOR = [
  'PositionID',
  'PositionTitle',
  'PositionURI',
  'PositionLocation.CityName',
  'PublicationStartDate',
];

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
  const host = u.host.toLowerCase();
  if (host !== 'beesite.de' && !host.endsWith('.beesite.de')) return null;
  const cfgBlock = entry.beesite && typeof entry.beesite === 'object' ? entry.beesite : {};
  return {
    searchApi: `${u.origin}/search`,
    languageCode: typeof cfgBlock.languageCode === 'string' ? cfgBlock.languageCode : 'EN',
    searchCriteria: Array.isArray(cfgBlock.searchCriteria) ? cfgBlock.searchCriteria : [],
  };
}

/** Build the ?data= payload for one page. @param {any} cfg @param {number} firstItem */
export function buildSearchUrl(cfg, firstItem) {
  const data = {
    LanguageCode: cfg.languageCode,
    SearchParameters: {
      FirstItem: firstItem,
      CountItem: PAGE_SIZE,
      Sort: [{ Criterion: 'PublicationStartDate', Direction: 'DESC' }],
      MatchedObjectDescriptor: DESCRIPTOR,
    },
    SearchCriteria: cfg.searchCriteria,
  };
  return `${cfg.searchApi}?data=${encodeURIComponent(JSON.stringify(data))}`;
}

// "2026-07-04" → epoch ms (UTC for determinism).
/** @param {unknown} raw @returns {number | undefined} */
export function parseBeesiteDate(raw) {
  const m = typeof raw === 'string' ? raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return undefined;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const ms = Date.UTC(Number(m[1]), month - 1, day);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Map one search response to raw {id, title, url, location, postedAt} records.
 * @param {any} json
 * @returns {{total: number|null, rows: Array<{id:string,title:string,url:string,location:string,postedAt?:number}>}}
 */
export function parseSearchResult(json) {
  const sr = json?.SearchResult;
  const total = typeof sr?.SearchResultCountAll === 'number' ? sr.SearchResultCountAll : null;
  const items = Array.isArray(sr?.SearchResultItems) ? sr.SearchResultItems : [];
  const rows = [];
  for (const item of items) {
    const d = item?.MatchedObjectDescriptor;
    if (!d) continue;
    const id = item.MatchedObjectId != null ? String(item.MatchedObjectId) : String(d.PositionID || '');
    const title = String(d.PositionTitle || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const url = String(d.PositionURI || '').trim();
    if (!id || !title || !/^https?:\/\//i.test(url)) continue;
    const locs = Array.isArray(d.PositionLocation) ? d.PositionLocation : [];
    const cities = [];
    for (const l of locs) {
      const c = String(l?.CityName || '').trim();
      if (c && !cities.includes(c)) cities.push(c);
    }
    rows.push({
      id,
      title,
      url,
      location: cities.join(' / '),
      postedAt: parseBeesiteDate(d.PublicationStartDate),
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
  id: 'beesite',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    return resolveConfig({ api: url }) ? { url } : null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`beesite: cannot resolve search host for ${entry.name}`);

    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const maxPages = resolveMaxPages(entry);
    const jobs = [];
    const seen = new Set();
    let total = null;

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await wait(PAGE_DELAY_MS);
      const json = await ctx.fetchJson(buildSearchUrl(cfg, page * PAGE_SIZE + 1), {
        redirect: 'error',
        headers: { accept: 'application/json' },
      });
      const { total: pageTotal, rows } = parseSearchResult(json);
      if (total === null) total = pageTotal;
      if (rows.length === 0) break; // past the last page

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
      if (fresh === 0) break; // server ignored FirstItem (or we've looped)
      if (jobs.length >= MAX_JOBS) break;
      if (total !== null && (page + 1) * PAGE_SIZE >= total) break;
    }
    return jobs;
  },
};
