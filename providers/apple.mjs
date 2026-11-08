// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { coerceId } from './_ids.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Apple provider — jobs.apple.com is a React Router SSR app with NO usable JSON API.
//
// Why not the API: `POST /api/v1/search` exists (with an X-Apple-CSRF-Token from
// `GET /api/v1/CSRFToken`) but returns `{"res":{"searchResults":[],"totalRecords":0}}`
// for every payload shape, cookies and Referer included. Observing the live page in a
// browser shows the SPA never calls it — the search results are server-rendered and
// embedded in the HTML as a React Router hydration blob:
//
//   window.__staticRouterHydrationData = JSON.parse("{...}");
//     -> loaderData.search.searchResults   (20 jobs/page)
//     -> loaderData.search.totalRecords
//
// So this provider fetches the ordinary search URL over plain HTTP and reads that blob.
// Zero tokens, no browser required.
//
// Two complementary discovery modes, both deduped by URL. Neither has a default:
// a built-in list would be one user's search profile applied to everyone's scan
// (the occ.mjs precedent), so an entry needs at least one non-empty `queries` or
// `teams` value and throws without one. Example portals.yml entry:
//
//   - name: Apple
//     careers_url: https://jobs.apple.com/en-us/search
//     apple:
//       location: united-states-USA            # optional, this is the default
//       queries: ["business operations"]
//       teams: ["business-process-management-OPMFG-BPM"]
//     max_pages: 2
//
//   queries: text search with `sort=relevance`. Apple's text match is loose (it hits
//            job descriptions too, so "business operations" reports 2000+ records), but
//            relevance ranking puts the real title matches on page 1-2 — hence max_pages.
//   teams:   team-slug filter (e.g. business-process-management-OPMFG-BPM). Precise and
//            small. This is how Apple's non-obvious orgs are reachable at all: Apple has
//            no "Corporate Strategy" title — that work lives in Operations under
//            "Business Process Re-Engineering (BPR)".
//
// scan.mjs's title_filter still does the actual role selection; this provider only
// supplies candidates.

const ALLOWED_HOST = 'jobs.apple.com';
const BASE = 'https://jobs.apple.com';
const PAGE_SIZE = 20;

// No UA override. An earlier version sent a Chrome string on the theory that
// Apple 403s a bare UA; measured, it does not — the SSR route returns the same
// 313,692-byte page carrying the same hydration blob to career-ops' own
// User-Agent, to a bare `node`, and to that Chrome string. `_http.mjs` sets the
// shared identifying UA, which is what robots.txt rules and any rate limit
// should be able to name (RFC 9110 §10.1.5, RFC 9309 §2.2.1).

const DEFAULT_LOCATION = 'united-states-USA';
// `max_pages` on the ENTRY (not inside the `apple:` block), with a hard ceiling
// so one portals.yml line cannot turn into an unbounded walk, and a warning when
// the ceiling actually truncated a board — the convention in
// providers/ADDING_A_PROVIDER.md, reference implementation workday.mjs.
const DEFAULT_MAX_PAGES = 2;
const MAX_PAGES_CAP = 50; // 50 pages x 20 rows x (queries + teams) is already generous

// Pages after the first are paced, and every page fetch is retried through the
// shared helper (429/5xx/transport only, backoff + jitter, capped Retry-After).
const INTER_PAGE_DELAY_MS = 200;

/** @param {import('./_types.js').PortalEntry} entry */
function resolveMaxPages(entry) {
  const v = /** @type {any} */ (entry)?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

// Matches the escaped JSON string argument, honouring backslash escapes so an
// embedded \" inside the blob can't terminate the capture early.
const HYDRATION_RE = /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\("((?:\\.|[^"\\])*)"\)/;

/** @param {string} url */
function assertAppleUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`apple: invalid URL: ${url}`); }
  if (parsed.protocol !== 'https:') throw new Error(`apple: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST) throw new Error(`apple: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  return url;
}

/**
 * Pull loaderData.search out of the SSR hydration blob.
 * @param {string} html
 * @returns {{ searchResults?: unknown, totalRecords?: number } | null}
 */
export function parseHydration(html) {
  const m = HYDRATION_RE.exec(html || '');
  if (!m) return null;
  try {
    // The blob is a JSON string literal inside JSON.parse("..."), so it needs
    // unescaping (pass 1) before it parses as JSON (pass 2).
    const data = JSON.parse(JSON.parse(`"${m[1]}"`));
    return data?.loaderData?.search ?? null;
  } catch {
    return null;
  }
}

/** @param {any} r */
function locationOf(r) {
  const names = (Array.isArray(r.locations) ? r.locations : [])
    .map((/** @type {any} */ l) => l?.name)
    .filter(Boolean);
  const uniq = [...new Set(names)];
  if (uniq.length) return uniq.join('; ');
  return r.isMultiLocation ? 'Various Locations within United States' : '';
}

/**
 * Every segment comes from Apple's hydration payload, so every segment is
 * encoded: a raw "/", "?" or "#" in transformedPostingTitle would restructure
 * the URL, and a lone surrogate makes encodeURIComponent throw mid-board
 * (CodeRabbit, #4078). null drops that one posting, never the board.
 *
 * @param {any} r
 * @returns {string|null}
 */
function urlOf(r) {
  const id = safeEncodeURIComponent(r.id);
  const slug = safeEncodeURIComponent(r.transformedPostingTitle || 'role');
  const team = r.team?.teamCode ? safeEncodeURIComponent(r.team.teamCode) : '';
  if (id === null || slug === null || team === null) return null;
  return `${BASE}/en-us/details/${id}/${slug}${team ? `?team=${team}` : ''}`;
}

// Each search row carries a `type`, "REQ" or "PIPE". It is only in the
// hydration data, not in the visible job text, and the posting does not say
// what PIPE means, so the note claims no more than the label. It is a hint on
// the pipeline entry; nothing is filtered on it.
const PIPE_NOTE = 'Apple labels this posting PIPE: it may be a talent pipeline, not a specific opening';

/** @param {any} r @param {string} company @returns {Job|null} */
function toJob(r, company) {
  const url = urlOf(r);
  if (!url) return null;
  const posted = Date.parse(r.postDateInGMT || '');
  const externalId = coerceId(r.id);
  return {
    title: String(r.postingTitle || '').trim(),
    url,
    company,
    location: locationOf(r),
    // Apple's own posting id, the same value the detail URL is built from. It
    // survives a title edit, which the URL does not (#4076's Job.externalId).
    ...(externalId ? { externalId } : {}),
    ...(Number.isNaN(posted) ? {} : { postedAt: posted }),
    ...(r.type === 'PIPE' ? { note: PIPE_NOTE } : {}),
  };
}

/**
 * One search page, empty-vs-broken split per providers/ADDING_A_PROVIDER.md §2:
 * a present-and-empty `searchResults` array is a real "no matches" and yields
 * no jobs; a missing blob, or a `searchResults` that is absent or not an array,
 * is a changed page shape and throws. Read as zero, it would hide a dead
 * provider forever.
 *
 * @param {string} html
 * @param {string} url  the page fetched, named in the error
 * @param {string} company
 * @returns {{ jobs: Job[], rowCount: number, total: number }}
 */
export function parseSearchPage(html, url, company) {
  const search = parseHydration(html);
  if (!search) {
    throw new Error(`apple: no hydration blob in ${url} — Apple's SSR markup changed, or the page was not the search route`);
  }
  const rows = search.searchResults;
  if (!Array.isArray(rows)) {
    throw new Error(`apple: loaderData.search.searchResults in ${url} is ${rows === undefined ? 'missing' : `a ${rows === null ? 'null' : typeof rows}`}, not an array — Apple's search payload changed`);
  }
  /** @type {Job[]} */
  const jobs = [];
  for (const r of rows) {
    if (!r?.postingTitle || !r?.id) continue;
    const job = toJob(r, company);
    if (job) jobs.push(job);
  }
  return { jobs, rowCount: rows.length, total: Number(search.totalRecords) || 0 };
}

/** @param {Record<string, string>} params */
function searchUrl(params) {
  const qs = new URLSearchParams(params).toString();
  return `${BASE}/en-us/search?${qs}`;
}

/** @type {Provider} */
export default {
  id: 'apple',

  detect(entry) {
    const url = entry.careers_url || '';
    try {
      if (new URL(url).hostname === ALLOWED_HOST) return { url };
    } catch {
      // not a URL — fall through
    }
    return null;
  },

  async fetch(entry, ctx) {
    const cfg = /** @type {any} */ (entry).apple || {};
    const location = cfg.location || DEFAULT_LOCATION;
    const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
    const queries = list(cfg.queries);
    const teams = list(cfg.teams);
    if (!queries.length && !teams.length) {
      throw new Error(`apple: entry "${entry.name || 'Apple'}" needs a non-empty apple.queries or apple.teams list `
        + '(e.g. apple: { queries: ["business operations"] }) — there is no default search');
    }
    const entryMaxPages = resolveMaxPages(entry);
    // `ctx.maxPages` means verify-portals is probing, not scanning: walk one page
    // and one axis, so a liveness check costs one request instead of
    // queries x teams (providers/ADDING_A_PROVIDER.md).
    const ctxMaxPages = Number(/** @type {any} */ (ctx)?.maxPages);
    const probing = ctxMaxPages > 0;
    const maxPages = probing ? Math.min(entryMaxPages, ctxMaxPages) : entryMaxPages;
    /** @type {Record<string,string>[]} */
    const axes = [
      ...queries.map((q) => ({ search: q, location, sort: 'relevance' })),
      ...teams.map((t) => ({ location, team: t })),
    ];
    if (probing) axes.length = 1;

    /** @type {Map<string, Job>} */
    const byUrl = new Map();
    let truncated = false;

    /** Page through one search axis, stopping early on the last page. */
    const harvest = async (/** @type {Record<string,string>} */ base) => {
      for (let page = 1; page <= maxPages; page++) {
        const url = searchUrl({ ...base, page: String(page) });
        assertAppleUrl(url);
        if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
        let html;
        try {
          html = await fetchTextWithRetry(ctx, url, { redirect: 'error' });
        } catch (err) {
          // Recall-first during a scan: keep the axes already collected rather
          // than losing the whole board to one bad search. While PROBING the
          // rejection must propagate unwrapped, or verify-portals reads its own
          // request-budget sentinel as a broken board.
          if (probing) throw err;
          return;
        }
        // Throws on a changed page shape rather than returning what we have: a
        // silent 0 reads as "no matching roles" forever, where a descriptive
        // error names the page that stopped parsing (parseIbmResponse in
        // providers/ibm.mjs is the precedent).
        const { jobs, rowCount, total } = parseSearchPage(html, url, entry.name);
        for (const job of jobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
        if (rowCount < PAGE_SIZE || page * PAGE_SIZE >= total) return;
        if (page === maxPages && !probing) truncated = true;
      }
    };

    for (const axis of axes) await harvest(axis);
    if (truncated) {
      console.error(`⚠️  apple: ${entry.name} hit the ${maxPages}-page cap on at least one search — raise max_pages on this entry for more`);
    }

    return [...byUrl.values()];
  },
};
