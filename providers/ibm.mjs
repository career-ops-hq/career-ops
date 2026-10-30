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
// a short page, or until `max_pages` (default DEFAULT_MAX_PAGES) is reached.

import { fetchJsonWithRetry, sleep } from './_http.mjs';

const API_URL = 'https://www-api.ibm.com/search/api/v2';
const PAGE_SIZE = 30;
// IBM's `total` is unreliable (often capped at the page size), so the walk is
// bounded by these, never by the response. 20 pages is the 600-record cap this
// provider always had; an entry can raise it with `max_pages`.
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 300;
const PAGE_DELAY_MS = 200;

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

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'ibm',

  /**
   * Fetches and normalizes postings from IBM's careers search API.
   * @param {{ name?: string, max_pages?: number, ibm?: { country?: string, categories?: string[] } }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string}>>}
   */
  async fetch(entry, ctx) {
    const postFilter = buildPostFilter(entry.ibm || {});
    /** @type {Array<{title: string, url: string, company: string, location: string}>} */
    const out = [];

    const maxPages = resolveMaxPages(entry);
    // verify-portals' liveness probe sets `ctx.maxPages: 1`. Kept apart from
    // maxPages so the probe's cap never reads as a truncated board.
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pagesToFetch = Math.min(maxPages, ctxCap);

    // Why the walk stopped: 'complete' (a short page), 'cap' (max_pages ran out
    // on a full page) or 'fetch-error' (a later page failed after retries).
    let stopReason = 'complete';
    let page = 0;
    let lastPageFull = false;
    for (; page < pagesToFetch; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS, ctx);
      const from = page * PAGE_SIZE;
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

      let json;
      try {
        // redirect:'error' prevents SSRF via server-side redirects
        json = await fetchJsonWithRetry(ctx, API_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          redirect: 'error',
        });
      } catch (err) {
        // A failed first page is a broken board, not an empty one, and a probe
        // needs the rejection unwrapped (ProbePageBudgetReached). Past page one
        // in a real scan, keep what was collected and say so.
        if (page === 0 || ctxCap !== Infinity) throw err;
        console.error(`⚠️  ibm: ${entry.name} truncated at page ${page + 1} of ${maxPages} (${out.length} jobs): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }

      out.push(...parseIbmResponse(json));

      // Stop on the first short page; IBM's `total` is not trusted.
      lastPageFull = json.hits.hits.length >= PAGE_SIZE;
      if (!lastPageFull) break;
    }
    // Only a full page at the entry's own cap is a truncation. A short last
    // page ended the board on its own, and the probe's cap is not the entry's.
    if (stopReason === 'complete' && lastPageFull && page === maxPages) stopReason = 'cap';
    if (stopReason === 'cap') {
      console.error(`⚠️  ibm: ${entry.name} truncated at max_pages=${maxPages} (${out.length} jobs) — raise max_pages on this entry for more`);
    }

    return out;
  },
};
