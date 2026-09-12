// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { randomUUID } from 'node:crypto';
import { decodeEntities } from './_html-entities.mjs';
import { fetchJsonWithRetry, fetchTextWithRetry } from './_http.mjs';

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
// server's own page count instead of probing until an empty page.
//
// Neither number is trusted as proof of completeness, for two independent,
// live-verified reasons:
//
// 1. `data-total-results` can simply be wrong. Checked end-to-end against 9
//    live tenants: 5 collected exactly as many unique postings as they
//    claimed, but 4 (a small one and a huge one both included) fell short by
//    10-56% with no duplicate rows anywhere — the banner overstates what the
//    tenant's own search index actually serves, on both the JSON and the
//    HTML transport equally. `data-total-pages`, by contrast, matched the
//    walk's own natural end (a short or empty final page) in every one of
//    these 9 cases — but not universally: a separate, much larger tenant
//    claims 229 pages while its backend silently refuses anything past 100
//    (see the empty-page comment in the fetch loop below). So the page count
//    is used only to bound the walk, never as proof it's complete — the
//    walk's own natural end (an empty or short page) is what actually
//    decides that, with our own caps still applied via Math.min on top. The
//    results count is display-only and never drives a stop/warn decision —
//    comparing accumulated postings against it would false-positive on a
//    majority of tenants.
// 2. On one tenant (careers.munichre.com), some `CurrentPage` values behind
//    the JSON fragment endpoint intermittently replayed a stale response —
//    the same posting would show up again several pages later while another
//    was never served at all — reproducible on 9/9 consecutive runs. The
//    `?p=N` HTML transport, hitting the same underlying data over the same
//    window, showed zero such repeats. Isolated to a caching layer in front
//    of the JSON route specifically: `Cache-Control`/`Pragma: no-cache`
//    request headers made no difference (9/9 still broken), but a random
//    per-request query parameter — forcing a cache-key miss — made it 0/4
//    broken. Applied to every JSON fragment request below; harmless on
//    tenants that never had the problem (verified against 11 live tenants,
//    matching page-1 output with/without it in every case that didn't
//    already fail on its own, e.g. AT&T's oversized security headers).

// Safety cap on page count, shared by both transports below — but they walk
// pages of different sizes: ~3,000 postings via the HTML `?p=N` fallback
// (15/page, hard-coded by the site), ~20,000 via the preferred JSON fragment
// transport (100/page — see MAX_JOBS_CAP, the more generous of the two).
const MAX_PAGES = 200;
const DEFAULT_MAX_JOBS = 2000; // default cap on total postings pulled
const PAGE_DELAY_MS = 150; // polite pacing — full walks are >100 sequential requests

// Page size for the JSON fragment transport. 100 is honored live by both known
// legacy tenants (UHG, Kaiser); the HTML page hard-codes 15.
const FRAGMENT_RECORDS_PER_PAGE = 100;

// A user-supplied `max_jobs` is not otherwise bounded by anything but
// `max_pages` (itself capped at MAX_PAGES): a garbage value here doesn't risk
// an unbounded walk, but it also isn't caught the way an equally garbage
// `max_pages` already is (`resolveMaxPages` clamps via Math.min). Cap it
// explicitly for the same reason `MAX_PAGES` exists — defense against an
// absurd config value, not a known real-world ceiling. Set at the JSON
// transport's own true ceiling (see the MAX_PAGES comment above).
const MAX_JOBS_CAP = MAX_PAGES * FRAGMENT_RECORDS_PER_PAGE;

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
 * `_` is a random cache-buster, not a documented TalentBrew parameter — see
 * the transport note at the top of this file for why. It must be unique per
 * call (not, say, derived from `page`): a caching layer keying on the URL
 * still produces a stable, wrong, repeatable mapping if the extra parameter
 * is itself deterministic.
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
    _: randomUUID(),
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
export function resolveMaxJobs(entry) {
  const v = entry?.max_jobs;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_JOBS_CAP);
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
    // ctx.maxPages is set only by verify-portals.mjs's bounded liveness probe
    // (never during a real scan). While probing: cap the walk to that budget
    // (SHOULD — reference providers/workday.mjs) so a healthy large board
    // doesn't burn the probe's whole request allotment on one tenant, and
    // propagate any ctx.fetch* rejection unwrapped instead of absorbing it
    // into the normal partial-result handling (MUST). verify-portals
    // identifies its own budget-exhaustion sentinel, ProbePageBudgetReached,
    // by `instanceof`, and reads it as "endpoint live, count unknown"; a
    // per-page catch that swallows it into a normal stopReason/break instead
    // misreports a healthy board as broken. Reference: providers/vdab.mjs.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const effectiveMaxPages = probing ? Math.min(maxPages, ctx.maxPages) : maxPages;
    const jobs = [];
    const seen = new Set();
    // Proof of life across BOTH transports: any resolved request — including a
    // fragment 200 that parses to zero rows — proves the tenant is reachable,
    // so a later HTML page-1 failure must not read as "unreachable".
    let succeededOnce = false;

    // ── Preferred transport: the JSON results fragment ───────────────────────
    // Tried first because on legacy-markup tenants the ?p=N HTML page carries a
    // multi-megabyte facet blob per page (see the transport note up top). Any
    // failure here — non-JSON, no results, endpoint absent — falls through to
    // the HTML walk below, so tenants without this endpoint are unaffected.
    if (typeof ctx.fetchJson === 'function') {
      try {
        const first = await fetchJsonWithRetry(ctx, buildFragmentUrl(listUrl, 1), {
          redirect: 'error',
          headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        });
        const firstIsString = typeof first?.results === 'string';
        const firstHtml = firstIsString ? first.results : '';
        const firstRows = firstHtml ? parseResults(firstHtml, origin) : [];
        // Proof of life only for a WELL-FORMED fragment response: a string
        // `results` — even "" (zero rows) — counts, but a missing/non-string
        // `results` or a response that crashes parsing leaves this false, so
        // a failing HTML fallback still surfaces the malformed initial
        // response instead of returning [].
        if (firstIsString) succeededOnce = true;
        if (firstRows.length) {
          const { totalResults, totalPages } = readFragmentTotals(firstHtml);
          // Bound by the server's own page count when it gives one; the local
          // caps still apply so a bogus total can't drive an unbounded walk.
          const lastPage = Math.min(totalPages ?? effectiveMaxPages, effectiveMaxPages);
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

          // Why the walk stopped, driving the warning below — never the
          // results-count mismatch (see the transport note up top: a source
          // total falling short of what pagination collected is routine here
          // and does not mean career-ops left postings behind).
          let stopReason = 'complete';
          let page = 2;
          for (; page <= lastPage && jobs.length < maxJobs; page++) {
            await wait(PAGE_DELAY_MS);
            let rows;
            try {
              const json = await fetchJsonWithRetry(ctx, buildFragmentUrl(listUrl, page), {
                redirect: 'error',
                headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
              });
              // A STRING `results` — even one that parses to zero rows, which
              // is what a genuine last page looks like live (Walgreens' own
              // past-the-end page answers hasJobs:false with a non-empty
              // shell string that simply contains no job rows) — is the only
              // form the documented "no more jobs" signal takes. A missing,
              // null, or wrong-typed `results` has never been observed as
              // that signal, so it's a malformed response, not an empty
              // page: silently coercing it to [] would end the walk early
              // exactly like a real empty page does, with no error raised.
              if (typeof json?.results !== 'string') {
                throw new Error(`radancy: unexpected fragment response shape at page ${page} (results is not a string)`);
              }
              rows = json.results ? parseResults(json.results, origin) : [];
            } catch (err) {
              if (probing) throw err; // propagate ProbePageBudgetReached (or any rejection) unwrapped
              console.error(
                `⚠️  radancy: ${entry.name} truncated at page ${page} of ${lastPage}`
                + ` (${jobs.length} jobs): ${err.message}`,
              );
              stopReason = 'error';
              break; // keep what we have; a mid-walk blip shouldn't discard earlier pages
            }
            // A clean, structured empty page (`rows.length === 0`, not a
            // thrown error) is a legitimate natural stop even when it lands
            // well short of `totalResults`/`totalPages` — no different from
            // any other tenant undercounting. Observed live on one very
            // large tenant landing exactly at offset 10,000 (100 pages of
            // 100 — the default Elasticsearch/Solr `max_result_window`);
            // unlike `workday.mjs`'s analogous, multi-tenant-confirmed
            // `WORKDAY_OFFSET_CEILING`, this has one confirmed instance and
            // TalentBrew's JSON fragment API exposes no documented
            // facet-style split to route around it, so there is nothing to
            // detect-and-recover here — the empty page already handles it.
            if (rows.length === 0) break; // source ran out on its own — complete
            if (push(rows) === 0) break; // fully-duplicate page — source ran out — complete
          }
          // The loop only reaches here without an early break when it walked
          // every page up to `lastPage`. That is only OUR cap, not the
          // source's own end, when `lastPage` is our effective ceiling
          // (`max_pages`, or `ctx.maxPages` while probing) and the source
          // either gave no page count or claimed more pages than that.
          if (stopReason === 'complete' && page > lastPage && lastPage === effectiveMaxPages
            && (totalPages == null || totalPages > effectiveMaxPages)) {
            stopReason = 'cap';
          }
          // `jobs.length >= maxJobs` alone isn't enough: a tenant whose real
          // total happens to exactly fill the pages already walked (natural
          // end reached, `page > lastPage`) would false-positive into 'cap'
          // here even though nothing was left unfetched. Only the overshoot
          // case (a page pushed the buffer strictly past maxJobs in one
          // jump — real fetched rows that the final slice below still has to
          // drop) is unconditionally a cap; an exact match only counts when
          // the loop stopped WITH page budget still available (`page <=
          // lastPage`) — i.e. max_jobs itself is what kept a further page
          // from being tried, not a coincidence of how many rows fit.
          if (stopReason === 'complete'
            && (jobs.length > maxJobs || (jobs.length === maxJobs && page <= lastPage))) {
            stopReason = 'cap';
          }

          // Never truncate silently on OUR OWN limit (AGENTS.md) — report the
          // count actually RETURNED. `jobs.length` is the pre-slice buffer:
          // the page loop only checks `jobs.length < maxJobs` before
          // fetching, so the final page can push the buffer past the cap (100
          // rows landing on a buffer of 1,950 with max_jobs 2,000). Logging
          // the pre-slice length would overstate delivery in the one message
          // whose entire job is to be accurate about what the caller did not
          // get. `totalResults`, when present, is context only here — the
          // decision to warn never depends on it (see the transport note).
          // Never while probing (SHOULD): the probe's own ctx.maxPages is
          // what bounded this, not the tenant's real config, and "raise
          // max_pages" is not advice a liveness check has any use for.
          if (!probing && stopReason === 'cap') {
            const returned = Math.min(jobs.length, maxJobs);
            console.error(
              `⚠️  radancy: ${entry.name} truncated at ${returned}${totalResults ? ` of ${totalResults}` : ''} jobs`
              + ` (max_pages/max_jobs reached) — raise max_jobs/max_pages on this entry for more`,
            );
          }
          return jobs.slice(0, maxJobs);
        }
      } catch (err) {
        // succeededOnce can only still be false here (the one JSON request
        // attempted above is what just threw), so this is already covered
        // by the HTML loop's own !succeededOnce check below — propagated
        // explicitly anyway so a probe's budget sentinel doesn't depend on
        // that chain of reasoning to be read correctly.
        if (probing) throw err;
        // fall through to the HTML transport
      }
    }

    // A page-1 failure on the fallback transport — when NO request on either
    // transport ever resolved — means the board is unreachable, not empty:
    // THROW so scan/portal-health record a failure instead of "live but empty"
    // (meituan/tencent idiom). A resolved fragment request above, or a mid-scan
    // failure here, keeps partials instead.
    for (let page = 1; page <= effectiveMaxPages; page++) {
      if (page > 1) await wait(PAGE_DELAY_MS);
      let rows;
      try {
        const html = await fetchTextWithRetry(ctx, `${listUrl}?p=${page}`, { redirect: 'error', headers: { accept: 'text/html' } });
        rows = parseResults(html, origin);
      } catch (err) {
        if (probing) throw err; // propagate ProbePageBudgetReached (or any rejection) unwrapped
        if (!succeededOnce) throw err;
        break; // keep jobs collected so far — a transient mid-scan failure shouldn't discard earlier pages
      }
      succeededOnce = true;
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
