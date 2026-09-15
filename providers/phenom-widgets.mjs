// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { resolveMaxPages, isProbing } from './_paging.mjs';

// Phenom (canvas) "widgets" provider — newer Phenom career sites expose a public
// JSON search via POST {host}/widgets with ddoKey "refineSearch":
//   POST https://{host}/widgets   body: {ddoKey:"refineSearch", searchString, from, size, ...}
//   -> { refineSearch: { hits: <total>, data: { jobs: [ {title, cityState, applyUrl, jobSeoUrl, ...} ] } } }
// Used by Activision Blizzard (careers.activisionblizzard.com) and Warner Bros.
// Discovery (careers.wbd.com). Distinct from the older HTML /search-jobs Phenom
// sites handled by phenom.mjs (e.g. Intuit).
//
// Config (portals.yml):
//   provider: phenom-widgets
//   phenom_widgets:
//     host: careers.activisionblizzard.com
//     locale: en_US            # optional
//     queries: ["strategy", "business operations", ...]

const PAGE_SIZE = 10;
const PAGE_CAP = 6;             // ≤60 results per query — bounded
const DEFAULT_QUERIES = [
  'corporate strategy', 'business operations', 'strategy', 'corporate development',
  'chief of staff', 'financial planning',
];

function getConfig(entry) {
  const c = entry.phenom_widgets || {};
  const queries = Array.isArray(c.queries) && c.queries.length ? c.queries : DEFAULT_QUERIES;
  return { host: c.host, locale: c.locale || 'en_US', queries };
}

function bodyFor(query, from, locale) {
  return JSON.stringify({
    ddoKey: 'refineSearch',
    globalSearchOptions: {},
    searchString: query,
    locationData: {},
    pageName: 'search-results',
    size: PAGE_SIZE,
    from,
    jdsource: 'facets',
    clearAll: false,
    jobs: true,
    counts: false,
    all_fields: ['category', 'country', 'state', 'city', 'cityState'],
    deviceType: 'desktop',
    locale,
  });
}

/** @type {Provider} */

export default {
  id: 'phenom-widgets',

  detect(entry) {
    return entry.phenom_widgets ? { url: `https://${getConfig(entry).host || ''}/widgets` } : null;
  },

  async fetch(entry, ctx) {
    const pageCap = resolveMaxPages(entry, ctx, PAGE_CAP);
    const { host, locale, queries } = getConfig(entry);
    if (!host) throw new Error(`phenom-widgets: "${entry.name}" needs phenom_widgets.host in portals.yml`);
    const url = `https://${host}/widgets`;
    const headers = { 'content-type': 'application/json', accept: 'application/json', referer: `https://${host}/` };
    const byId = new Map();
    for (const q of (isProbing(ctx) ? queries.slice(0, 1) : queries)) {
      for (let page = 0; page < pageCap; page++) {
        const json = /** @type {any} */ (await ctx.fetchJson(url, {
          method: 'POST', redirect: 'error', headers, body: bodyFor(q, page * PAGE_SIZE, locale),
        }));
        const data = json?.refineSearch?.data || {};
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];
        for (const j of jobs) {
          const id = j.jobId ?? j.reqId ?? j.jobSeqNo;
          if (id == null || !j.title || byId.has(id)) continue;
          const seo = j.jobSeoUrl ? (j.jobSeoUrl.startsWith('http') ? j.jobSeoUrl : `https://${host}${j.jobSeoUrl}`) : '';
          byId.set(id, {
            title: String(j.title).trim(),
            url: seo || j.applyUrl || `https://${host}/job/${id}`,
            company: entry.name,
            location: j.cityState || j.cityStateCountry || j.location || '',
            postedAt: (() => { const p = Date.parse(j.postedDate || j.dateCreated || ''); return Number.isNaN(p) ? undefined : p; })(),
          });
        }
        if (jobs.length < PAGE_SIZE) break;  // last page for this query
      }
    }
    return [...byId.values()];
  },
};
