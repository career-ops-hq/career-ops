// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';

// Jobicy provider — board-wide remote-jobs aggregator feed, for a `job_boards:`
// entry with `provider: jobicy` (https://jobicy.com/api/v2/remote-jobs).
//
// Official remote-only feed contract: https://jobicy.com/jobs-rss-feed
// `jobGeo` is remote location eligibility; `jobDescription` is the full HTML JD.
// Preserve those two independent signals: Worldwide is geography, not a mode.
//
// The feed is a 7-day window, newest first, at most 100 postings a page. Each
// response carries an opaque `nextCursor`: passed back unchanged as `cursor`,
// with the same filters, it returns the next page, and `nextCursor: null` /
// `hasMore: false` ends the walk. Reading only the first page covered a sliver
// of the board: on 2026-11-05 the window held 1,358 postings over 14 pages of
// 100, and the newest 50 had all been published that same day.
//
// Optional entry keys, sent as Jobicy's own server-side filters:
//   geo: latam             # a geoSlug from ?get=locations (argentina, europe, usa, ...)
//   industry: engineering  # an industrySlug from ?get=industries (data-science, qa-testing, ...)
//   tag: python            # keyword matched against the job title
//   max_pages: 25          # pages of 100 per scan (default 25, capped at 100)
// A slug the API does not know is answered with HTTP 400, and that error names
// the list to pick from. Jobicy's fair-use terms ask for one automated pass an
// hour at most, its cursor pages followed in order: one scan is one pass.

const FEED_URL = 'https://jobicy.com/api/v2/remote-jobs';
const PAGE_SIZE = 100; // the API's maximum, and its default
const DEFAULT_MAX_PAGES = 25; // 2,500 postings; the whole window was 14 pages on 2026-11-05
const MAX_PAGES_CAP = 100;
const PAGE_DELAY_MS = 250;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SLUG_LISTS = { geo: 'locations', industry: 'industries' };
const MAX_TAG_LENGTH = 100;
const MAX_CURSOR_LENGTH = 4096;

/** @param {string} text */
const hasControlChar = (text) => [...text].some((c) => c < ' ' || c === '\u007f');

/**
 * The entry's optional Jobicy filters, validated. Exported for unit tests.
 * Throws on a malformed value: a config error, raised before any request.
 *
 * @param {any} entry - The job_boards entry.
 * @returns {{ geo?: string, industry?: string, tag?: string }}
 */
export function jobicyFilters(entry) {
  /** @type {{ geo?: string, industry?: string, tag?: string }} */
  const filters = {};
  const where = `entry "${entry?.name ?? '?'}"`;
  for (const key of /** @type {const} */ (['geo', 'industry'])) {
    const raw = entry?.[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const slug = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!SLUG_RE.test(slug)) {
      throw new Error(`jobicy: ${key} ${JSON.stringify(raw)} in ${where} is not a slug — pick one from ${FEED_URL}?get=${SLUG_LISTS[key]}`);
    }
    filters[key] = slug;
  }
  const tag = entry?.tag;
  if (tag !== undefined && tag !== null && tag !== '') {
    const text = typeof tag === 'string' ? tag.trim() : '';
    if (!text || text.length > MAX_TAG_LENGTH || hasControlChar(text)) {
      throw new Error(`jobicy: tag in ${where} must be one line of 1-${MAX_TAG_LENGTH} characters`);
    }
    filters.tag = text;
  }
  return filters;
}

/**
 * One page's request URL. Exported for unit tests.
 *
 * @param {{ geo?: string, industry?: string, tag?: string }} [filters] - From jobicyFilters().
 * @param {string|null} [cursor] - The previous page's nextCursor; omitted for page one.
 * @returns {string}
 */
export function buildJobicyUrl(filters = {}, cursor = null) {
  const params = new URLSearchParams({ count: String(PAGE_SIZE) });
  for (const key of /** @type {const} */ (['geo', 'industry', 'tag'])) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (cursor) params.set('cursor', cursor);
  return `${FEED_URL}?${params}`;
}

/**
 * Resolve the page cap: a positive integer `max_pages` on the entry, capped.
 * Exported for unit tests.
 *
 * @param {any} entry
 * @returns {number}
 */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * The shared HTTP error says only "HTTP 400 Bad Request". Jobicy's JSON body
 * says which filter it refused and where the valid slugs are listed, so a
 * typo in portals.yml reads as one.
 *
 * @param {any} err
 * @returns {string|null}
 */
function jobicyRejection(err) {
  if (err?.status !== 400 || typeof err.body !== 'string') return null;
  let detail;
  try {
    detail = JSON.parse(err.body)?.error;
  } catch {
    return null;
  }
  if (typeof detail !== 'string') return null;
  const clean = [...detail].filter((c) => c >= ' ' && c !== '\u007f').join('').trim().slice(0, 300);
  return clean ? `Jobicy rejected the request (HTTP 400): ${clean}` : null;
}

/** @type {Provider} */
export default {
  id: 'jobicy',

  detect(entry) {
    if (entry?.provider !== 'jobicy') return null;
    // Never throws: a malformed filter falls back to the unfiltered feed here
    // and is reported by fetch(), which validates before any request.
    try {
      return { url: buildJobicyUrl(jobicyFilters(entry)) };
    } catch {
      return { url: buildJobicyUrl() };
    }
  },

  /**
   * Fetches and normalizes postings from the Jobicy public feed, walking its
   * cursor to the end of the 7-day window.
   * @param {{ name?: string, geo?: string, industry?: string, tag?: string, max_pages?: number }} entry - The job_boards entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const name = entry?.name || 'Jobicy';
    const filters = jobicyFilters(entry);
    const maxPages = resolveMaxPages(entry);
    // verify-portals' liveness probe sets ctx.maxPages: 1. It needs to know the
    // feed answers, not how big it is, and the cap warning below must not fire
    // for it.
    const probing = Number.isInteger(ctx?.maxPages) && /** @type {number} */ (ctx.maxPages) > 0;
    const pagesToFetch = probing ? Math.min(maxPages, /** @type {number} */ (ctx.maxPages)) : maxPages;

    /** @type {ReturnType<typeof parseJobicyResponse>} */
    const jobs = [];
    const seen = new Set();
    const cursorsSeen = new Set();
    /** @type {string|null} */
    let cursor = null;
    // Why the walk stopped: 'complete' (the feed said so), 'cap' (max_pages ran
    // out with a next page on offer), 'fetch-error' or 'unrecognised-page'.
    let stopReason = 'complete';
    for (let page = 0; page < pagesToFetch; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS, ctx);
      let json;
      try {
        // redirect:'error' prevents SSRF via server-side redirects; retries
        // 429 / 5xx / timeouts, never a 400.
        json = await fetchJsonWithRetry(ctx, buildJobicyUrl(filters, cursor), { redirect: 'error' });
      } catch (err) {
        // A probe tells ProbePageBudgetReached apart by identity: never wrap it.
        if (probing) throw err;
        const rejection = jobicyRejection(err);
        // Nothing read yet: the feed, or this entry's filters, is broken, and
        // an empty result would read as "no postings". Fail loud.
        if (page === 0) throw rejection ? new Error(`jobicy: ${name}: ${rejection}`, { cause: err }) : err;
        // Later pages: keep what was read, and say the board is partial.
        console.error(`⚠️  jobicy: ${name} truncated at page ${page + 1} (${jobs.length} jobs kept): ${rejection || /** @type {any} */ (err)?.message}`);
        stopReason = 'fetch-error';
        cursor = null;
        break;
      }

      const rows = json && Array.isArray(json.jobs) ? json.jobs : null;
      if (!rows) {
        const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
        const message = `jobicy: unexpected API response — expected { jobs: [...] }, got keys: [${got}]`;
        if (page === 0) throw new Error(message);
        console.error(`⚠️  jobicy: ${name} truncated at page ${page + 1} (${jobs.length} jobs kept): ${message}`);
        stopReason = 'unrecognised-page';
        cursor = null;
        break;
      }

      for (const job of parseJobicyResponse(json, name)) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }

      // The walk's own end: no next cursor, hasMore false, or an empty page.
      const next = typeof json.nextCursor === 'string' ? json.nextCursor : '';
      if (!next || json.hasMore === false || rows.length === 0) {
        cursor = null;
        break;
      }
      // A repeated or oversized cursor is a broken page, not a longer board.
      if (next.length > MAX_CURSOR_LENGTH || cursorsSeen.has(next)) {
        console.error(`⚠️  jobicy: ${name} stopped at page ${page + 1} (${jobs.length} jobs kept): the API returned ${cursorsSeen.has(next) ? 'a cursor it had already returned' : 'an oversized cursor'}`);
        stopReason = 'unrecognised-page';
        cursor = null;
        break;
      }
      cursorsSeen.add(next);
      cursor = next;
    }

    // Out of pages with another one on offer: our own cap truncated the feed.
    if (stopReason === 'complete' && cursor !== null && !probing) {
      stopReason = 'cap';
      console.error(`⚠️  jobicy: ${name} truncated at max_pages=${maxPages} (${jobs.length} jobs) — raise max_pages on this entry for more`);
    }
    // A cap or a broken page leaves the board partial; tag it (the
    // workdayTruncated convention) so a caller can tell without reading stderr.
    if (stopReason !== 'complete') /** @type {any} */ (jobs).jobicyTruncated = true;
    return jobs;
  },
};

/**
 * Parse a Jobicy API response. Exported for unit tests.
 *
 * @param {any} json - Raw response payload.
 * @param {string} defaultCompany - Fallback company name.
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseJobicyResponse(json, defaultCompany = 'Jobicy') {
  if (!json || !Array.isArray(json.jobs)) return [];

  const toEpochMs = (value) => {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return json.jobs
    .map(j => {
      if (!j || typeof j !== 'object') return null;

      // The feed's text fields arrive HTML-encoded ("Zone &#038; Co").
      const title = typeof j.jobTitle === 'string' ? decodeEntities(j.jobTitle).trim() : '';
      if (!title) return null;

      const rawUrl = typeof j.url === 'string' ? j.url.trim() : '';
      let url = null;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:' && (parsed.hostname === 'jobicy.com' || parsed.hostname === 'www.jobicy.com')) {
          url = parsed.href;
        }
      } catch {
        // Invalid or malformed URL
      }
      if (!url) return null;

      // Decided on the decoded name: "&nbsp;" is not blank until it is decoded.
      const company = (typeof j.companyName === 'string' ? decodeEntities(j.companyName).trim() : '') || defaultCompany;
      const location = typeof j.jobGeo === 'string' ? decodeEntities(j.jobGeo).trim() : '';
      const postedAt = toEpochMs(j.pubDate);

      return {
        title,
        url,
        company,
        location,
        isRemote: true,
        ...(typeof j.jobDescription === 'string' ? { description: j.jobDescription } : {}),
        postedAt,
      };
    })
    .filter(j => j !== null);
}
