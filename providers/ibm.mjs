// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// IBM careers provider — POSTs to IBM's careers search API (Elasticsearch-style;
// the same endpoint the ibm.com/careers/search UI calls). One endpoint serves
// every locale, so results are language-agnostic (lang: "zz").
//
// Configure via a `job_boards` (or `tracked_companies`) entry with `provider: ibm`
// and an optional `ibm:` block of facet filters:
//
//   - name: IBM Germany — SWE & Data
//     provider: ibm
//     ibm:
//       country: Germany                                   # field_keyword_05
//       categories: ["Software Engineering", "Data & Analytics"]  # field_keyword_08
//     enabled: true
//
// Omit `country` / `categories` to widen the search. Paginates via `from` until
// the result set is exhausted or MAX_RECORDS is reached.

const API_URL = 'https://www-api.ibm.com/search/api/v2';
const PAGE_SIZE = 30;
const MAX_RECORDS = 600; // safety cap on pagination

/**
 * Builds the Elasticsearch post_filter from the entry's `ibm:` config.
 * @param {{ country?: string, categories?: string[] }} cfg
 */
export function buildPostFilter(cfg) {
  const must = [];
  // Sanitize operator config: keep only non-empty trimmed strings so a stray/
  // mistyped entry can't inject empty or non-string filter terms.
  const categories = Array.isArray(cfg.categories)
    ? cfg.categories.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim())
    : [];
  if (categories.length) {
    must.push({ bool: { should: categories.map(c => ({ term: { field_keyword_08: c } })) } });
  }
  const country = typeof cfg.country === 'string' ? cfg.country.trim() : '';
  if (country) must.push({ term: { field_keyword_05: country } });
  return { bool: { must } };
}

/**
 * Normalizes one page of the IBM careers API response into job entries.
 * Throws if the response doesn't carry the expected `hits.hits[]` shape, so a
 * silent endpoint change surfaces as a hard error instead of empty results.
 * @param {any} json - A single API response page.
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseIbmResponse(json) {
  const hits = json && json.hits && Array.isArray(json.hits.hits) ? json.hits.hits : null;
  if (!hits) {
    throw new Error(`ibm: unexpected API response — expected hits.hits[], got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
  }

  const out = [];
  for (const h of hits) {
    const s = (h && h._source) || {};
    if (typeof s.title !== 'string' || s.title.trim() === '') continue;
    if (typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url.trim())) continue;
    const loc = typeof s.field_keyword_19 === 'string' ? s.field_keyword_19.trim() : '';
    const mode = typeof s.field_keyword_17 === 'string' ? s.field_keyword_17.trim() : '';
    out.push({
      title: s.title.trim(),
      url: s.url.trim(),
      company: 'IBM',
      location: [loc, mode].filter(Boolean).join(' · '),
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'ibm',

  /**
   * Fetches and normalizes postings from IBM's careers search API.
   * @param {{ name?: string, ibm?: { country?: string, categories?: string[] } }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string}>>}
   */
  async fetch(entry, ctx) {
    const postFilter = buildPostFilter(entry.ibm || {});
    /** @type {Array<{title: string, url: string, company: string, location: string}>} */
    const out = [];

    for (let from = 0; from < MAX_RECORDS; from += PAGE_SIZE) {
      const body = {
        appId: 'careers',
        scopes: ['careers2'],
        query: { bool: { must: [] } },
        post_filter: postFilter,
        size: PAGE_SIZE,
        from,
        sort: [{ _score: 'desc' }, { pageviews: 'desc' }],
        lang: 'zz',
        localeSelector: {},
        sm: { query: '', lang: 'zz' },
        _source: ['_id', 'title', 'url', 'description', 'language',
          'field_keyword_05', 'field_keyword_08', 'field_keyword_17',
          'field_keyword_18', 'field_keyword_19'],
      };

      // redirect:'error' prevents SSRF via server-side redirects
      const json = await ctx.fetchJson(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
      });

      out.push(...parseIbmResponse(json));

      // Stop on the first short page. IBM's `total` is unreliable (often
      // capped at the page size), so don't trust it for the loop bound —
      // MAX_RECORDS is the hard ceiling.
      if (json.hits.hits.length < PAGE_SIZE) break;
    }

    return out;
  },
};
