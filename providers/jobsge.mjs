// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// jobs.ge provider — Georgia's dominant job board (https://jobs.ge). Board-wide
// aggregator, so it targets the `job_boards:` list and is reached only by an
// explicit `provider: jobsge` (no URL-pattern detect(): a jobs.ge URL in a
// `tracked_companies:` entry is usually one employer's client page, and
// claiming it would hand that entry the whole board).
//
// Optional per-entry tuning (both are the board's own filter ids):
//   category: 6   — `cid`; 6 = IT/Programming (the default). Others seen on
//       2026-10-02: 1 Administration, 3 Finance, 4 PR/Marketing, 9 Other.
//   location: 17  — `lid`; 17 = Remote, 1 = Tbilisi, 14 = Adjara, 16 = Abroad.
//       Omit for every location.
//
// HOW IT READS THE BOARD. Measured on 2026-10-02: the listing
// `/en/?page=1&q=&cid={category}[&lid={location}]` is a server-rendered table
// (`#job_list_table`) holding the WHOLE filtered list in one response — IT was
// 142 rows and `page=2` returned the same 142 — so this is one request per
// entry, no pagination. Each row: title link `/en/?view=jobs&id=N`, the
// employer name in the 4th cell, published and deadline dates as "01 October"
// (no year).
//
// The default scanner User-Agent is answered with HTTP 410 by the site's
// nginx (robots.txt too), so this provider sends BROWSER_LIKE_USER_AGENT, per
// ADDING_A_PROVIDER.md → "Timeouts and User-Agent". robots.txt as served to a
// browser (2026-10-02): `Disallow: /data/clients/`, `Crawl-delay: 5` — the
// listing path is allowed, and one request per entry stays far inside the
// crawl delay.
//
// The list carries no upstream employer/ATS link, so `job.url` is the board's
// own posting page (Source Indexing Policy rule 2 fallback).

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const ORIGIN = 'https://jobs.ge';
const DEFAULT_CATEGORY = 6;

/** The board's location ids that this provider labels; any other id is labelled "Georgia". */
const LOCATION_LABELS = new Map([
  [17, 'Georgia (Remote)'],
  [1, 'Tbilisi, Georgia'],
  [14, 'Adjara, Georgia'],
  [16, 'Abroad'],
]);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/**
 * A filter id from the entry: a positive integer, or null when absent.
 * Anything else is a config error and throws — silently dropping it would
 * widen the scan to the whole board.
 * @param {unknown} v
 * @param {string} key
 */
function resolveId(v, key) {
  if (v == null) return null;
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  if (Number.isInteger(n) && /** @type {number} */ (n) > 0) return /** @type {number} */ (n);
  throw new Error(`jobsge: invalid ${key} ${JSON.stringify(v)} — use the board's numeric ${key === 'category' ? 'cid' : 'lid'}`);
}

/** @param {any} entry */
export function resolveFilters(entry) {
  return {
    category: resolveId(entry?.category, 'category') ?? DEFAULT_CATEGORY,
    location: resolveId(entry?.location, 'location'),
  };
}

/** @param {{ category: number, location: number | null }} f */
export function buildListUrl(f) {
  return `${ORIGIN}/en/?page=1&q=&cid=${f.category}${f.location ? `&lid=${f.location}` : ''}`;
}

/** @param {number | null} location */
export function locationLabel(location) {
  return (location && LOCATION_LABELS.get(location)) || 'Georgia';
}

/** @param {string} s */
const text = (s) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * "01 October" (no year) → epoch ms, Tbilisi midnight (UTC+4). The year is the
 * one that puts the date on or before `now`; a date more than a day ahead of
 * `now` belongs to last year (a December posting read in January).
 * @param {string} value
 * @param {number} now
 */
export function parsePublished(value, now) {
  const m = /^(\d{1,2})\s+([A-Za-z]+)$/.exec(String(value ?? '').trim());
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  const day = Number(m[1]);
  if (month < 0 || day < 1 || day > 31) return undefined;
  const year = new Date(now).getUTCFullYear();
  const at = (y) => Date.UTC(y, month, day) - 4 * 3600 * 1000;
  const thisYear = at(year);
  return thisYear > now + 24 * 3600 * 1000 ? at(year - 1) : thisYear;
}

/**
 * Parse the listing table. Throws when the page is not the documented shape —
 * a redesign must look like a broken board, not an empty one. A table with no
 * rows is a real empty result.
 * @param {string} html
 * @param {string} url
 * @param {{ location: number | null }} f
 * @param {number} [now]
 */
export function parseListingPage(html, url, f, now = Date.now()) {
  if (typeof html !== 'string' || !html.includes('id="job_list_table"')) {
    throw new Error(`jobsge: ${url} has no #job_list_table — the page markup changed`);
  }
  const location = locationLabel(f.location);
  const jobs = [];
  const seen = new Set();
  for (const m of html.matchAll(/<tr>\s*<td>\s*<img id="(\d+)"([\s\S]*?)<\/tr>/g)) {
    const id = m[1];
    if (seen.has(id)) continue;
    const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    const link = new RegExp(`href="/en/\\?view=jobs&(?:amp;)?id=${id}"[^>]*>([^<]+)</a>`).exec(m[2]);
    const title = link ? text(link[1]) : '';
    if (!title) continue;
    seen.add(id);
    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = {
      title,
      url: `${ORIGIN}/en/?view=jobs&id=${id}`,
      company: cells[2] !== undefined ? text(cells[2]) : '',
      location,
    };
    const postedAt = cells[3] !== undefined ? parsePublished(text(cells[3]), now) : undefined;
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'jobsge',

  detect(entry) {
    return entry?.provider === 'jobsge' ? { url: buildListUrl(resolveFilters(entry)) } : null;
  },

  async fetch(entry, ctx) {
    const f = resolveFilters(entry);
    const url = buildListUrl(f);
    const html = await fetchTextWithRetry(ctx, url, {
      redirect: 'error',
      headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT },
    });
    return parseListingPage(html, url, f);
  },
};
