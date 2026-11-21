// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { coerceId } from './_ids.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

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

const BASE = 'https://www.google.com/about/careers/applications/jobs/results/';
// A full results page carries 20 cards; a shorter page is the last one for that
// query. Observed live 2026-11-08.
const PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10; // 200 postings per query
const MAX_PAGES_CAP = 50; // hard ceiling even for a max_pages override
const INTER_PAGE_DELAY_MS = 400;
// The anchor that closes each card; the markup since the previous anchor is that
// card. Google serves the href relative ("jobs/results/…"); a path prefix is
// tolerated, and the URL is rebuilt from BASE either way.
const ANCHOR_RE = /<a\b[^>]*?\bhref="(?:[^"]*\/)?jobs\/results\/(\d+)-([a-z0-9-]+)[^"]*"[^>]*>/g;
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

/** @param {any} entry @returns {number} */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
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
    const [tag, id, slug] = a;
    const card = html.slice(prevEnd, a.index);
    prevEnd = /** @type {number} */ (a.index) + tag.length;
    const h3 = lastMatch(H3_RE, card);
    const aria = tag.match(ARIA_TITLE_RE);
    const title = (h3 && text(h3[1])) || (aria && text(aria[1])) || titleFromSlug(slug);
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

/** @type {Provider} */

export default {
  id: 'google',

  detect(entry) {
    return entry.google ? { url: BASE } : null;
  },

  async fetch(entry, ctx) {
    const { location, queries } = getConfig(entry);
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

    for (const q of queriesToRun) {
      // IDs seen in THIS query's walk: a page that adds none is Google
      // re-serving an earlier page past the end, so the walk for this query
      // stops — but a later query whose first page overlaps an earlier query
      // still walks its own deeper pages (ADDING_A_PROVIDER.md).
      const seenThisQuery = new Set();
      for (let page = 1; page <= maxPages; page++) {
        // URLSearchParams, not hand-built encodeURIComponent: q and location come from
        // portals.yml, and URLSearchParams never throws on a malformed string.
        const params = new URLSearchParams({ q: String(q), location: String(location), sort_by: 'date' });
        if (page > 1) params.set('page', String(page));
        const url = `${BASE}?${params}`;
        if (requestsMade > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
        let html;
        try {
          html = await fetchTextWithRetry(ctx, url, { redirect: 'error' });
        } catch (err) {
          // The first request failing means the board is broken, not empty, and
          // a probe needs the rejection unwrapped so its request-budget sentinel
          // keeps its identity. Otherwise keep the queries already collected
          // rather than lose them to one bad search, and move to the next query.
          if (probing || requestsMade === 0) throw err;
          const cause = err instanceof Error ? err.message : String(err);
          console.error(`⚠️  google: ${entry.name} stopped "${q}" at page ${page} (${byId.size} jobs so far): ${cause}`);
          break;
        }
        requestsMade += 1;
        const cards = parseResultsPage(html);
        let newThisQuery = 0;
        for (const { id, slug, title, employer, locations } of cards) {
          if (!seenThisQuery.has(id)) { seenThisQuery.add(id); newThisQuery += 1; }
          if (byId.has(id)) continue;
          byId.set(id, {
            title,
            url: `${BASE}${id}-${slug}`,
            company: employer || entry.name,
            location: locations.join('; '),
            ...(coerceId(id) ? { externalId: /** @type {string} */ (coerceId(id)) } : {}),
          });
        }
        // Stop at this query's last page: empty, re-served (no new ids), or
        // short (a full page is PAGE_SIZE cards).
        if (cards.length === 0 || newThisQuery === 0 || cards.length < PAGE_SIZE) break;
        if (page === maxPages && !probing) truncated = true;
      }
    }
    if (truncated) {
      console.error(`⚠️  google: ${entry.name} hit the ${maxPages}-page cap on at least one query — raise max_pages on this entry for more`);
    }
    return [...byId.values()];
  },
};
