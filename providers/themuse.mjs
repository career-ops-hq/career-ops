// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// The Muse provider — server-rendered search page.
//
// The public JSON jobs API (https://www.themuse.com/api/public/jobs) was
// closed ~2026-11-09 (it now 404s), so this reads the server-rendered
// /search HTML instead: 20 job cards per page, no auth, the scanner's
// DEFAULT_USER_AGENT (no browser user agent needed). The page's own RSC
// flight payload duplicates the markup as JSON strings inside <script> —
// the parser anchors on literal <article> tags, which only the visible
// HTML carries, so a card can never be counted twice.
//
// Wire in via a `job_boards:` entry with `provider: themuse`. Optional
// entry fields narrow the search (all become URL parameters): `location`,
// `query` (-> q), `category`, `remote` (-> remote=1), `posted` (1, 7 or 30).
// Without them the provider reads the global feed, like the old API version
// did. Example stanza (see templates/portals.example.yml):
//
//   - name: The Muse
//     provider: themuse
//     location: Germany
//     posted: 30
//     enabled: true

import { sleep, fetchTextWithRetry } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

const SEARCH_BASE = 'https://www.themuse.com/search';
const TRUSTED_HOST = 'www.themuse.com';

// 20 cards per page, as the live page renders them.
const PAGE_SIZE = 20;

// Pagination ceiling (ADDING_A_PROVIDER.md §2: the page count must never
// come from the source-reported total alone). The feed carries ~122,000
// jobs; this board only ever samples the first slice of it. An entry may
// raise the ceiling with `max_pages`, hard-capped at 1500.
const DEFAULT_MAX_PAGES = 100; // when the entry sets no max_pages
const MAX_PAGES_CAP = 1500; // hard ceiling even for a user override

function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

// Retry policy for transient page failures (429 rate-limit, 5xx,
// timeouts/aborts). The Muse sits behind Cloudflare, so this keeps the
// previous provider's 3-retry cadence (workday.mjs / oraclecloud.mjs use
// the same override for the same reason).
const RETRY_POLICY = { retries: 3, baseDelayMs: 500, maxDelayMs: 8_000 };

// Delay between successive pages so a 100-page walk doesn't fire as a burst
// against the same host (mirrors workday.mjs / oraclecloud.mjs).
const INTER_PAGE_DELAY_MS = 250;

const POSTED_VALUES = new Set([1, 7, 30]);
// The site's category values are slugs (e.g. software-engineering).
const CATEGORY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A job link is exactly /jobs/{company}/{slug}; anything else is not a
// posting link and the card is dropped, not followed.
const JOB_HREF_RE = /^\/jobs\/[^/?#\s]+\/[^/?#\s]+$/;
// A lone UTF-16 surrogate survives JSON/HTML transport but breaks URL
// handling downstream — a card carrying one in a host-controlled value is
// dropped, never allowed to abort the page (see url-encoding-surrogate).
const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/;

// <article class="sr-tile" ...> — the first card on a page also carries
// sr-tile--selected. The \b after sr-tile keeps this from matching
// sr-tile__title / sr-tile__details class names.
const CARD_OPEN_RE = /<article\b[^>]*class="[^"]*\bsr-tile\b[^"]*"[^>]*>/g;
const JOB_ID_RE = /data-job-id="([^"]+)"/;
const TITLE_LINK_RE = /<h2\b[^>]*class="[^"]*\bsr-tile__title\b[^"]*"[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
const PROFILE_LINK_RE = /<a\b[^>]*href="(\/profiles\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/;
const DETAILS_RE = /<div\b[^>]*class="[^"]*\bsr-tile__details\b[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const PARA_RE = /<p>([\s\S]*?)<\/p>/g;
const COUNT_RE = /<h1\b[^>]*class="[^"]*\bsr-count\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/;
const POSTED_ON_RE = /Posted on\s+([A-Za-z]+)\s+(\d{1,2})/;

const MONTH_INDEX = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/** @param {string} url */
function assertMuseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`themuse: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`themuse: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`themuse: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/**
 * Plain text of an HTML fragment: React comment markers and tags out,
 * entities decoded, whitespace collapsed. Mirrors builtin.mjs's stripTags.
 * @param {string} s
 */
function cleanText(s) {
  return decodeEntities(
    String(s).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

/**
 * Parse a "Posted on Nov 10" date into epoch ms. The site gives no year:
 * use the current year, and the previous year when that date would be in
 * the future (a "Dec 30" posting seen on Jan 5 is last year's). Returns
 * undefined when the text carries no parseable date. `now` is injectable
 * for tests; the time of day is UTC midnight — the site states no time.
 *
 * @param {string} text
 * @param {number} [now] epoch ms
 * @returns {number|undefined}
 */
export function parsePostedOn(text, now = Date.now()) {
  if (typeof text !== 'string') return undefined;
  const m = POSTED_ON_RE.exec(text);
  if (!m) return undefined;
  const month = MONTH_INDEX[m[1].toLowerCase()];
  const day = Number(m[2]);
  if (month === undefined || day < 1 || day > 31) return undefined;
  const year = new Date(now).getUTCFullYear();
  let ms = Date.UTC(year, month, day);
  if (ms > now) ms = Date.UTC(year - 1, month, day);
  return ms;
}

/**
 * Parse one job card (<article class="sr-tile" ...>) into a Job, or null
 * when the card is malformed (bad/missing link, empty title). A malformed
 * card is dropped, never fatal to the page — the layout-change case (no
 * title link at all) is detected by parseSearchPage before this runs.
 *
 * @param {string} seg card HTML
 * @param {string} locationParam the entry's `location` value, or ''
 * @param {number} [now] epoch ms, injectable for tests
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number, externalId?: string } | null}
 */
function parseMuseCard(seg, locationParam, now = Date.now()) {
  const titleMatch = TITLE_LINK_RE.exec(seg);
  if (!titleMatch) return null;
  // Attribute mode: an href may carry &amp; (the site's own links do in
  // query strings); a bare decode would leave it literal.
  const href = decodeEntities(titleMatch[1], { bareNumeric: true }).trim();
  if (!JOB_HREF_RE.test(href) || LONE_SURROGATE_RE.test(href)) return null;
  const title = cleanText(titleMatch[2]);
  if (!title) return null;
  const url = `https://${TRUSTED_HOST}${href}`;

  const profileMatch = PROFILE_LINK_RE.exec(seg);
  const company = profileMatch ? cleanText(profileMatch[2]) : '';

  let location = '';
  let postedAt;
  const detailsMatch = DETAILS_RE.exec(seg);
  if (detailsMatch) {
    const paras = [...detailsMatch[1].matchAll(PARA_RE)].map((m) => m[1]);
    if (paras.length > 0) {
      // "At <company> - <location>": the location is the text after the
      // last " - " (a company name may itself contain one).
      const firstLine = cleanText(paras[0]);
      const dash = firstLine.lastIndexOf(' - ');
      location = dash === -1 ? '' : firstLine.slice(dash + 3).trim();
      // "Remote / Flexible" names no place: for a run scoped by a location
      // parameter, complete it from that parameter (e.g. "Remote / Flexible,
      // Germany") — otherwise the location filter drops these jobs. Without
      // a parameter the raw text stands, as the old API provider's
      // locations[0].name did.
      if (location === 'Remote / Flexible' && locationParam) {
        location = `Remote / Flexible, ${locationParam}`;
      }
    }
    const postedPara = paras.find((p) => /Posted on/.test(p));
    if (postedPara) postedAt = parsePostedOn(cleanText(postedPara), now);
  }

  const job = { title, url, company, location };
  if (postedAt !== undefined) job.postedAt = postedAt;
  const idMatch = JOB_ID_RE.exec(seg);
  if (idMatch && !LONE_SURROGATE_RE.test(idMatch[1])) job.externalId = idMatch[1];
  return job;
}

/**
 * Parse one /search HTML page into its total and job rows. Pure; exported
 * for unit tests. Never throws for a layout problem — it returns
 * `layoutError` instead, so fetch() can throw on page 1 and truncate with
 * a warning on later pages. A count of 0 with no cards is a valid empty
 * result, not a layout error.
 *
 * @param {string} html
 * @param {{ location?: string, now?: number }} [opts]
 * @returns {{ total: number, jobs: Array<{ title: string, url: string, company: string, location: string, postedAt?: number, externalId?: string }>, layoutError: string | null }}
 */
export function parseSearchPage(html, { location = '', now = Date.now() } = {}) {
  if (typeof html !== 'string') {
    return { total: 0, jobs: [], layoutError: 'themuse: layout change — search page is not HTML text' };
  }
  const countMatch = COUNT_RE.exec(html);
  if (!countMatch) {
    return { total: 0, jobs: [], layoutError: 'themuse: layout change — no h1.sr-count on the search page' };
  }
  // "122,312 jobs" — strip the thousands separator before reading the number.
  const countDigits = cleanText(countMatch[1]).replace(/,/g, '').match(/\d+/);
  if (!countDigits) {
    return { total: 0, jobs: [], layoutError: 'themuse: layout change — h1.sr-count carries no job count' };
  }
  const total = parseInt(countDigits[0], 10);

  const starts = [];
  CARD_OPEN_RE.lastIndex = 0;
  for (const m of html.matchAll(CARD_OPEN_RE)) starts.push(/** @type {number} */ (m.index));
  if (total > 0 && starts.length === 0) {
    return { total, jobs: [], layoutError: `themuse: layout change — ${total} jobs reported but no job cards found` };
  }

  const jobs = [];
  let layoutError = null;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const next = starts[i + 1] ?? html.length;
    const close = html.indexOf('</article>', start);
    const end = close === -1 ? next : Math.min(close + '</article>'.length, next);
    const seg = html.slice(start, end);
    // A card with no title link at all is a markup change, not a bad row:
    // stop the page here and report it (page 1 throws, later pages
    // truncate). Cards before it on the page are kept.
    if (!TITLE_LINK_RE.test(seg)) {
      layoutError = 'themuse: layout change — a job card has no title link';
      break;
    }
    const job = parseMuseCard(seg, location, now);
    if (job) jobs.push(job);
  }
  return { total, jobs, layoutError };
}

/**
 * Read the optional search fields off a portals.yml entry and build the
 * /search query string. Throws with a clear message on an invalid value —
 * before any network call — so a typo in config fails loud instead of
 * silently returning the wrong board (or the whole unfiltered feed).
 *
 * @param {any} entry
 * @returns {{ params: URLSearchParams, location: string }}
 */
function readSearchParams(entry) {
  const params = new URLSearchParams();
  let location = '';

  const rawLocation = entry?.location;
  if (rawLocation !== undefined) {
    if (typeof rawLocation !== 'string' || !rawLocation.trim()) {
      throw new Error('themuse: `location` must be a non-empty string');
    }
    location = rawLocation.trim();
    params.set('location', location);
  }
  const rawQuery = entry?.query;
  if (rawQuery !== undefined) {
    if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
      throw new Error('themuse: `query` must be a non-empty string');
    }
    params.set('q', rawQuery.trim());
  }
  const rawCategory = entry?.category;
  if (rawCategory !== undefined) {
    if (typeof rawCategory !== 'string' || !CATEGORY_RE.test(rawCategory)) {
      throw new Error('themuse: `category` must be a lowercase slug like `software-engineering`');
    }
    params.set('category', rawCategory);
  }
  const rawRemote = entry?.remote;
  if (rawRemote !== undefined) {
    if (typeof rawRemote !== 'boolean') {
      throw new Error('themuse: `remote` must be true or false');
    }
    if (rawRemote) params.set('remote', '1');
  }
  const rawPosted = entry?.posted;
  if (rawPosted !== undefined) {
    const n = typeof rawPosted === 'string' ? Number(rawPosted) : rawPosted;
    if (!POSTED_VALUES.has(n)) {
      throw new Error('themuse: `posted` must be 1, 7 or 30');
    }
    params.set('posted', String(n));
  }
  return { params, location };
}

/**
 * @param {URLSearchParams} params
 * @param {number} page 1-based; page 1 carries no `page` parameter (the
 *   site treats page=0, page=1 and no page identically, so sending one
 *   would re-read page 1).
 */
function buildSearchUrl(params, page) {
  const qs = new URLSearchParams(params);
  if (page > 1) qs.set('page', String(page));
  const q = qs.toString();
  return q ? `${SEARCH_BASE}?${q}` : SEARCH_BASE;
}

/** @type {Provider} */
export default {
  id: 'themuse',

  async fetch(entry, ctx) {
    const { params, location } = readSearchParams(entry);

    // verify-portals' health probe sets ctx.maxPages: one page, no retries,
    // and a fetch rejection propagates unwrapped (mirrors computrabajo.mjs).
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const retryPolicy = probing ? { retries: 0 } : RETRY_POLICY;

    // Page 1 is fetched outside the tolerant loop below and its failure is
    // NOT caught: a completely dead board must throw, not return []. A
    // caught page-1 failure would return an empty array indistinguishable
    // from a healthy "0 jobs today" result -- scan.mjs's consecutive-failure
    // detector resets its streak on any non-throwing fetch, so a themuse
    // outage would silently reset the very detector meant to catch it.
    const firstUrl = assertMuseUrl(buildSearchUrl(params, 1));
    // redirect:'error' prevents SSRF via server-side redirects
    const firstHtml = await fetchTextWithRetry(ctx, firstUrl, { redirect: 'error' }, retryPolicy);
    const first = parseSearchPage(firstHtml, { location });
    if (first.layoutError) throw new Error(first.layoutError);
    const jobs = [...first.jobs];
    // The source-reported total enters only through Math.min with the
    // provider's own ceiling — it can never drive an unbounded walk.
    const rawPageCount = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
    const ceiling = resolveMaxPages(entry);
    const pageCount = Math.min(rawPageCount, ceiling);
    const pagesToFetch = probing ? Math.min(pageCount, ctx.maxPages) : pageCount;
    /** @type {'complete'|'cap'|'fetch-error'|'layout-change'} */
    let stopReason = 'complete';

    // Pages 2+ stay tolerant: a page that exhausts retries, OR comes back
    // with a changed layout, truncates with a warning and returns whatever
    // was already gathered instead of discarding it.
    for (let page = 2; page <= pagesToFetch; page++) {
      await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = assertMuseUrl(buildSearchUrl(params, page));
      let html;
      try {
        html = await fetchTextWithRetry(ctx, url, { redirect: 'error' }, retryPolicy);
      } catch (err) {
        if (probing) throw err;
        const attempts = Number.isInteger(err?.attempts) ? err.attempts : 1;
        console.error(`⚠️  themuse: truncated at page ${page} of ${pageCount} after ${attempts} attempt${attempts === 1 ? '' : 's'} (${jobs.length} jobs gathered so far): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }
      const parsed = parseSearchPage(html, { location });
      if (parsed.layoutError) {
        if (probing) throw new Error(parsed.layoutError);
        jobs.push(...parsed.jobs);
        console.error(`⚠️  themuse: ${parsed.layoutError} on page ${page} — keeping the ${jobs.length} jobs gathered so far`);
        stopReason = 'layout-change';
        break;
      }
      jobs.push(...parsed.jobs);
    }

    if (stopReason === 'complete' && !probing && rawPageCount > ceiling) {
      stopReason = 'cap';
      console.error(`⚠️  themuse: stopped at the ${ceiling}-page cap (${jobs.length} of ${first.total} jobs) — raise max_pages on this entry to fetch more, or narrow the search with location, query or posted`);
    }
    if (stopReason !== 'complete') {
      markTruncated(jobs, stopReason === 'cap' ? 'page-cap' : stopReason, { fetched: jobs.length, total: first.total });
    }
    return jobs;
  },
};
