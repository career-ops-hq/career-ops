// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { coerceId } from './_ids.mjs';
import { htmlToText } from './_html-to-text.mjs';

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
// FIRST PAGE ONLY, and that is a robots.txt constraint, not an oversight.
// google.com/robots.txt disallows the paginated results URLs for every crawler:
//
//   Disallow: /about/careers/applications/jobs/results?page=
//   Disallow: /about/careers/applications/jobs/results/?page=
//   Disallow: /about/careers/applications/jobs/results?*&page=
//   Disallow: /about/careers/applications/jobs/results/?*&page=
//
// with no Allow under /about/careers that could take precedence (RFC 9309 §2.2.2
// longest-match). career-ops declines Lagou for the same reason — see
// docs/SUPPORTED_JOB_BOARDS.md: "The project does not route around that stated
// restriction." So this provider never sends `page`, which leaves one results
// page per query (~20 postings). `sort_by=date` makes that page the NEWEST
// postings, which is what a scanner run on a schedule wants; pages beyond the
// first are unreachable without the disallowed parameter, so `max_pages` does
// not apply to this provider.
//
// Config (portals.yml):
//   provider: google
//   google:
//     location: "United States"      # optional
//     queries: ["business strategy", "business operations", ...]

const BASE = 'https://www.google.com/about/careers/applications/jobs/results/';
// One request per query: no `page` parameter exists in any URL this provider builds.
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
    const byId = new Map();
    for (const q of (probing ? queries.slice(0, 1) : queries)) {
      // URLSearchParams, not hand-built encodeURIComponent: q and location come from
      // portals.yml, and URLSearchParams never throws on a malformed string.
      const url = `${BASE}?${new URLSearchParams({ q: String(q), location: String(location), sort_by: 'date' })}`;
      const html = await ctx.fetchText(url, { redirect: 'error' });
      for (const { id, slug, title, employer, locations } of parseResultsPage(html)) {
        if (byId.has(id)) continue;
        byId.set(id, {
          title,
          url: `${BASE}${id}-${slug}`,
          company: employer || entry.name,
          location: locations.join('; '),
          ...(coerceId(id) ? { externalId: /** @type {string} */ (coerceId(id)) } : {}),
        });
      }
    }
    return [...byId.values()];
  },
};
