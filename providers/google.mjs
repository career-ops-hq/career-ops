// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { coerceId } from './_ids.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { sleep } from './_http.mjs';

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
// PAGINATION: `max_pages` pages through the results. google.com/robots.txt used
// to disallow the paginated results URLs for every crawler:
//
//   Disallow: /about/careers/applications/jobs/results?page=
//   Disallow: /about/careers/applications/jobs/results/?page=
//   Disallow: /about/careers/applications/jobs/results?*&page=
//   Disallow: /about/careers/applications/jobs/results/?*&page=
//
// with no Allow under /about/careers that could take precedence (RFC 9309 §2.2.2
// longest-match), so this provider never sent `page`. Rule 6 of the Source
// Indexing Policy changed in #6691: robots.txt is no longer a gate, so the
// disallowed parameter is now just a URL (#6694). Page 1 keeps the bare URL,
// deeper pages append page=N, and the walk stops as soon as a page adds no new
// ids (a parameter the board ignores re-serves page 1, so that ends the walk
// instead of repeating it). `sort_by=date` makes page 1 the NEWEST postings,
// which is what a scanner run on a schedule wants; with no `max_pages` the
// provider keeps its old single-page behavior.
//
// Config (portals.yml):
//   provider: google
//   max_pages: 5                     # optional, default 1 (first page only), cap 20
//   google:
//     location: "United States"      # optional
//     queries: ["business strategy", "business operations", ...]

const BASE = 'https://www.google.com/about/careers/applications/jobs/results/';
// First page only unless the entry sets `max_pages` (see the header comment).
const DEFAULT_MAX_PAGES = 1;
const MAX_PAGES_CAP = 20;
// Politeness delay between pages of one query, and the walk's cancellation
// checkpoint (ctx.sleep is the framework's watchdog-aware hook) - the same
// convention kalibrr and the other paged providers follow.
const INTER_PAGE_DELAY_MS = 200;
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

/**
 * The entry's page budget: `max_pages` (or camelCase) clamped to 1..MAX_PAGES_CAP.
 * Anything missing or malformed keeps the old single-page behavior.
 */
function resolveMaxPages(entry) {
  const raw = entry?.max_pages ?? entry?.maxPages;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(n, MAX_PAGES_CAP);
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
    // A probe only needs to know the board answers, so it spends one query.
    const probing = Number(/** @type {any} */ (ctx)?.maxPages) > 0;
    // The probe's budget caps paging too; without max_pages this stays 1.
    const pageBudget = Math.min(
      resolveMaxPages(entry),
      probing ? Number(/** @type {any} */ (ctx).maxPages) : Infinity,
    );
    const byId = new Map();
    for (const q of (probing ? queries.slice(0, 1) : queries)) {
      // URLSearchParams, not hand-built encodeURIComponent: q and location come from
      // portals.yml, and URLSearchParams never throws on a malformed string.
      const params = new URLSearchParams({ q: String(q), location: String(location), sort_by: 'date' });
      for (let page = 1; page <= pageBudget; page++) {
        if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
        // Page 1 keeps the bare URL; deeper pages carry page=N.
        const url = page === 1 ? `${BASE}?${params}` : `${BASE}?${params}&page=${page}`;
        let html;
        try {
          html = await ctx.fetchText(url, { redirect: 'error' });
        } catch (err) {
          // kalibrr's failure contract: a probe sees the rejection unwrapped,
          // a first-page failure fails loud rather than report a quiet empty
          // board, and a deeper page keeps what earlier pages already
          // collected instead of losing the whole board to one bad page.
          if (probing || page === 1) throw err;
          console.warn(`google: page ${page} failed - ${err.message}`);
          break;
        }
        let added = 0;
        for (const { id, slug, title, employer, locations } of parseResultsPage(html)) {
          if (byId.has(id)) continue;
          added++;
          byId.set(id, {
            title,
            url: `${BASE}${id}-${slug}`,
            company: employer || entry.name,
            location: locations.join('; '),
            ...(coerceId(id) ? { externalId: /** @type {string} */ (coerceId(id)) } : {}),
          });
        }
        // A page with no new ids ends the walk for this query.
        if (added === 0) break;
      }
    }
    return [...byId.values()];
  },
};
