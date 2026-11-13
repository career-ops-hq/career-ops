// @ts-check
import { decodeEntities } from './_html-entities.mjs';
import { fetchJsonWithRetry, sleep, BROWSER_LIKE_USER_AGENT } from './_http.mjs';
/** @typedef {import('./_types.js').Provider} Provider */

// EU Remote Jobs provider — https://euremotejobs.com, a remote-jobs board for
// roles open to candidates in Europe and the UK. Target list: `job_boards:`
// (one board, many employers). Wire it in with an explicit entry:
//
//   job_boards:
//     - name: EU Remote Jobs
//       provider: euremotejobs
//
// The site runs the WP Job Manager plugin, but the generic
// providers/wp-job-manager.mjs cannot read it: the board answers its RSS feed
// (`/?feed=job_feed`) and the WordPress REST API with 401 "Not available."
// (measured 2026-10-28). The listing page's own "load more" button calls the
// plugin's public AJAX endpoint instead, `/jm-ajax/get_listings/`, which
// returns `{ found_jobs, max_num_pages, html }` with one `<li>` card per
// posting. That endpoint is what this provider reads, newest first after the
// board's featured postings, 100 cards a page (about 78 pages, roughly four
// months of postings, on 2026-10-28).
//
// The board's CDN answers the default career-ops User-Agent with HTTP 520
// (checked 2026-11-13) and the same request with a browser-like one with 200,
// so the list request sends BROWSER_LIKE_USER_AGENT, as ADDING_A_PROVIDER.md
// allows for a WAF/CDN that blocks the default.
//
// robots.txt (Source Indexing Policy rule 6): `User-agent: *` disallows
// `/wp-admin/`, the add-to-cart routes and any query carrying a `search_*`
// filter. `/jm-ajax/` is not disallowed and this provider sends no `search_*`
// parameter, only `per_page` and `page`.
//
// Each card links to the board's own posting page. The employer's application
// link only appears on that detail page, so the board page is `Job.url`
// (rule 2 fallback). The card carries no absolute date, only WordPress's
// relative "Posted 3 days ago" label, which is turned into an approximate
// `postedAt`; a label that does not parse leaves `postedAt` unset.

const HOST = 'euremotejobs.com';
const PAGE_SIZE = 100;

/** 100 pages of 100 covers the whole board today (~78 pages); raise with `max_pages`. */
const DEFAULT_MAX_PAGES = 100;

/** Hard ceiling on a configured `max_pages`, independent of what the board reports. */
const MAX_PAGES_CAP = 200;

/** One WordPress host; polite spacing, not a measured rate limit. */
const INTER_PAGE_DELAY_MS = 500;

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @param {number} page */
export function listUrl(page) {
  return `https://${HOST}/jm-ajax/get_listings/?per_page=${PAGE_SIZE}&page=${page}`;
}

/** Strip tags, decode entities, collapse whitespace. */
function visibleText(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Keep only an absolute HTTPS posting link on the board's own host.
 * @param {string} raw
 */
function cleanJobUrl(raw) {
  if (!raw) return '';
  try {
    const parsed = new URL(decodeEntities(raw.trim()));
    if (parsed.protocol !== 'https:') return '';
    if (parsed.hostname.toLowerCase() !== HOST) return '';
    if (!parsed.pathname.startsWith('/job/')) return '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return '';
  }
}

const UNIT_MS = /** @type {const} */ ({
  sec: 1_000,
  second: 1_000,
  min: 60_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
});

/**
 * Parse WordPress's relative "Posted 3 days ago" label into epoch ms. An
 * unrecognised label returns undefined — `postedAt` is optional, and guessing a
 * date would be a fabricated claim.
 * @param {string} text
 * @param {number} nowMs
 * @returns {number | undefined}
 */
export function parseRelativePosted(text, nowMs = Date.now()) {
  const t = String(text ?? '').toLowerCase();
  if (/\b(just now|today)\b/.test(t)) return nowMs;
  const m = /(\d+)\s*(sec|second|min|minute|hour|day|week|month|year)s?\b/.exec(t);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return nowMs - n * UNIT_MS[/** @type {keyof typeof UNIT_MS} */ (m[2])];
}

const CARD_START_RE = /<li\s+id="job_listing-\d+"/g;

/**
 * Parse one `/jm-ajax/get_listings/` response. Exported for unit tests.
 *
 * Returns `rawCount` — the number of cards the board sent, before malformed
 * ones are dropped — so the pagination stop reads the source's own page shape.
 *
 * @param {any} json - parsed response body
 * @param {number} [nowMs] - clock for the relative date label
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string, postedAt?: number}>, rawCount: number, maxNumPages: number | undefined }}
 */
export function parseEuRemoteJobsListings(json, nowMs = Date.now()) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`euremotejobs: unexpected response — expected an object, got: ${Array.isArray(json) ? 'array' : typeof json}`);
  }
  if (typeof json.html !== 'string' || typeof json.found_jobs !== 'boolean') {
    throw new Error(`euremotejobs: unexpected response — expected found_jobs + html, got: [${Object.keys(json).join(', ')}]`);
  }
  const maxNumPages = Number.isInteger(json.max_num_pages) ? json.max_num_pages : undefined;
  if (json.found_jobs === false) return { jobs: [], rawCount: 0, maxNumPages };

  const html = json.html;
  /** @type {number[]} */
  const starts = [];
  CARD_START_RE.lastIndex = 0;
  let m;
  while ((m = CARD_START_RE.exec(html)) !== null) starts.push(m.index);
  if (starts.length === 0) {
    // found_jobs:true with no card at all is a markup change, not an empty board.
    throw new Error('euremotejobs: found_jobs is true but no job_listing card was found — the listing markup changed');
  }

  const jobs = [];
  for (let i = 0; i < starts.length; i++) {
    const card = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : html.length);

    const href = /\bdata-href="([^"]*)"/.exec(card)?.[1]
      || /<a\s+href="([^"]*)"\s+class="job_listing-clickbox"/.exec(card)?.[1]
      || '';
    const url = cleanJobUrl(href);
    if (!url) continue;

    const title = visibleText(/<h3\s+class="job_listing-title">([\s\S]*?)<\/h3>/.exec(card)?.[1]);
    if (!title) continue;

    const company = visibleText(/<div\s+class="job_listing-company">\s*<strong>([\s\S]*?)<\/strong>/.exec(card)?.[1]);
    const location = visibleText(/<div\s+class="job_listing-location[^"]*">([\s\S]*?)<\/div>/.exec(card)?.[1]);
    const postedAt = parseRelativePosted(
      visibleText(/<li\s+class="job_listing-date">([\s\S]*?)<\/li>/.exec(card)?.[1]),
      nowMs,
    );

    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = { title, url, company, location };
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  return { jobs, rawCount: starts.length, maxNumPages };
}

/** @type {Provider} */
export default {
  id: 'euremotejobs',

  detect(entry) {
    return entry?.provider === 'euremotejobs' ? { url: `https://${HOST}/jobs/` } : null;
  },

  async fetch(entry, ctx) {
    const maxPages = resolveMaxPages(entry);
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const pagesToFetch = Math.min(maxPages, probing ? ctxMaxPages : Infinity);
    const nowMs = Date.now();

    /** @type {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>} */
    const jobs = [];
    const seen = new Set();
    /** @type {'complete' | 'cap' | 'probe' | 'fetch-error'} */
    let stopReason = 'complete';

    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let json;
      try {
        // Fixed literal host, HTTPS; redirect:'error' keeps the request pinned to it.
        json = await fetchJsonWithRetry(ctx, listUrl(page), { redirect: 'error', headers: { 'user-agent': BROWSER_LIKE_USER_AGENT } });
      } catch (err) {
        // Page 1 (nothing collected yet) and every probe request fail loud and
        // unwrapped; deeper pages in a real scan keep what was collected.
        if (probing || page === 1) throw err;
        stopReason = 'fetch-error';
        console.error(`⚠️  euremotejobs: page ${page} failed (${err?.message ?? err}) — keeping ${jobs.length} postings from earlier pages`);
        break;
      }

      const { jobs: pageJobs, rawCount, maxNumPages } = parseEuRemoteJobsListings(json, nowMs);
      for (const job of pageJobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }

      // A short page, or the last page the board reports, ends the walk on its own.
      if (rawCount < PAGE_SIZE) break;
      if (maxNumPages !== undefined && page >= maxNumPages) break;
      if (page === pagesToFetch) stopReason = probing && ctxMaxPages <= maxPages ? 'probe' : 'cap';
    }

    if (stopReason === 'cap') {
      console.error(`⚠️  euremotejobs: stopped at max_pages=${maxPages} with more pages left — raise max_pages on this entry for the full board`);
    }
    return jobs;
  },
};
