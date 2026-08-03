// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Radancy (TalentBrew) provider — the career sites Radancy hosts for large
// employers (careers.munichre.com and its ERGO brands, plus many others). The
// search-results page is SERVER-rendered and paginates over bare HTTP:
//
//   GET {origin}/{lang}/search-jobs?p={N}      # 1-based; past-the-end → empty
//
// Each posting is one <li class="search-results-list__item …"> holding:
//   <a class="search-results-list__job-link …" href="/{lang}/job/{city}/{slug}/{cat}/{id}"
//      data-job-id="{id}">{Title}</a>
//   <li class="…__job-info--location"><i></i><span>{City, Country}</span></li>
// The generic `search-results-list__` class prefix is the stable TalentBrew
// markup (a second, module-numbered `job-list-NN-list__` prefix rides alongside
// it and varies per site) — we anchor on the generic one for portability.
//
// The list carries no posting date, so postedAt is omitted. detect() can't be
// host-based (branded domains), so tenants are wired with an explicit
// `provider: radancy` + a search-jobs `api:`/`careers_url`.
//
// ── Two markup generations, two transports ────────────────────────────────────
//
// (a) MODERN markup — <li class="search-results-list__item"> with a
//     `search-results-list__job-link` anchor. Parsed by parseModernResults().
//
// (b) LEGACY markup — bare <li> holding the anchor itself, no list-item class
//     to split on (seen live on careers.unitedhealthgroup.com and
//     www.kaiserpermanentejobs.org):
//       <li><a href="/job/{city}/{slug}/{org}/{id}" data-job-id="{id}">
//            <h2>{Title}</h2>
//            <span class="job-id job-info">{reqNo}</span>      (UHG only)
//            <span class="job-location">{City, State}</span>
//          </a>
//          <button class="js-save-job-btn" data-job-id="{id}">…</button></li>
//     Parsed by parseLegacyResults(). The save-job <button> repeats data-job-id,
//     which is why the parser anchors on <a> and dedupes by id.
//
// TRANSPORT: the plain `?p=N` HTML page is the fallback, not the preference —
// on these tenants it is catastrophically wasteful. A UHG results page is
// ~8.3 MB of which only ~10 KB is jobs: the other 8.25 MB is a ~15,000-<li>
// facet list repeated on every page. Walking all 393 pages that way moves
// ~3.2 GB to collect 5,889 postings.
//
// The same site exposes a JSON fragment endpoint that the page's own JS uses:
//   GET {listUrl}/results?…&SearchResultsModuleName=Search Results&RecordsPerPage=100
//   → {"filters": "<html>", "results": "<html>", "hasJobs": true, …}
// Two things make it dramatically cheaper, and both are required:
//   1. SearchResultsModuleName MUST be sent — without it the server returns
//      hasContent:false and an EMPTY results string (silent, not an error).
//   2. SearchFiltersModuleName MUST BE OMITTED — sending it re-attaches the
//      8.25 MB facet blob. Omitted ⇒ filters:"" and the response is ~82 KB.
// With RecordsPerPage=100 that turns UHG into 59 requests / ~4.8 MB total —
// roughly a 660x reduction in bytes moved versus the ?p=N walk.
//
// The returned fragment re-embeds <section id="search-results"
// data-total-results data-total-pages …>, so pagination is bounded by the
// server's own count instead of probing until an empty page.

const MAX_PAGES = 200; // safety cap (~15/page ⇒ up to ~3000 postings)
const DEFAULT_MAX_JOBS = 2000; // default cap on total postings pulled
const PAGE_DELAY_MS = 150; // polite pacing — full walks are >100 sequential requests

// Page size for the JSON fragment transport. 100 is honored live by both known
// legacy tenants (UHG, Kaiser); the HTML page hard-codes 15.
const FRAGMENT_RECORDS_PER_PAGE = 100;

// Minimal HTML entity decoder — mirrors the other HTML-scraping providers.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // String.fromCodePoint throws RangeError outside 0..0x10FFFF or on a lone
      // surrogate half — a malformed/adversarial entity must degrade to the
      // original text, never crash the whole parse.
      const valid = Number.isFinite(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Resolve the search-jobs list URL from api:/careers_url; default /en. */
export function resolveListUrl(entry) {
  const raw = entry.api || entry.careers_url || '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (/\/search-jobs\/?$/.test(u.pathname)) return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  const lang = (u.pathname.match(/^\/([a-z]{2})(\/|$)/) || [])[1] || 'en';
  return `${u.origin}/${lang}/search-jobs`;
}

/**
 * Build the JSON fragment URL for a given 1-based page.
 *
 * SearchFiltersModuleName is deliberately absent — see the transport note at the
 * top of this file. Adding it back re-attaches a multi-megabyte facet blob to
 * every page and is the single most expensive mistake available here.
 *
 * @param {string} listUrl Base search-jobs URL (no trailing slash).
 * @param {number} page 1-based page number.
 * @param {number} recordsPerPage
 */
export function buildFragmentUrl(listUrl, page, recordsPerPage = FRAGMENT_RECORDS_PER_PAGE) {
  const q = new URLSearchParams({
    ActiveFacetID: '0',
    CurrentPage: String(page),
    RecordsPerPage: String(recordsPerPage),
    Distance: '50',
    RadiusUnitType: '0',
    Keywords: '',
    Location: '',
    ShowRadius: 'False',
    IsPagination: 'True',
    CustomFacetName: '',
    FacetTerm: '',
    FacetType: '0',
    SearchResultsModuleName: 'Search Results',
    SortCriteria: '0',
    SortDirection: '0',
    SearchType: '5',
  });
  return `${listUrl}/results?${q.toString()}`;
}

/**
 * Read the server's own result/page totals out of a results fragment.
 * @param {string} html
 * @returns {{totalResults: number|null, totalPages: number|null}}
 */
export function readFragmentTotals(html) {
  if (typeof html !== 'string') return { totalResults: null, totalPages: null };
  const num = (re) => {
    const m = html.match(re);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  return {
    totalResults: num(/data-total-results="(\d+)"/),
    totalPages: num(/data-total-pages="(\d+)"/),
  };
}

/**
 * Parse the LEGACY markup: the anchor IS the row, with no list-item class to
 * split on. Anchored on <a> carrying both data-job-id and a /job/ href, so the
 * sibling `js-save-job-btn` <button> (which repeats data-job-id) can't produce
 * a phantom row. Attribute order is not assumed.
 *
 * @param {string} html @param {string} origin
 */
export function parseLegacyResults(html, origin) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  // Anchors never nest, so a non-greedy run to </a> is a safe row boundary.
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const a of anchors) {
    const attrs = a[1];
    const inner = a[2];
    const idM = attrs.match(/data-job-id="([^"]+)"/i);
    if (!idM) continue;
    const hrefM = attrs.match(/href="([^"]+)"/i);
    if (!hrefM) continue;
    const href = decodeEntities(hrefM[1]);
    if (!/\/job\//.test(href)) continue;
    const id = idM[1];
    if (seen.has(id)) continue;

    // Title lives in the heading. Falling back to the anchor's full text would
    // swallow the req-number and location spans (UHG renders both inside the
    // anchor), so strip element content first and only then accept bare text.
    const headM = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const title = clean(headM ? headM[1] : inner.replace(/<span[\s\S]*?<\/span>/gi, ' '));
    if (!title) continue;

    let url;
    try {
      url = new URL(href, origin).href;
    } catch {
      continue;
    }
    const locM = inner.match(/class="[^"]*job-location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    seen.add(id);
    out.push({ id, title, url, location: locM ? clean(locM[1]) : '' });
  }
  return out;
}

/**
 * Parse one search-results page (or results fragment) into raw
 * {id, title, url, location} records. Tries the modern markup first so existing
 * tenants keep their exact behavior, then falls back to the legacy markup.
 * @param {string} html @param {string} origin
 */
export function parseResults(html, origin) {
  const modern = parseModernResults(html, origin);
  return modern.length ? modern : parseLegacyResults(html, origin);
}

/**
 * Parse the MODERN `search-results-list__item` markup.
 * @param {string} html @param {string} origin
 */
export function parseModernResults(html, origin) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  // Split on the stable generic list-item class; slice(0) is the page head.
  const blocks = html.split(/<li class="search-results-list__item/).slice(1);
  for (const block of blocks) {
    const link = block.match(/search-results-list__job-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const href = decodeEntities(link[1]);
    const dataIdM = block.match(/data-job-id="([^"]+)"/);
    const hrefIds = [...href.matchAll(/\/(\d+)(?=[/?#]|$)/g)];
    const id = dataIdM ? dataIdM[1] : (hrefIds.length ? hrefIds[hrefIds.length - 1][1] : href);
    if (seen.has(id)) continue;
    const title = clean(link[2]);
    if (!title) continue;
    let url;
    try {
      url = new URL(href, origin).href;
    } catch {
      continue;
    }
    const locM = block.match(/__job-info--location[\s\S]*?<span>([\s\S]*?)<\/span>/);
    seen.add(id);
    out.push({ id, title, url, location: locM ? clean(locM[1]) : '' });
  }
  return out;
}

/** Resolve the page cap: positive integer `max_pages`, else default. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES);
  return MAX_PAGES;
}

/** Resolve the total-postings cap: positive integer `max_jobs`, else default. */
function resolveMaxJobs(entry) {
  const v = entry?.max_jobs;
  if (Number.isInteger(v) && v > 0) return v;
  return DEFAULT_MAX_JOBS;
}

/** @type {Provider} */
export default {
  id: 'radancy',

  detect() {
    // Branded hosts carry no stable Radancy token in the URL — wire explicitly
    // with `provider: radancy`. No auto-detection.
    return null;
  },

  async fetch(entry, ctx) {
    const listUrl = resolveListUrl(entry);
    if (!listUrl) throw new Error(`radancy: cannot resolve search-jobs URL for ${entry.name}`);
    const origin = new URL(listUrl).origin;

    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const maxPages = resolveMaxPages(entry);
    const maxJobs = resolveMaxJobs(entry);
    const jobs = [];
    const seen = new Set();

    // ── Preferred transport: the JSON results fragment ───────────────────────
    // Tried first because on legacy-markup tenants the ?p=N HTML page carries a
    // multi-megabyte facet blob per page (see the transport note up top). Any
    // failure here — non-JSON, no results, endpoint absent — falls through to
    // the HTML walk below, so tenants without this endpoint are unaffected.
    if (typeof ctx.fetchJson === 'function') {
      try {
        const first = await ctx.fetchJson(buildFragmentUrl(listUrl, 1), {
          headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        });
        const firstHtml = typeof first?.results === 'string' ? first.results : '';
        const firstRows = firstHtml ? parseResults(firstHtml, origin) : [];
        if (firstRows.length) {
          const { totalResults, totalPages } = readFragmentTotals(firstHtml);
          // Bound by the server's own page count when it gives one; the local
          // caps still apply so a bogus total can't drive an unbounded walk.
          const lastPage = Math.min(totalPages ?? maxPages, maxPages);
          const push = (rows) => {
            let fresh = 0;
            for (const row of rows) {
              if (seen.has(row.id)) continue;
              seen.add(row.id);
              fresh++;
              jobs.push({ title: row.title, url: row.url, company: entry.name, location: row.location });
            }
            return fresh;
          };
          push(firstRows);

          for (let page = 2; page <= lastPage && jobs.length < maxJobs; page++) {
            await wait(PAGE_DELAY_MS);
            let rows;
            try {
              const json = await ctx.fetchJson(buildFragmentUrl(listUrl, page), {
                headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
              });
              const frag = typeof json?.results === 'string' ? json.results : '';
              rows = frag ? parseResults(frag, origin) : [];
            } catch {
              break; // keep what we have; a mid-walk blip shouldn't discard earlier pages
            }
            if (rows.length === 0) break;
            if (push(rows) === 0) break; // server clamped the page — stop
          }

          // Never truncate silently (AGENTS.md): say what was left behind — and
          // report the count actually RETURNED. `jobs.length` is the pre-slice
          // buffer: the page loop only checks `jobs.length < maxJobs` before
          // fetching, so the final page can push the buffer past the cap (100
          // rows landing on a buffer of 1,950 with max_jobs 2,000). Logging the
          // pre-slice length would overstate delivery in the one message whose
          // entire job is to be accurate about what the caller did not get.
          const returned = Math.min(jobs.length, maxJobs);
          if (totalResults && returned < totalResults) {
            console.error(
              `⚠️  radancy: ${entry.name} truncated at ${returned} of ${totalResults} postings`
              + ` — raise max_jobs/max_pages on this entry for more`,
            );
          }
          return jobs.slice(0, maxJobs);
        }
      } catch {
        // fall through to the HTML transport
      }
    }

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await wait(PAGE_DELAY_MS);
      let rows;
      try {
        const html = await ctx.fetchText(`${listUrl}?p=${page}`, { headers: { accept: 'text/html' } });
        rows = parseResults(html, origin);
      } catch {
        break; // keep jobs collected so far — a transient mid-scan failure shouldn't discard earlier pages
      }
      if (rows.length === 0) break; // past the last page

      let fresh = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        fresh++;
        jobs.push({ title: row.title, url: row.url, company: entry.name, location: row.location });
      }
      // No new ids → the server clamped ?p= to the last page (or looped). Stop.
      if (fresh === 0) break;
      if (jobs.length >= maxJobs) break;
    }
    return jobs.slice(0, maxJobs);
  },
};
