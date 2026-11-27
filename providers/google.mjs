// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { coerceId } from './_ids.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

// Google provider — Google Careers is server-rendered, so the results page HTML
// contains every job link:
//   GET https://www.google.com/about/careers/applications/jobs/results/?q=<kw>&location=United%20States&sort_by=date
//   -> HTML with one card per posting, closed by <a href="jobs/results/{id}-{slug}">
// No JSON API and no XHR (data is in the document), so we run phrase queries and
// let scan.mjs's title filter cut.
//
// Each card carries the posting's real title (<h3>) and an "Employer | location;
// location; +2 more" line. The EMPLOYER is not always Google: the same results
// list YouTube, DeepMind and other Alphabet companies' postings, so the card's
// employer is the company, not the portals.yml entry name (CodeRabbit, #4078).
// A card without that markup falls back to the entry name, the link's
// aria-label or slug for the title, and a blank location.
//
// PAGINATION. The results are paged with a 1-based `page` query parameter
// (omitted on page 1), 20 cards per full page, newest first under
// `sort_by=date`. Until 2026-11-08 this provider read only the first page,
// because `google.com/robots.txt` disallows the `page=` results URLs; rule 6 of
// the Source Indexing Policy stopped treating robots.txt as a gate (#6691,
// #6694), so the walk now continues page by page. A query ends on the first
// empty page, a page that repeats one already seen in the same walk, or a short
// page (fewer than a full page of cards), and is otherwise bounded by
// `max_pages` per query (default DEFAULT_MAX_PAGES, hard ceiling MAX_PAGES_CAP).
//
// Config (portals.yml):
//   provider: google
//   google:
//     location: "United States"      # optional
//     queries: ["business strategy", "business operations", ...]
//   max_pages: 10                     # optional, per query
//
// FULL BOARD (opt-in, `google: { full_board: true }`). The query walk reads
// only what the queries match, and nothing reports the titles it never
// matched (#7315). The same results page with NO `q` lists the whole board,
// newest first, with the full card on every posting (3,127 worldwide, 1,799
// under location=United States on 2026-11-19). full_board walks that one
// unqueried listing instead of the queries, so every row carries the real
// title, employer and locations the scan's title, location and blacklist
// filters need. `location` still applies; `queries` is not used. The walk has
// its own page budget (FULL_BOARD_DEFAULT_MAX_PAGES, ceiling
// FULL_BOARD_MAX_PAGES_CAP, `max_pages` overrides) because one listing of
// the whole board needs far more pages than one query; hitting it marks the
// board partial ('page-cap') like any other cap.
//   google:
//     full_board: true
//     location: "United States"      # optional

const BASE = 'https://www.google.com/about/careers/applications/jobs/results/';
// A full results page carries 20 cards; a shorter page is the last one for that
// query. Observed live 2026-11-08.
const PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10; // 200 postings per query
const MAX_PAGES_CAP = 50; // hard ceiling even for a max_pages override
// full_board walks one unqueried listing of the whole board: 200 pages is
// 4,000 postings, room over the 3,127 seen worldwide on 2026-11-19.
const FULL_BOARD_DEFAULT_MAX_PAGES = 200;
const FULL_BOARD_MAX_PAGES_CAP = 300;
const INTER_PAGE_DELAY_MS = 400;
// The anchor that closes each card; the markup since the previous anchor is that
// card. Google serves the href relative ("jobs/results/…"); a path prefix is
// tolerated, and the URL is rebuilt from BASE either way. It accepts the same
// quoting as POSTING_LINK_RE, and the slug is optional, so every posting link
// the page is counted for is one the parser can read (#7320 review).
const ANCHOR_RE = /<a\b[^>]*?\bhref\s*=\s*["']?(?:[^"'\s>]*\/)?jobs\/results\/(\d+)(?:-([^"'\s>?#/]*))?[^>]*>/gi;
// Any link to a posting under jobs/results/, whatever its quoting or ID shape.
// It counts the postings a page links to before ANCHOR_RE filters them, so a
// card the parser cannot read still counts toward a full page (#7320 review).
// The bare listing link ("jobs/results/?…") has no path segment and is skipped.
const POSTING_LINK_RE = /\bhref\s*=\s*["']?(?:[^"'\s>]*\/)?jobs\/results\/([^"'\s>?#/]+)/gi;
const H3_RE = /<h3\b[^>]*>([^<]+)<\/h3>/g;
const EMPLOYER_LINE_RE = /<p class="l103df">([\s\S]*?)<\/p>/g;
const ARIA_TITLE_RE = /\baria-label="Learn more about ([^"]+)"/;
// "+2 more" is Google collapsing the rest of the list, not a place.
const MORE_RE = /^\+\d+ more$/;
const DEFAULT_QUERIES = [
  'business strategy', 'business operations', 'strategy and operations',
  'corporate development', 'financial planning',
];

function getConfig(entry) {
  const c = entry.google || {};
  const queries = Array.isArray(c.queries) && c.queries.length ? c.queries : DEFAULT_QUERIES;
  return { location: c.location || 'United States', queries };
}

/** @param {any} entry @returns {boolean} */
function isFullBoard(entry) {
  return entry?.google?.full_board === true;
}

/** @param {any} entry @returns {number} */
export function resolveMaxPages(entry) {
  const full = isFullBoard(entry);
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, full ? FULL_BOARD_MAX_PAGES_CAP : MAX_PAGES_CAP);
  return full ? FULL_BOARD_DEFAULT_MAX_PAGES : DEFAULT_MAX_PAGES;
}

function titleFromSlug(slug) {
  return slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Card text goes through the shared pipeline, never a local strip-then-decode:
// stripping tags before decoding lets "&lt;script&gt;" come back out as a live
// "<script>" (CodeQL js/incomplete-multi-character-sanitization on #4078).
const text = (/** @type {string} */ s) => htmlToText(s);

/** Last match of a global regex in `s`, or null. */
function lastMatch(/** @type {RegExp} */ re, /** @type {string} */ s) {
  let last = null;
  for (const m of s.matchAll(re)) last = m;
  return last;
}

/**
 * Parse one results page into its cards.
 *
 * @param {string} html
 * @returns {{id: string, slug: string, title: string, employer: string, locations: string[]}[]}
 */
export function parseResultsPage(html) {
  const cards = [];
  let prevEnd = 0;
  for (const a of String(html).matchAll(ANCHOR_RE)) {
    const [tag, id, slug = ''] = a;
    const card = html.slice(prevEnd, a.index);
    prevEnd = /** @type {number} */ (a.index) + tag.length;
    const h3 = lastMatch(H3_RE, card);
    const aria = tag.match(ARIA_TITLE_RE);
    const title = (h3 && text(h3[1])) || (aria && text(aria[1])) || titleFromSlug(slug);
    // No title anywhere: not a row the scan's filters can judge. Leave it out,
    // and the walk counts it as an unread posting.
    if (!title) continue;
    const line = lastMatch(EMPLOYER_LINE_RE, card);
    let employer = '';
    let locations = [];
    if (line) {
      const sep = line[1].indexOf('|');
      if (sep !== -1) {
        employer = text(line[1].slice(0, sep));
        locations = text(line[1].slice(sep + 1)).split(';').map((l) => l.trim()).filter((l) => l && !MORE_RE.test(l));
      }
    }
    cards.push({ id, slug, title, employer, locations });
  }
  return cards;
}

/**
 * The distinct postings a results page links to, before card parsing drops
 * any. Keyed by the numeric ID when the path starts with one, the same key
 * the parsed cards use, so the two can be compared.
 *
 * @param {string} html
 * @returns {Set<string>}
 */
export function postingLinkIds(html) {
  const ids = new Set();
  for (const m of String(html).matchAll(POSTING_LINK_RE)) ids.add(/^\d+/.exec(m[1])?.[0] ?? m[1]);
  return ids;
}

/**
 * Count the distinct postings a results page links to, before card parsing.
 *
 * @param {string} html
 * @returns {number}
 */
export function countPostingLinks(html) {
  return postingLinkIds(html).size;
}

/** @type {Provider} */

export default {
  id: 'google',

  detect(entry) {
    return entry.google ? { url: BASE } : null;
  },

  async fetch(entry, ctx) {
    const full = isFullBoard(entry);
    const { location, queries: configured } = getConfig(entry);
    // full_board: one unqueried walk of the whole listing (q omitted).
    const queries = full ? [''] : configured;
    // `ctx.maxPages` means verify-portals is probing, not scanning: walk one
    // query and one page, so a liveness check costs one request instead of
    // queries x pages (providers/ADDING_A_PROVIDER.md).
    const ctxMaxPages = Number(/** @type {any} */ (ctx)?.maxPages);
    const probing = ctxMaxPages > 0;
    const entryMaxPages = resolveMaxPages(entry);
    const maxPages = probing ? Math.min(entryMaxPages, ctxMaxPages) : entryMaxPages;
    const queriesToRun = probing ? queries.slice(0, 1) : queries;

    const byId = new Map();
    let requestsMade = 0;
    let truncated = false;
    let fetchFailed = false;
    let unparsablePage = false;
    // Posting IDs a page linked to that no card has returned yet. A later page
    // or query that returns one takes it off; any left at the end are missing.
    const unreadIds = new Set();
    let unrestrictedPageReturned = false;
    let firstPageFailures = 0;
    let firstPageError;

    for (const q of queriesToRun) {
      // IDs seen in THIS query's walk: a page that adds none is Google
      // re-serving an earlier page past the end, so the walk for this query
      // stops — but a later query whose first page overlaps an earlier query
      // still walks its own deeper pages (ADDING_A_PROVIDER.md).
      const seenThisQuery = new Set();
      for (let page = 1; page <= maxPages; page++) {
        // URLSearchParams, not hand-built encodeURIComponent: q and location come from
        // portals.yml, and URLSearchParams never throws on a malformed string.
        const params = new URLSearchParams({ location: String(location), sort_by: 'date' });
        if (q !== '') params.set('q', String(q));
        if (page > 1) params.set('page', String(page));
        const url = `${BASE}?${params}`;
        if (requestsMade > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
        let html;
        try {
          html = await fetchTextWithRetry(ctx, url, { redirect: 'error' });
        } catch (err) {
          // While probing, a rejection propagates unwrapped (verify-portals needs it).
          // Track page-1 failures across all queries: if every query fails on page 1,
          // throw the first error (a total outage). Otherwise, keep the jobs collected
          // from successful queries, warn, and move to the next query.
          if (probing) throw err;
          fetchFailed = true;
          if (page === 1) {
            if (firstPageFailures === 0) firstPageError = err;
            firstPageFailures += 1;
          }
          const cause = err instanceof Error ? err.message : String(err);
          console.error(`⚠️  google: ${entry.name} stopped ${q === '' ? 'the full board' : `"${q}"`} at page ${page} (${byId.size} jobs so far): ${cause}`);
          break;
        }
        requestsMade += 1;
        if (!String(q).trim()) unrestrictedPageReturned = true;
        const cards = parseResultsPage(html);
        const linkIds = postingLinkIds(html);
        const postingLinks = linkIds.size;
        // Page 1 links to postings but no card parsed: the markup changed under
        // the parser. Returning [] would read as an empty board, so fail loudly
        // (ADDING_A_PROVIDER.md). A page with no posting links is a real empty.
        if (page === 1 && cards.length === 0 && postingLinks > 0) {
          throw new Error(`google: ${entry.name} page 1 links to ${postingLinks} posting(s) but no card could be parsed — the results markup may have changed`);
        }
        // The same on a later page: stop, but mark the result partial so the
        // scan does not read an early stop as the whole board.
        if (cards.length === 0 && postingLinks > 0) {
          unparsablePage = true;
          console.error(`⚠️  google: ${entry.name} stopped ${q === '' ? 'the full board' : `"${q}"`} at page ${page}: it links to ${postingLinks} posting(s) but no card could be parsed (${byId.size} jobs so far)`);
          break;
        }
        // Novelty is read from every posting the page links to, not only the
        // parsed cards, so a page whose one new posting failed to parse is not
        // mistaken for Google re-serving an earlier page.
        let newThisQuery = 0;
        for (const id of linkIds) {
          if (!seenThisQuery.has(id)) { seenThisQuery.add(id); newThisQuery += 1; }
        }
        for (const { id, slug, title, employer, locations } of cards) {
          if (byId.has(id)) continue;
          byId.set(id, {
            title,
            url: slug ? `${BASE}${id}-${slug}` : `${BASE}${id}`,
            company: employer || entry.name,
            location: locations.join('; '),
            ...(locations.length > 0 ? { locations } : {}),
            ...(coerceId(id) ? { externalId: /** @type {string} */ (coerceId(id)) } : {}),
          });
        }
        for (const id of unreadIds) if (byId.has(id)) unreadIds.delete(id);
        for (const id of linkIds) if (!byId.has(id)) unreadIds.add(id);
        // Stop at this query's last page: empty, re-served (no new posting
        // links), or short. "Short" counts every posting link on the page, not the parsed
        // cards, so one unparsable card on a full page does not end the walk.
        if (cards.length === 0 || newThisQuery === 0 || postingLinks < PAGE_SIZE) break;
        if (page === maxPages && !probing) truncated = true;
      }
    }
    if (firstPageFailures === queriesToRun.length && firstPageError) {
      throw firstPageError;
    }
    let jobs = [...byId.values()];
    if (truncated) {
      console.error(full
        ? `⚠️  google: ${entry.name} hit the ${maxPages}-page cap on the full board (${jobs.length} postings read) — raise max_pages on this entry for more (up to ${FULL_BOARD_MAX_PAGES_CAP})`
        : `⚠️  google: ${entry.name} hit the ${maxPages}-page cap on at least one query — raise max_pages on this entry for more`);
      jobs = markTruncated(jobs, 'page-cap', { fetched: jobs.length });
    }
    if (unparsablePage) {
      jobs = markTruncated(jobs, 'unparsable-page', { fetched: jobs.length });
    }
    if (unreadIds.size > 0) {
      // Linked on a page, but no card on any page returned it: the walk went
      // on, but the result is not the whole board.
      console.error(`⚠️  google: ${entry.name} could not read ${unreadIds.size} linked posting(s) (${jobs.length} read)`);
      jobs = markTruncated(jobs, 'unread-postings', { fetched: jobs.length });
    }
    if (fetchFailed) {
      jobs = markTruncated(jobs, 'fetch-error', { fetched: jobs.length });
    }
    if (unrestrictedPageReturned) return jobs;
    return Object.assign(jobs, {
      queryScope: { config: 'google.queries', queries: queriesToRun.map(String).filter(q => q.trim()) },
    });
  },
};
