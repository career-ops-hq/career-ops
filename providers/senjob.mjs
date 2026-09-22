// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Senjob provider — board-wide feed for Senegal (https://senjob.com), the
// project's first African source. Wire in via a `job_boards:` entry with
// `provider: senjob`.
//
// This one parses HTML, which the repo otherwise avoids, so the reason is worth
// stating: measured on 2026-08-16, four of the five Senegalese boards checked
// are unusable for a zero-auth scanner. emploidakar.com runs WP Job Manager and
// its REST route `/wp-json/wp/v2/job-listings` exists, but Cloudflare answers
// the data endpoints with a "Just a moment..." interstitial (403) even with full
// browser headers; emploisenegal.com returns 403; emploi.sn does not resolve;
// expat-dakar.com is Cloudflare-fronted classifieds. senjob.com is plain Apache
// with no interstitial, and it is the only one left.
//
// robots.txt (fetched 2026-08-16) disallows `/cvs/`, `/*/cvs/`,
// `/jobseekers/cvs/`, `/jobseekers/Images/` and the employer-registration pages.
// It does NOT disallow `/offres-d-emploi.php` or the `/jobseekers/*.html`
// postings this provider reads. The disallowed paths are candidate CVs and
// employer account pages — personal data this provider never requests.
//
// PARSING CONTRACT. Markup-based extraction rots, so the anchors here are the
// two things a redesign is least likely to change:
//
//   1. the posting URL shape `/jobseekers/{slug}_e_{id}.html`, which carries the
//      posting id, and
//   2. the hidden ISO date `<span style="display:none;">YYYY-MM-DD</span>`.
//
// No CSS class or inline style is matched. And when a page that clearly IS a
// listing page yields nothing, this THROWS instead of returning [] — a broken
// parser must look like a broken board, not like a country with no jobs. That
// silent-zero failure is the whole risk of scraping and the reason for
// `assertParsedSomething` below.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const TRUSTED_HOST = 'senjob.com';
const LIST_URL = 'https://senjob.com/offres-d-emploi.php';

/** Pages are ~40 postings; 10 covers the live board with room to spare. */
const DEFAULT_MAX_PAGES = 10;

/** Hard ceiling on a configured `max_pages`, so one entry cannot sweep forever. */
const MAX_PAGES_CAP = 50;

/**
 * Pacing between pages of the SAME board. senjob.com is a single small Apache
 * host, not a CDN-fronted multi-tenant ATS, so this is ordinary politeness
 * rather than a measured rate limit — no throttling was observed while probing.
 */
const INTER_PAGE_DELAY_MS = 250;

/** A posting link: the slug is free-form, the `_e_{id}.html` suffix is not. */
const POSTING_LINK_RE = /href="(https:\/\/senjob\.com\/jobseekers\/[^"]*?_e_(\d+)\.html)"/i;

/** The same link as an anchor, so its inner text can be read as the title. */
const POSTING_ANCHOR_RE =
  /<a\s[^>]*href="https:\/\/senjob\.com\/jobseekers\/[^"]*?_e_\d+\.html"[^>]*>([\s\S]*?)<\/a>/i;

/** The machine-readable publication date, hidden next to its localized form. */
const HIDDEN_ISO_DATE_RE = /display:\s*none;?\s*"?>\s*(\d{4}-\d{2}-\d{2})\s*</i;

/** @param {any} ctx @param {number} ms */
function sleep(ctx, ms) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string} url */
function assertSenjobUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`senjob: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`senjob: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`senjob: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/**
 * Collapse a markup fragment to its visible text.
 * Comments are stripped FIRST: the anchor bodies carry `<!-- d ico postulez -->`
 * between the title and a spacer image, and a naive tag strip would leave the
 * comment body sitting inside the title.
 * @param {string} fragment
 * @returns {string}
 */
export function visibleText(fragment) {
  return decodeEntities(
    String(fragment ?? '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build the list URL for a page. Page 1 is the bare path — the board links it
 * that way, and `?page=1` is not a form it advertises.
 * @param {number} page
 */
export function buildListUrl(page) {
  return page <= 1 ? LIST_URL : `${LIST_URL}?page=${page}`;
}

/**
 * Parse one listing page into postings.
 *
 * Rows are split on `<tr`, not on a fixed character window: a posting's title
 * link and its dates live in sibling cells, and the board repeats "sticky" rows
 * across pages. Merging by posting ID is what makes both harmless — the first
 * row to carry a title sets it, any row carrying a date fills it in, and a
 * repeat contributes nothing new instead of producing a duplicate.
 *
 * @param {string} html - Raw listing page.
 * @returns {{title: string, url: string, company: string, location: string, postedAt?: number}[]}
 */
export function parseListingPage(html) {
  /** @type {Map<string, {title: string, url: string, company: string, location: string, postedAt?: number}>} */
  const byId = new Map();

  for (const row of String(html ?? '').split(/<tr\b/i)) {
    const link = POSTING_LINK_RE.exec(row);
    if (!link) continue;
    const [, url, id] = link;

    let record = byId.get(id);
    if (!record) {
      // company stays empty on purpose: the listing rows do not name the
      // employer, and _types.js documents an empty company as the contract for
      // exactly that. Inventing one from the slug would be a fabricated claim.
      record = { title: '', url, company: '', location: '' };
      byId.set(id, record);
    }

    const anchor = POSTING_ANCHOR_RE.exec(row);
    if (anchor && !record.title) {
      record.title = visibleText(anchor[1]);
      // The cell after the title holds the place, then the localized "Publié:"
      // label. Cutting at the label keeps the place free of date text without
      // depending on where the surrounding tags sit.
      record.location = visibleText(row.slice(anchor.index + anchor[0].length))
        .split(/Publi[ée]/i)[0]
        .replace(/^[\s|:-]+|[\s|:-]+$/g, '');
    }

    const date = HIDDEN_ISO_DATE_RE.exec(row);
    if (date && record.postedAt === undefined) {
      const ms = Date.parse(`${date[1]}T00:00:00Z`);
      if (Number.isFinite(ms)) record.postedAt = ms;
    }
  }

  return [...byId.values()].filter((job) => job.title && job.url);
}

/**
 * A listing page that parses to nothing is either a markup change or a block —
 * both are failures, and both must be reported. Returning [] would show up as a
 * board with no openings, which is indistinguishable from a healthy quiet board
 * and is the failure mode that makes scrapers untrustworthy.
 *
 * The emptiness test is the posting-link SHAPE rather than a marker word: if the
 * page still contains posting links and the parser found none, the parser is
 * what broke.
 * @param {string} html
 * @param {string} url
 */
export function assertParsedSomething(html, url) {
  if (!/\/jobseekers\/[^"]*?_e_\d+\.html/i.test(String(html ?? ''))) return;
  throw new Error(
    `senjob: ${url} still contains posting links but none could be parsed — the listing markup changed`,
  );
}

/** @type {Provider} */
export default {
  id: 'senjob',

  detect(entry) {
    return entry?.provider === 'senjob' ? { url: LIST_URL } : null;
  },

  async fetch(entry, ctx) {
    // `max_pages` on the portals entry is the user's setting; `ctx.maxPages` is a
    // caller-side bound — verify-portals' health probe passes 1. Reading only the
    // latter ignored the configuration entirely. Same shape as alibaba.mjs.
    const entryMaxPages = Number.isInteger(entry?.max_pages) && entry.max_pages > 0
      ? Math.min(entry.max_pages, MAX_PAGES_CAP)
      : DEFAULT_MAX_PAGES;
    const maxPages = Math.min(
      entryMaxPages,
      Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity,
    );

    /** @type {any[]} */
    const jobs = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(ctx, INTER_PAGE_DELAY_MS);

      const url = assertSenjobUrl(buildListUrl(page));
      const html = await fetchTextWithRetry(ctx, url, {
        headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT },
        redirect: 'error',
      });

      const parsed = parseListingPage(html);
      if (parsed.length === 0) {
        // Page 1 parsing to nothing is a hard failure; a later page running dry
        // is just the end of the board.
        if (page === 1) assertParsedSomething(html, url);
        break;
      }

      // The board pins "sticky" postings to the top of every page, so a page
      // that adds nothing new is the end of the run, not a reason to keep going.
      const before = seen.size;
      for (const job of parsed) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      if (seen.size === before) break;
    }

    return jobs;
  },
};
