// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// CareerViet provider — https://careerviet.vn, a broad-coverage Vietnamese job
// board. Wire in via a `job_boards:` entry with `provider: careerviet`.
// Optional per-entry tuning follows the itviec convention: `searchKeywords`
// narrows the listing and `searchLocation` pins a city.
//
// Measured on 2026-08-26: careerviet.vn's search results are fully
// server-rendered over plain HTTPS — no interstitial, no auth, no JS needed to
// see the cards. robots.txt (fetched 2026-08-26) explicitly ALLOWS ClaudeBot
// and GPTBot by name, and disallows only `/vi/jobs/*`, `/en/jobs/*`,
// `/en/tim-viec-lam/*` and `/api/*` — none of which this provider requests
// (job detail pages live under `/vi/tim-viec-lam/`, search under `/viec-lam/`).
// That is a deliberate contrast with two sibling VN boards evaluated alongside
// it: TopDev and CareerLink are ALSO server-rendered, but their robots.txt
// individually name-block ClaudeBot/Claude-Web/anthropic-ai, so this project
// skips them rather than routing around a stated block under a different
// user-agent string.
//
// Only Ho Chi Minh's city code (`kl8`) has been verified live. A sibling
// scraper project (goodjobs) recorded codes for Hanoi/Da Nang that no longer
// resolve to a real listing as of 2026-08-26 — they silently redirect to the
// generic homepage instead of a filtered result — so an unrecognized OR
// unverified city is dropped rather than guessed into the URL, same policy as
// itviec.mjs's cityPath().
//
// PARSING CONTRACT. Cards window on `id="job-item-{ID}"` — a per-card DOM id
// carrying the posting's own ID, the anchor least likely to move in a
// redesign. Inside each window:
//
//   1. title + URL come from the FIRST `<a class="job_link" title="{title}"
//      href="{url}">` — the identical anchor repeats later in the same card,
//      wrapping the salary/location/time block, so windowing must stop at the
//      first match rather than collect every one;
//   2. company from `<a class="company-name" title="{name}">`;
//   3. location from the `.location` block's first `<li>`;
//   4. postedAt from the "Cập nhật" (updated) `<time>`, never "Hạn nộp"
//      (application deadline) — both share the same `.time` block and only
//      the preceding label text distinguishes them.
//
// A first page that still contains job cards but parses to none THROWS,
// exactly like itviec.mjs — a broken parser must look like a broken board,
// never a market with no jobs.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const TRUSTED_HOST = 'careerviet.vn';
const BASE_URL = 'https://careerviet.vn/viec-lam';

/** Pages run ~50 postings; 10 covers the freshest slice of the board. */
const DEFAULT_MAX_PAGES = 10;

/** Hard ceiling on a configured `max_pages`, so one entry cannot sweep forever. */
const MAX_PAGES_CAP = 50;

/**
 * Pacing between pages of the SAME board. No 429 was observed while probing
 * (unlike itviec), but a Next.js SSR board under a fast sweep is exactly the
 * shape that rate-limits, so this errs toward the same measured caution
 * rather than assuming none is needed.
 */
const INTER_PAGE_DELAY_MS = 750;

/** A card window opens at its own DOM id; everything up to the next one belongs to it. */
const CARD_SPLIT_RE = /id=["']job-item-([A-Za-z0-9]+)["']/g;

/**
 * Title + URL: the FIRST job_link anchor in the window. A second, identically
 * classed anchor wraps the salary/location/time block further down the same
 * card — this regex has no /g flag, so `.exec()` always returns that first one.
 */
const TITLE_LINK_RE = /<a class=["']job_link["'][^>]*title=["']([^"']*)["'][^>]*href=["']([^"']+)["']/i;

/** Company: the title attribute of the company-name anchor. */
const COMPANY_RE = /<a class=["']company-name["'][^>]*title=["']([^"']*)["']/i;

/**
 * Location: the first <li> inside the .location block. The gap is bounded to
 * the block's own content (never crossing its closing </div>) — an unbounded
 * lazy match would, on a card whose .location renders empty, keep scanning
 * into the sibling .time block and misread a date as a location.
 */
const LOCATION_RE = /<div class=["']location["'][^>]*>(?:(?!<\/div>)[\s\S])*?<li>([^<]*)<\/li>/i;

/**
 * The "Cập nhật" (updated) date sits in its own <li>, sibling to "Hạn nộp"
 * (deadline) inside the same .time block — the label text is what tells them
 * apart; both wrap their <time> the same way.
 */
const UPDATED_DATE_RE = /Cập nhật(?:<!--[\s\S]*?-->)?\s*:?\s*(?:<\/span>)?\s*<time>([\d/-]+)<\/time>/i;

/** @param {any} ctx @param {number} ms */
function sleep(ctx, ms) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string} url */
function assertCareerVietUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`careerviet: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`careerviet: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`careerviet: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/**
 * Collapse a markup fragment to its visible text.
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
 * Only Ho Chi Minh's code was confirmed live on 2026-08-26. Hanoi/Da Nang
 * codes recorded by goodjobs (a sibling scraper project) no longer resolve to
 * a real listing — they are deliberately left out rather than shipped
 * unverified.
 */
const CITY_SLUGS = /** @type {const} */ ({
  hcm: 'tai-ho-chi-minh-kl8',
  'ho chi minh': 'tai-ho-chi-minh-kl8',
  'hồ chí minh': 'tai-ho-chi-minh-kl8',
});

/**
 * Resolve an entry location string to a CareerViet city path segment.
 * @param {string} location
 * @returns {string | null}
 */
export function citySegment(location) {
  const key = String(location ?? '').trim().toLowerCase();
  if (!key) return null;
  // Own-property check: a user string like "constructor" or "toString" must
  // resolve to null, not to an inherited Object.prototype member whose source
  // text would then be interpolated into the request URL (same guard as
  // itviec.mjs's cityPath(), #3229).
  if (Object.hasOwn(CITY_SLUGS, key)) return CITY_SLUGS[key];
  for (const [candidate, slug] of Object.entries(CITY_SLUGS)) {
    if (key.includes(candidate)) return slug;
  }
  return null;
}

/**
 * Build the listing URL for a page.
 *
 * The board-wide default slug is "tat-ca-viec-lam" (all jobs); a configured
 * keyword narrows it to "{keyword}-k", and a RECOGNIZED city further narrows
 * a keyword search to "{keyword}-{city-segment}" — matching the URL shapes
 * the board's own search form and advanced filters generate. A city with no
 * keyword has no working URL on this board (confirmed 2026-08-26: it
 * redirects to the generic homepage instead of a filtered result), so it is
 * dropped rather than guessed.
 * @param {{ searchKeywords?: string, searchLocation?: string }} [entry]
 * @param {number} page
 */
export function buildListUrl(entry, page) {
  const keywords = String(entry?.searchKeywords ?? '').trim().replace(/\s+/g, '-').toLowerCase();
  const city = citySegment(entry?.searchLocation);

  let slug;
  if (keywords && city) slug = `${encodeURIComponent(keywords).replace(/%2F/gi, '')}-${city}`;
  else if (keywords) slug = `${encodeURIComponent(keywords).replace(/%2F/gi, '')}-k`;
  else slug = 'tat-ca-viec-lam';

  const suffix = page <= 1 ? '-vi.html' : `-trang-${page}-vi.html`;
  return `${BASE_URL}/${slug}${suffix}`;
}

/**
 * Parse careerviet's own "DD-MM-YYYY" date format into epoch ms at Vietnam's
 * offset (UTC+7, no DST). Unparseable input returns undefined — the contract
 * documents postedAt as omittable, and inventing a date would be a fabricated
 * claim.
 * @param {string} text
 * @returns {number | undefined}
 */
export function parsePostedAt(text) {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(String(text ?? '').trim());
  if (!m) return undefined;
  const [, d, mo, y] = m;
  const ms = Date.parse(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00+07:00`);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Parse one listing page into postings.
 *
 * Cards are split on the job-item id, then each window contributes at most
 * one record keyed by that id — the parser scopes strictly to its own window
 * so a field missing on one card never leaks in from a neighbour.
 *
 * @param {string} html - Raw listing page.
 * @returns {{title: string, url: string, company: string, location: string, postedAt?: number}[]}
 */
export function parseListingPage(html) {
  const source = String(html ?? '');
  CARD_SPLIT_RE.lastIndex = 0;

  /** @type {Map<string, {title: string, url: string, company: string, location: string, postedAt?: number}>} */
  const byId = new Map();

  // Collect the windows first so each card's scope ends where the next begins.
  /** @type {{id: string, start: number, end: number}[]} */
  const windows = [];
  let m;
  while ((m = CARD_SPLIT_RE.exec(source)) !== null) {
    if (windows.length > 0) windows[windows.length - 1].end = m.index;
    windows.push({ id: m[1], start: m.index, end: source.length });
  }

  for (const win of windows) {
    if (byId.has(win.id)) continue;
    const card = source.slice(win.start, win.end);

    const titleMatch = TITLE_LINK_RE.exec(card);
    const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';
    const href = titleMatch ? titleMatch[2] : '';
    if (!title || !href) continue;

    // A malformed href must drop just this card, not throw out of
    // parseListingPage and fail the whole board. An absolute href resolving
    // to another host (an ad slot or partner card reusing the same anchor
    // class) is equally not a careerviet.vn posting — same skip.
    let url;
    try {
      const resolved = new URL(decodeEntities(href), `https://${TRUSTED_HOST}`);
      if (resolved.protocol !== 'https:' || resolved.hostname !== TRUSTED_HOST) continue;
      url = resolved.toString();
    } catch {
      continue;
    }

    const companyMatch = COMPANY_RE.exec(card);
    const company = companyMatch ? decodeEntities(companyMatch[1]).trim() : '';

    const locMatch = LOCATION_RE.exec(card);
    const location = locMatch ? visibleText(locMatch[1]) : '';

    const dateMatch = UPDATED_DATE_RE.exec(card);
    const postedAt = dateMatch ? parsePostedAt(dateMatch[1]) : undefined;

    byId.set(win.id, {
      title,
      url,
      company,
      location,
      ...(postedAt !== undefined ? { postedAt } : {}),
    });
  }

  return [...byId.values()];
}

/**
 * A listing page that parses to nothing is either a markup change or a block
 * — both are failures, and both must be reported. Returning [] would show up
 * as a board with no openings, indistinguishable from a healthy quiet board.
 *
 * The emptiness test is the card-marker SHAPE (a job-item DOM id) rather than
 * a marker word, so it survives the board's own "no results" copy changing.
 * @param {string} html
 * @param {string} url
 */
export function assertParsedSomething(html, url) {
  if (!/id=["']job-item-[A-Za-z0-9]+["']/.test(String(html ?? ''))) return;
  throw new Error(
    `careerviet: ${url} still contains job cards but none could be parsed — the listing markup changed`,
  );
}

/** @type {Provider} */
export default {
  id: 'careerviet',

  detect(entry) {
    return entry?.provider === 'careerviet' ? { url: buildListUrl(entry, 1) } : null;
  },

  async fetch(entry, ctx) {
    // `max_pages` on the portals entry is the user's setting; `ctx.maxPages` is a
    // caller-side bound — verify-portals' health probe passes 1. Same shape as itviec.mjs.
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

      const url = assertCareerVietUrl(buildListUrl(entry, page));
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
