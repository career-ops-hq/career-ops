// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { decodeEntities } from './_html-entities.mjs';

// Jobvite provider — scrapes the public, server-rendered careers page HTML.
// Used by ~3,000 companies across a wide range of industries.
//
//   GET https://jobs.jobvite.com/{companyId}/jobs
//   … <table class="jv-job-list"> … <td class="jv-job-list-name">
//       <a href="/{companyId}/job/{jobId}">{Title}</a></td>
//     <td class="jv-job-list-location">{City, Country}</td> … </table> …
//
// Auto-detects from careers_url pattern:
//   https://jobs.jobvite.com/{companyId}
//   https://jobs.jobvite.com/{companyId}/jobs
// The companyId is the slug segment immediately after the host.
//
// SSRF stance: the careers URL is rebuilt from the extracted slug only, never
// from a user-supplied path; assertJobviteUrl() pins the hostname to
// jobs.jobvite.com before every fetch. Per-job URLs are resolved against that
// origin when relative, or accepted as-is when already absolute (e.g. a
// branded-domain apply link) — either form is restricted to http:/https: and
// is display-only, never fetched here.
//
// /{companyId}/jobs is sometimes just a search-splash landing page rather
// than the actual listing (a theme quirk, not a naming inconsistency — see
// buildSearchUrl below); when the first fetch comes up ambiguous, fetch()
// retries once against /{companyId}/search, which is also slug-derived and
// gets the same SSRF pinning.
//
// A tenant on a branded custom domain doesn't serve jobs.jobvite.com content
// at all by default — every request 302s to the tenant's own site. Every
// request this provider makes carries `?fr=true&nl=1` (see withFrameParams)
// to route around that instead, reproduced from that branded page's own
// iframe embed rather than a documented API.
//
// Wire in via a `tracked_companies:` entry with:
//   careers_url: https://jobs.jobvite.com/{companyId}
// or explicitly with:
//   provider: jobvite
//   careers_url: https://jobs.jobvite.com/{companyId}/jobs

const ALLOWED_HOST = 'jobs.jobvite.com';
const ORIGIN = `https://${ALLOWED_HOST}`;

/** @param {string} url */
function assertJobviteUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobvite: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:')
    throw new Error(`jobvite: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST)
    throw new Error(`jobvite: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  return url;
}

// Looped to a fixed point rather than a single pass: a single global replace
// only removes non-overlapping matches in one left-to-right sweep, which
// CodeQL flags as an incomplete sanitizer (js/incomplete-sanitization) since
// adversarial nesting can leave a `<`-fragment behind. Repeating until the
// string stops changing removes any tag that pass N reveals.
function stripTags(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, ' ');
  } while (s !== prev);
  return s;
}

/** @param {string} s */
function clean(s) {
  // Strip the "New" ribbon badge some tenants inline into the title text
  // (e.g. <span class="jv-tag-new">New</span>, or with a tenant class token
  // alongside it, e.g. <span class="ml2 jv-tag-new">New</span>) before
  // flattening tags. A lookahead checks for the class token rather than
  // anchoring on attribute order, since `class` isn't guaranteed to be the
  // span's first attribute (e.g. a `data-*` attr before it).
  const noBadge = s.replace(/<span\b(?=[^>]*\bclass="[^"]*\bjv-tag-new\b[^"]*")[^>]*>[\s\S]*?<\/span>/gi, '');
  return decodeEntities(stripTags(noBadge)).replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
}

/**
 * Extract the companyId slug from a careers_url or (legacy) api URL.
 *
 * Accepted forms:
 *   https://jobs.jobvite.com/{slug}
 *   https://jobs.jobvite.com/{slug}/jobs
 *   https://jobs.jobvite.com/api/company/{slug}/jobs  (legacy explicit api: field)
 *
 * Returns null for any non-Jobvite or malformed URL.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveCompanyId(entry) {
  const raw = typeof entry.api === 'string' && entry.api
    ? entry.api
    : typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_HOST) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);

  // legacy api: https://jobs.jobvite.com/api/company/{slug}/jobs → ['api','company',slug,'jobs']
  const apiIdx = segments.indexOf('company');
  if (apiIdx !== -1 && segments[apiIdx + 1]) {
    return segments[apiIdx + 1];
  }

  // careers_url: https://jobs.jobvite.com/{slug}[/jobs] → [slug] or [slug, 'jobs']
  if (segments.length >= 1 && segments[0] !== 'api') {
    return segments[0];
  }

  return null;
}

/** @param {string} companyId */
function buildCareersUrl(companyId) {
  return `${ORIGIN}/${encodeURIComponent(companyId)}/jobs`;
}

// A tenant configured with a branded custom domain doesn't serve its job
// list from jobs.jobvite.com directly — visiting /{slug}/jobs there 302s
// straight to the tenant's own site (e.g. synergybis.com), which is why
// fetch() used to give up on these entirely. That branded page embeds the
// real listing back from jobs.jobvite.com in an <iframe>, and the iframe's
// own src is what tips this off: `?fr=true&nl=1` ("framed" + the same
// newsletter-banner param /jobs already carries) makes jobs.jobvite.com
// render the listing directly instead of issuing the redirect — reproduced
// from a live branded tenant's actual iframe src, not a documented API.
// Appending it to every request, not just detected branded-domain tenants,
// was verified to be a no-op on a normal tenant's /jobs or /search response
// (same markup, same job count) — so there's no need to special-case which
// tenants actually require it, or to try distinguishing a redirect failure
// from any other fetch error to decide whether to retry with it.
/** @param {string} url */
function withFrameParams(url) {
  const u = new URL(url);
  u.searchParams.set('fr', 'true');
  u.searchParams.set('nl', '1');
  return u.href;
}

// The "classic" theme's /{slug}/jobs is a full listing, but on the
// client-rendered ("faceted search") theme it's often just a search-splash
// landing page — a hero, a filter form, maybe a small featured-jobs teaser —
// with the real results rendered separately at /{slug}/search (itself a
// plain GET, no query params needed for "show everything"; this is exactly
// what the landing page's own `<form jv-search-form action="/{slug}/search">`
// points at). That page carries the same known-layout markup when the tenant
// has open roles, or the same defused-empty-board wording (see
// EMPTY_BOARD_MARKER) when it genuinely doesn't — see fetch() below.
//
// Unlike /jobs (never seen paginated on a live tenant, even one with ~80
// postings), /search always paginates at 50/page and reports it via a
// `"{start}-{end} of {total}"` text node — reason enough to try /jobs first
// rather than defaulting to /search everywhere: for any tenant where /jobs
// already works, it's a single request with no pagination bookkeeping,
// where /search would need at least a second request past 50 postings.
/** @param {string} companyId @param {number} [page] - 0-indexed */
function buildSearchUrl(companyId, page = 0) {
  const base = `${ORIGIN}/${encodeURIComponent(companyId)}/search`;
  return page > 0 ? `${base}?p=${page}` : base;
}

// Mirrors workday.mjs/join.mjs's pagination safety cap: bounded regardless
// of what the page reports as its total, so a compromised/misbehaving
// upstream can't drive this into fetching an unbounded number of pages.
// Override with `max_pages` on the portal entry.
const SEARCH_DEFAULT_MAX_PAGES = 20;
const SEARCH_MAX_PAGES_CAP = 200;

/** @param {{ max_pages?: number }} entry */
function resolveSearchMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, SEARCH_MAX_PAGES_CAP);
  return SEARCH_DEFAULT_MAX_PAGES;
}

// Jobvite's own pagination widget on /search: a text node reading e.g.
// "1-50 of 241" (whitespace around the numbers varies, hence \s+ throughout
// rather than literal spaces).
const SEARCH_PAGINATION_TEXT = /(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/;

/**
 * Fetch every /{slug}/search page and merge the results, deduped by URL
 * (a listing can shift between page requests — e.g. a posting closes or a
 * new one opens between two of our fetches — which without this could hand
 * the same job back from two adjacent pages). Only called after /jobs
 * itself came up ambiguous (see fetch()) — parseJobviteHtml on this first
 * /search page still throws its own error (naming the tenant) if /search is
 * *also* ambiguous, which is intentionally left to propagate uncaught: at
 * that point we have zero results to fall back to, so there is nothing
 * partial worth preserving. A *later* page failing (page >= 1) is different
 * — we already have real postings from earlier pages by then, and losing
 * all of them over one bad page would be worse than returning a merely
 * incomplete list — so that case stops pagination and returns what was
 * collected so far instead of propagating.
 *
 * @param {string} companyId
 * @param {{ name: string, max_pages?: number }} entry
 * @param {{ fetchText: (url: string, opts?: object) => Promise<string>, maxPages?: number }} ctx
 */
async function fetchSearchPages(companyId, entry, ctx) {
  const firstUrl = withFrameParams(buildSearchUrl(companyId));
  assertJobviteUrl(firstUrl);
  const firstHtml = await ctx.fetchText(firstUrl, { redirect: 'error', headers: { accept: 'text/html' } });
  const jobs = parseJobviteHtml(firstHtml, entry.name);
  const seenUrls = new Set(jobs.map((j) => j.url));

  const m = firstHtml.match(SEARCH_PAGINATION_TEXT);
  if (!m) return jobs; // no pager on this page — it's everything there is

  const pageSize = Number(m[2]) - Number(m[1]) + 1;
  const total = Number(m[3]);
  if (!(pageSize > 0) || !(total > pageSize)) return jobs;

  // Honor a context page cap the same way join.mjs/workday.mjs do — set by
  // verify-portals' liveness probe so it only needs page 0 to confirm the
  // board is live, not its full count. No effect on real scans, which don't
  // set ctx.maxPages.
  const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
  const pagesToFetch = Math.min(Math.ceil(total / pageSize), resolveSearchMaxPages(entry), ctxCap);

  for (let page = 1; page < pagesToFetch; page++) {
    const url = withFrameParams(buildSearchUrl(companyId, page));
    assertJobviteUrl(url);
    let pageJobs;
    try {
      const html = await ctx.fetchText(url, { redirect: 'error', headers: { accept: 'text/html' } });
      pageJobs = parseJobviteHtml(html, entry.name);
    } catch {
      break; // a later page came up empty-handed — keep what earlier pages already found
    }
    for (const job of pageJobs) {
      if (seenUrls.has(job.url)) continue;
      seenUrls.add(job.url);
      jobs.push(job);
    }
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'jobvite',

  detect(entry) {
    const companyId = resolveCompanyId(entry);
    return companyId ? { url: buildCareersUrl(companyId) } : null;
  },

  async fetch(entry, ctx) {
    const companyId = resolveCompanyId(entry);
    if (!companyId) throw new Error(`jobvite: cannot derive company ID for ${entry.name}`);
    const careersUrl = withFrameParams(buildCareersUrl(companyId));
    assertJobviteUrl(careersUrl);
    // redirect:'error' keeps the fetch pinned to jobs.jobvite.com — a stale
    // or invalid slug redirects to search.jobvite.com, and that redirect
    // should surface as a fetch failure, not silently follow. withFrameParams
    // above handles the *other* redirect this host issues — a tenant on a
    // branded custom domain — by asking for the listing in the same "framed"
    // form the branded page itself embeds, rather than the interstitial that
    // 302s to it; a redirect happening anyway (an even less common failure
    // this doesn't account for) still fails loudly here rather than silently
    // fetching a page this provider was never meant to parse.
    const html = await ctx.fetchText(careersUrl, { redirect: 'error', headers: { accept: 'text/html' } });
    try {
      return parseJobviteHtml(html, entry.name);
    } catch {
      // /jobs had no known layout markers and no confirmed-empty wording —
      // ambiguous, not necessarily unsupported (see buildSearchUrl above).
      // Retry against /search (paginating as needed) before concluding the
      // theme really can't be scraped; if that also comes up empty-handed,
      // let its own error (naming the tenant) propagate instead of the
      // first one.
      return fetchSearchPages(companyId, entry, ctx);
    }
  },
};

// Jobvite ships (at least) five server-rendered list layouts for the same
// "classic" career-site theme:
//   table:       <td class="jv-job-list-name"><a href="{path}">{Title}</a></td>
//                <td class="jv-job-list-location">{City, Country}</td>
//   anchor:      <a href="{path}" class="jv-job-item …">
//                  <div class="jv-job-list-name[ extra-class]">{Title}</div>
//                  <div class="jv-job-list-location[ extra-class]">{City, Country}</div>
//                </a>
//   category:    <div class="jv-job">
//                  <a class="jv-job-name" href="{path}">{Title} <span>{City,
//                  Country}</span></a>
//                </div>
//                (job rows grouped under per-category <table class="jv-job-list">
//                headers; title and location share one anchor instead of two
//                separate cells/divs)
//   div-table:   <div class="tr">
//                  <div class="jv-job-list-name"><a href="{path}">{Title}</a></div>
//                  <div class="jv-job-list-location">{City, Country}</div>
//                </div>
//                (the table layout reimplemented with <div>s instead of
//                <td>/<tr> — the name div wraps the anchor, opposite nesting
//                from the anchor variant above)
//   single-cell: <td class="jv-job-list-name">
//                  <a href="{path}">
//                    <div class="title">{Title}</div>
//                    <div class="jv-job-list-location">{City, Country}</div>
//                  </a>
//                </td>
//                (title and location share one cell instead of two — title
//                lives in a generic, non-jv-prefixed class)
// All five are tried; results are merged and deduped by URL. None cover the
// client-rendered ("faceted search") theme some tenants use instead — that
// one loads its job list via JS after page load, nothing to scrape from the
// initial HTML (see KNOWN_LAYOUT_MARKER below, which makes that case throw
// instead of silently reading as "zero jobs").
//
// Confirmed against live tenants: table (jacksonfamilywines, egnyte),
// category (arc), div-table (lhhcareers), anchor/div (xperi), single-cell
// (fieldcore). All five real theme variants have now been seen on an actual
// tenant.
// Matches a class token as a whitespace-delimited word within a class
// attribute found anywhere among a tag's attributes — not anchored to
// attribute order (class needn't be first) and not fooled by a hyphenated
// near-miss like "jv-job-list-name-mobile" the way `\bTOKEN\b` would be,
// since `-` is a non-word character and satisfies `\b` on both sides of it.
const classToken = (token) => `(?=[^>]*\\bclass="(?:[^"]*\\s)?${token}(?:\\s[^"]*)?")`;

// All five supported themes render some element carrying one of these exact
// class tokens — the "jv-job-list" wrapper (<table>/<div>) around the whole
// list, the per-row "jv-job-list-name"/"jv-job-list-location" cells (shared
// by the table, div-table, and single-cell variants), the anchor variant's
// "jv-job-item" row class, or the category variant's "jv-job"/"jv-job-name"
// row markup — regardless of whether any given row ends up producing a
// valid job (e.g. one row dropped for a bad href scheme still leaves its
// markers behind). Their total absence is what separates
// "known layout, genuinely no jobs right now (or every row got filtered)"
// from "client-rendered faceted-search theme this provider can't scrape at
// all": the latter never emits any of this markup in the initial HTML,
// since the list loads via JS after page load.
const KNOWN_LAYOUT_MARKER = new RegExp(
  `<[a-z]+\\b(?:${classToken('jv-job-list')}|${classToken('jv-job-list-name')}|${classToken('jv-job-list-location')}|${classToken('jv-job-item')}|${classToken('jv-job')}|${classToken('jv-job-name')})`,
  'i',
);

// Jobvite hardcodes one of these two exact sentences (verified against live
// tenants — the wording differs by page, not by theme) for a genuinely empty
// board: "There are currently no open jobs." on the /jobs landing page,
// "No results found." on the /search results page — each as the sole text
// content of a <p> element (`<p class="jv-text-center">There are currently
// no open jobs.</p>`, `<p ng-non-bindable>No results found.</p>`). Anchoring
// to that <p>…</p> wrapper, not just the bare sentence, keeps an unrelated
// occurrence elsewhere on the page (this is plain English prose, not a
// unique token) from masking a real parsing gap as a confirmed-empty board;
// a page carrying this wording is client-rendered (no KNOWN_LAYOUT_MARKER
// present) yet the *emptiness* itself is server-rendered and trustworthy —
// this is what tells "genuinely zero jobs" apart from "can't tell, the real
// list loads via JS" for that theme.
const EMPTY_BOARD_MARKER = /<p\b[^>]*>\s*(?:There are currently no open jobs\.|No results found\.)\s*<\/p>/;

const LIST_PATTERNS = [
  // An intervening `<td>` (e.g. a department/type column) can sit between
  // the name and location cells — `(?:(?!<\/?tr\b)[\s\S])*?` skips over any
  // such cells without ever crossing a `<tr>`/`</tr>` boundary, so a row
  // missing its location cell can never pick up the next row's location.
  // The title and location captures are bounded the same way (not just the
  // skip): a lazy `[\s\S]*?` can otherwise backtrack straight through a row
  // boundary when the rest of the pattern fails to match within the current
  // row, silently re-pairing one row's title with a later row's location.
  new RegExp(
    `<td\\b${classToken('jv-job-list-name')}[^>]*>\\s*<a\\s+[^>]*?href="([^"]+)"[^>]*>((?:(?!<\\/?td\\b|<\\/?tr\\b)[\\s\\S])*?)<\\/a>\\s*<\\/td>` +
    `(?:(?!<\\/?tr\\b)[\\s\\S])*?<td\\b${classToken('jv-job-list-location')}[^>]*>((?:(?!<\\/?tr\\b)[\\s\\S])*?)<\\/td>`,
    'g',
  ),
  // A `jv-job-type` div (e.g. "Full-Time") and/or a plain wrapper div (e.g.
  // `<div class="flex-col">`) sometimes sit between the anchor/name/location
  // pieces — including AFTER the location div (the wrapper's own closing
  // tag, or a sibling div like a "posted N days ago" note). `(?:(?!<\/?a\b)
  // [\s\S])*?` skips over any of them without ever crossing into a
  // neighboring `<a>`/`</a>` — a plain `[\s\S]*?` here can latch onto an
  // unrelated earlier anchor (e.g. a nav/share link) and grab its href for a
  // job title several entries later, or (used after the location capture)
  // swallow a trailing sibling's text into the location. The location
  // capture itself stays bound to `([\s\S]*?)<\/div>` — its own closing
  // tag — precisely because the skip after it, not the capture, is what
  // absorbs anything between that div and the real `</a>`.
  new RegExp(
    `<a\\s+[^>]*?href="([^"]+)"[^>]*>(?:(?!<\\/?a\\b)[\\s\\S])*?<div\\b${classToken('jv-job-list-name')}[^>]*>([\\s\\S]*?)<\\/div>` +
    `(?:(?!<\\/?a\\b)[\\s\\S])*?<div\\b${classToken('jv-job-list-location')}[^>]*>([\\s\\S]*?)<\\/div>(?:(?!<\\/?a\\b)[\\s\\S])*?<\\/a>`,
    'g',
  ),
  // Category variant (e.g. arc): title and location share a single anchor
  // instead of separate cells/divs — `<a class="jv-job-name" href="{path}">
  // {Title} <span>{City, Country}</span></a>` — rows are grouped under
  // per-category `<table class="jv-job-list">` headers, but that grouping is
  // irrelevant here since the pattern matches each `<a class="jv-job-name">`
  // directly regardless of its ancestor table. The title capture is bounded
  // by `<span` or `</a>` (not just `<span`) so a row with no location span
  // at all still yields a title instead of failing to match.
  new RegExp(
    `<a\\b${classToken('jv-job-name')}[^>]*?href="([^"]+)"[^>]*>((?:(?!<span\\b|<\\/a\\b)[\\s\\S])*?)<span\\b[^>]*>([\\s\\S]*?)<\\/span>(?:(?!<\\/a\\b)[\\s\\S])*?<\\/a>`,
    'g',
  ),
  // Div-table variant (e.g. lhhcareers): the table layout's `<td>`/`<tr>`
  // structure reimplemented with `<div>`s — `<div class="tr"><div
  // class="jv-job-list-name"><a href="{path}">{Title}</a></div><div
  // class="jv-job-list-location">{City, Country}</div>…</div>`. Structurally
  // this is the table pattern with the name div *wrapping* the anchor
  // (opposite nesting from the anchor/div variant above, where the anchor
  // wraps the name div) — that's what keeps the two patterns from
  // cross-matching each other's rows. `(?:(?!<div\b${classToken('tr')})
  // [\s\S])*?` between name and location skips any intervening column
  // (e.g. a duration div) without crossing into the next row's own
  // `<div class="tr">` wrapper, mirroring the table pattern's `<tr>` guard.
  new RegExp(
    `<div\\b${classToken('jv-job-list-name')}[^>]*>\\s*<a\\s+[^>]*?href="([^"]+)"[^>]*>((?:(?!<\\/a\\b|<\\/div\\b)[\\s\\S])*?)<\\/a>\\s*<\\/div>` +
    `(?:(?!<div\\b${classToken('tr')})[\\s\\S])*?<div\\b${classToken('jv-job-list-location')}[^>]*>([\\s\\S]*?)<\\/div>`,
    'g',
  ),
  // Single-cell variant (e.g. fieldcore): title and location share one
  // `<td class="jv-job-list-name">`, both nested inside the row's single
  // `<a>` — `<td class="jv-job-list-name"><a href="{path}"><div
  // class="title">{Title}</div><div class="jv-job-list-location">{City,
  // Country}</div><div class="arrow">…</div></a></td>`. The title lives in
  // a generic `<div class="title">`, not one of this file's `jv-*` tokens,
  // so the title capture just takes everything up to the location div (or
  // `</a>` on a row with no location at all) rather than matching that
  // class specifically — `clean()` strips the wrapper tags either way. A
  // trailing `<div class="arrow">` (or similar decoration) after the
  // location div is skipped the same way the table pattern skips a
  // duration column: never crossing `<\/a>`, so it can't bleed into a
  // later row's title.
  new RegExp(
    `<td\\b${classToken('jv-job-list-name')}[^>]*>\\s*<a\\s+[^>]*?href="([^"]+)"[^>]*>` +
    `((?:(?!<div\\b${classToken('jv-job-list-location')}|<\\/a\\b)[\\s\\S])*?)` +
    `<div\\b${classToken('jv-job-list-location')}[^>]*>([\\s\\S]*?)<\\/div>(?:(?!<\\/a\\b)[\\s\\S])*?<\\/a>`,
    'g',
  ),
];

/**
 * Parse a Jobvite careers page (server-rendered HTML) into jobs. Exported for
 * unit tests. No posting date is exposed on the list page, so `postedAt` is
 * omitted — date filters (`--since`, `max_age_days`) never exclude Jobvite
 * rows, and they sort last among dated results.
 *
 * Throws rather than returning `[]` when zero jobs matched AND the page
 * carries neither a known-layout marker (see KNOWN_LAYOUT_MARKER) nor
 * Jobvite's own confirmed-empty wording (see EMPTY_BOARD_MARKER) — that
 * combination means the page is genuinely ambiguous (most likely a
 * search-splash landing page on the client-rendered "faceted search" theme,
 * whose real results live elsewhere — see fetch()'s /search retry), not
 * that the board is confirmed empty. A recognized layout with zero matching
 * rows, or the literal "no jobs" wording, still returns `[]`, since both are
 * real, trustworthy answers even though this provider can't render the rest
 * of that theme's markup.
 *
 * @param {unknown} html - raw HTML text of the careers page
 * @param {string} companyName - value to write into job.company
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseJobviteHtml(html, companyName) {
  if (typeof html !== 'string') return [];

  const out = [];
  const seen = new Set();

  for (const pattern of LIST_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(html))) {
      const href = decodeEntities(m[1]);
      const title = clean(m[2]);
      if (!title) continue;

      let url;
      try {
        const resolved = new URL(href, ORIGIN);
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
        url = resolved.href;
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);

      out.push({ title, url, company: companyName, location: clean(m[3]) });
    }
  }

  if (out.length === 0 && !KNOWN_LAYOUT_MARKER.test(html) && !EMPTY_BOARD_MARKER.test(html)) {
    throw new Error(
      `jobvite: ${companyName} — no known Jobvite layout markers and no confirmed-empty wording found in the careers page; ` +
      'this tenant is likely on the client-rendered ("faceted search") theme, which this provider does not support',
    );
  }

  return out;
}
