// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { closesAtIso } from '../lib/posting-close.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';

// Tes provider — UK and international teaching jobs (https://www.tes.com/jobs),
// for a `job_boards:` entry with `provider: tes` (#6685).
//
// Tes publishes no API. Its search page fills itself from one public,
// unauthenticated tRPC query on the same host, which this provider reads:
//
//   GET https://www.tes.com/jobs/api/trpc/jobs.search?batch=1&input=<json>
//
// The input is the shape the page sends (captured 2026-11-09): `limit`,
// `siteCountry: "gb"` and a `filters` object whose every key is required —
// the endpoint answers HTTP 400 with a zod error naming a missing one. The
// endpoint is internal and undocumented, so the response envelope is checked
// and a change fails loudly instead of reading as an empty board.
//
// Live behaviour this provider is built around (2026-11-09):
//   - `limit` is validated up to 100, but any value above 50 returns a
//     well-formed response with zero jobs. The page size is therefore 50.
//   - `sort: "date"` gives a stable order to walk: 5,682 postings came back as
//     114 pages of 50, the last one short, and page 115 empty. A posting added
//     mid-walk can only push rows down a page, and the id dedup absorbs that.
//   - `keywords` narrows the board server-side ("maths": 601 of 5,682).
//     `locations` is ignored by the endpoint (the page's own location search
//     sends it and still gets the whole board), so location is left to the
//     scan's location_filter.
//   - `siteCountry: "us"` returns nothing; "gb" is the board.
//
// Source Indexing Policy: every posting is an identifiable school or employer
// and free to read and apply to. The walk covers the full inventory in date
// order (rule 3): promoted postings carry `promoted: true` and are kept where
// the date order puts them, never moved or filtered. Rows carry no external
// application URL, so the Tes vacancy page is the posting URL (rule 2).
// robots.txt disallows only /auth, /registration, attachments and three
// /api/* paths outside /jobs/ (rule 6).
//
// Optional entry keys:
//   keywords: maths   # Tes's own keyword search, applied server-side
//   max_pages: 40     # pages of 50 per scan (default 150, capped at 400)

const ORIGIN = 'https://www.tes.com';
const SEARCH_URL = `${ORIGIN}/jobs/api/trpc/jobs.search`;
const BOARD_URL = `${ORIGIN}/jobs/`;
const PAGE_SIZE = 50; // the largest limit that returns rows (see above)
const DEFAULT_MAX_PAGES = 150; // 7,500 postings; the whole board was 114 pages on 2026-11-09
const MAX_PAGES_CAP = 400;
const PAGE_DELAY_MS = 250;
const MAX_KEYWORDS_LENGTH = 100;
const VACANCY_PATH_RE = /^\/jobs\/vacancy\/[a-z0-9][a-z0-9-]*-\d+$/;

/** @param {string} text */
const hasControlChar = (text) => [...text].some((c) => c < ' ' || c === '\u007f');

/**
 * The entry's optional `keywords`, validated. Exported for unit tests.
 * Throws on a malformed value: a config error, raised before any request.
 *
 * @param {any} entry - The job_boards entry.
 * @returns {string} The keywords, or '' for the whole board.
 */
export function tesKeywords(entry) {
  const raw = entry?.keywords;
  if (raw === undefined || raw === null || raw === '') return '';
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text || text.length > MAX_KEYWORDS_LENGTH || hasControlChar(text)) {
    throw new Error(`tes: keywords in entry "${entry?.name ?? '?'}" must be one line of 1-${MAX_KEYWORDS_LENGTH} characters`);
  }
  return text;
}

/**
 * One page's request URL. Exported for unit tests.
 *
 * @param {string} keywords - From tesKeywords().
 * @param {number} page - 1-based.
 * @returns {string}
 */
export function buildTesSearchUrl(keywords, page) {
  const input = {
    0: {
      json: {
        limit: PAGE_SIZE,
        filters: {
          keywords,
          locations: [],
          excludedLocations: [],
          filters: {
            contractTerms: [],
            contractTypes: [],
            subjects: [],
            workplaces: [],
            positions: [],
            location: { distance: 30, distanceUnit: 'mi' },
          },
          sort: 'date',
          page,
        },
        siteCountry: 'gb',
      },
    },
  };
  return `${SEARCH_URL}?${new URLSearchParams({ batch: '1', input: JSON.stringify(input) })}`;
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
 * The page payload out of a tRPC batch response: `[{ result: { data: { json } } }]`.
 * Throws a descriptive error when the envelope is not that shape, or when the
 * payload carries no `jobs` array. Exported for unit tests.
 *
 * @param {unknown} body
 * @returns {{ jobs: any[], totalPages?: number }}
 */
export function tesPayload(body) {
  const first = Array.isArray(body) ? body[0] : null;
  const error = first && typeof first === 'object' ? /** @type {any} */ (first).error : null;
  if (error) {
    throw new Error(`tes: the search endpoint returned an error: ${clean(error?.json?.message) || 'no message'}`);
  }
  const json = /** @type {any} */ (first)?.result?.data?.json;
  if (!json || typeof json !== 'object' || !Array.isArray(json.jobs)) {
    const got = json && typeof json === 'object'
      ? `keys [${Object.keys(json).join(', ')}]`
      : Array.isArray(body) ? `a batch of ${body.length}` : typeof body;
    throw new Error(`tes: unexpected search response — expected [{ result: { data: { json: { jobs: [...] } } } }], got ${got}`);
  }
  return json;
}

/**
 * Tes answers a bad input with HTTP 400 and a zod error in the same tRPC
 * envelope. Name it, so a changed schema reads as one rather than "HTTP 400".
 *
 * @param {any} err
 * @returns {string|null}
 */
function tesRejection(err) {
  if (err?.status !== 400 || typeof err.body !== 'string') return null;
  try {
    tesPayload(JSON.parse(err.body));
  } catch (parseErr) {
    const message = /** @type {Error} */ (parseErr).message;
    return message.startsWith('tes: the search endpoint returned an error') ? message : null;
  }
  return null;
}

/** @param {unknown} value */
function clean(value) {
  if (typeof value !== 'string') return '';
  return [...value].filter((c) => c >= ' ' && c !== '\u007f').join('').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' ? decodeEntities(value).replace(/\s+/g, ' ').trim() : '';
}

// One amount: a currency sign or ISO code, then a figure. A bare "$" is not
// read: on Tes it is USD, AUD, SGD and more, and the row does not say which.
const AMOUNT = String.raw`(£|€|HK\$|[A-Z]{3}\s*)([\d,]+(?:\.\d+)?)`;
const SALARY_RE = new RegExp(String.raw`^${AMOUNT}(?:\s*-\s*${AMOUNT})?\s+per\s+(?:year|annum)$`, 'i');
const CURRENCY_SIGNS = { '£': 'GBP', '€': 'EUR', 'HK$': 'HKD' };

/** @param {string} sign */
function currencyOf(sign) {
  const s = sign.trim();
  return CURRENCY_SIGNS[/** @type {keyof typeof CURRENCY_SIGNS} */ (s.toUpperCase() === 'HK$' ? 'HK$' : s)] || s.toUpperCase();
}

/**
 * An annual salary as Tes writes it: "£31,650 - £49,084 per year",
 * "£42,000 per year", "AED 9,000 - AED 12,000 per year". One currency, a sign
 * or ISO code. Anything else (per month, per hour, pro rata, a bare "$",
 * "Competitive", two currencies) is left off, never inferred. A single figure
 * is both bounds. Exported for unit tests.
 *
 * @param {unknown} range
 * @returns {{min: number, max: number, currency: string}|undefined}
 */
export function tesSalary(range) {
  const m = SALARY_RE.exec(text(range));
  if (!m) return undefined;
  const currency = currencyOf(m[1]);
  if (m[3] !== undefined && currencyOf(m[3]) !== currency) return undefined;
  const min = Number(m[2].replace(/,/g, ''));
  const max = m[4] === undefined ? min : Number(m[4].replace(/,/g, ''));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return undefined;
  return { min, max, currency };
}

/**
 * The posting URL from a row's site-relative `canonicalUrl`, or null when it is
 * not a Tes vacancy path. Exported for unit tests.
 *
 * @param {unknown} canonicalUrl
 * @returns {string|null}
 */
export function tesVacancyUrl(canonicalUrl) {
  if (typeof canonicalUrl !== 'string' || !VACANCY_PATH_RE.test(canonicalUrl)) return null;
  const url = new URL(canonicalUrl, ORIGIN);
  return url.origin === ORIGIN ? url.href : null;
}

/**
 * Normalize one page's rows. Rows without a title or a vacancy URL are
 * dropped. Exported for unit tests.
 *
 * @param {any[]} rows
 * @param {string} fallbackCompany
 * @returns {Array<Record<string, any>>}
 */
export function parseTesJobs(rows, fallbackCompany = 'Tes') {
  /** @type {Array<Record<string, any>>} */
  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const title = text(row.title);
    const url = tesVacancyUrl(row.canonicalUrl);
    if (!title || !url) continue;
    /** @type {Record<string, any>} */
    const job = {
      title,
      url,
      company: text(row.employer?.name) || fallbackCompany,
      location: text(row.displayLocation),
    };
    const postedAt = toEpochMs(row.advert?.startDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    const closesAt = closesAtIso(row.application?.closeDate);
    if (closesAt) job.closesAt = closesAt;
    const description = text(row.shortDescription);
    if (description) job.description = description;
    const salary = tesSalary(row.salary?.range);
    if (salary) job.salary = salary;
    if (Number.isSafeInteger(row.id) && row.id > 0) job.externalId = String(row.id);
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'tes',

  detect(entry) {
    return entry?.provider === 'tes' ? { url: BOARD_URL } : null;
  },

  /**
   * Walks the board in date order, PAGE_SIZE rows a page, to its natural end.
   * @param {any} entry - The job_boards entry being processed.
   * @param {any} ctx - HTTP context.
   * @returns {Promise<Array<Record<string, any>>>}
   */
  async fetch(entry, ctx) {
    const name = entry?.name || 'Tes';
    const keywords = tesKeywords(entry);
    const maxPages = resolveMaxPages(entry);
    // verify-portals' liveness probe sets ctx.maxPages: 1. It needs to know the
    // board answers, not how big it is, and the cap warning must not fire for it.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pagesToFetch = probing ? Math.min(maxPages, ctx.maxPages) : maxPages;

    /** @type {Array<Record<string, any>>} */
    const jobs = [];
    const seen = new Set();
    // Why the walk stopped: 'complete' (a short or empty page, or the last
    // page the board reports), 'cap' (max_pages ran out on a full page),
    // 'fetch-error' or 'unrecognised-page'.
    let stopReason = 'complete';
    let lastPageFull = false;
    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(PAGE_DELAY_MS, ctx);
      let body;
      try {
        // redirect:'error' prevents SSRF via server-side redirects; retries
        // 429 / 5xx / timeouts, never a 400.
        body = await fetchJsonWithRetry(ctx, buildTesSearchUrl(keywords, page), { redirect: 'error' });
      } catch (err) {
        // A probe tells ProbePageBudgetReached apart by identity: never wrap it.
        if (probing) throw err;
        const rejection = tesRejection(err);
        // Nothing read yet: the endpoint, or its schema, changed. An empty
        // result would read as "no postings", so fail loud.
        if (page === 1) throw rejection ? new Error(`${rejection} (${name})`, { cause: err }) : err;
        console.error(`⚠️  tes: ${name} truncated at page ${page} (${jobs.length} jobs kept): ${rejection || /** @type {any} */ (err)?.message}`);
        stopReason = 'fetch-error';
        break;
      }

      let payload;
      try {
        payload = tesPayload(body);
      } catch (err) {
        if (page === 1) throw err;
        console.error(`⚠️  tes: ${name} truncated at page ${page} (${jobs.length} jobs kept): ${/** @type {Error} */ (err).message}`);
        stopReason = 'unrecognised-page';
        break;
      }

      for (const job of parseTesJobs(payload.jobs, name)) {
        const key = job.externalId || job.url;
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(job);
      }

      // The walk's own end, judged on the rows the source returned for this
      // page, not on how many survived parsing or dedup.
      lastPageFull = payload.jobs.length >= PAGE_SIZE;
      const reported = Number(payload.totalPages);
      if (!lastPageFull || (Number.isInteger(reported) && reported > 0 && page >= reported)) {
        lastPageFull = false;
        break;
      }
    }

    // Out of pages on a full page: our own cap truncated the board.
    if (stopReason === 'complete' && lastPageFull && !probing) {
      stopReason = 'cap';
      console.error(`⚠️  tes: ${name} truncated at max_pages=${maxPages} (${jobs.length} jobs) — raise max_pages on this entry, or narrow it with keywords`);
    }
    // A cap or a broken page leaves the board partial; tag it (the
    // workdayTruncated convention) so a caller can tell without reading stderr.
    if (stopReason !== 'complete') /** @type {any} */ (jobs).tesTruncated = true;
    return jobs;
  },
};
