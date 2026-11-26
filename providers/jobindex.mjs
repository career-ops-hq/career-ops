// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jobindex (Denmark) provider: jobindex.dk, a Danish job board.
// A `job_boards:` feed. Wire it in with a Jobindex search URL, copied from the
// browser after setting the search on the site:
//
//   - name: Jobindex — Python
//     careers_url: https://www.jobindex.dk/jobsoegning?q=python
//     enabled: true
//
// PUBLIC FEED, NO AUTH. Every search page has an RSS twin at
// `/jobsoegning.rss` that takes the same query parameters (`q`, `subid`,
// `geoareaid`, `jobage`, `lang`, ...). This provider keeps the search URL's
// query, drops any `page`, and reads the RSS twin. Search URLs that put
// filters in the path (`/jobsoegning/it/storkoebenhavn`) have no RSS twin
// (measured: 404), so the provider refuses them with a message saying so.
//
// FEED SHAPE (measured 2026-11-23). 20 items per page, `page=N` walks the
// results; a short page ends them. For `q=python` the walk returned 205
// distinct items in 11 pages, the same as the `hitcount` the search page
// shows, so the walk reads the whole result set. The feed lists ads placed
// on Jobindex first (card class `PaidJob`: 88 of those 205), then postings
// Jobindex collects from employers' career sites and from other job boards
// (card class `jix_robotjob`: 117). Only the ads placed on Jobindex are this
// source's own listings; the collected ones are cross-source aggregation,
// which Source Indexing Policy rule 5 keeps in core (#6471). So the provider
// keeps `PaidJob` cards only, counts the rest in `providerStats` under
// `collected`, and keeps no order of its own.
// `<title>` is "<job title>, <employer>"; the employer is left out when
// Jobindex does not know it. `<description>` holds an HTML card: the job
// title in `<h4>`, the area in `.jix_robotjob--area`, the employer's logo
// with the employer name as ALT, and a short teaser. The teaser is not the
// job description, so it is not returned as `description`. The card's job
// link is the Jobindex posting page; the feed carries no employer link.
// The area is free text ("København og mulighed for hjemmearbejde": a place
// plus a work model), so it becomes `location` as given and is not split into
// `locations`.
// Every non-ASCII character in the feed is an entity, and the card HTML is
// entity-escaped once more inside the XML.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

const ORIGIN = 'https://www.jobindex.dk';
const FEED_PATH = '/jobsoegning.rss';
const ALLOWED_HOSTS = new Set(['www.jobindex.dk', 'jobindex.dk']);
// The bare host ('/') reads the whole board, like an empty search; max_pages
// caps it, with the usual warning.
const SEARCH_PATHS = new Set(['/', '/jobsoegning', '/jobsoegning/', '/jobsoegning.rss']);

/** Measured page size; a shorter page is the last one. */
const PAGE_SIZE = 20;

/** 500 postings by default; a search wider than that is cut with a warning. */
const DEFAULT_MAX_PAGES = 25;

/** Hard ceiling on a configured `max_pages`. */
const MAX_PAGES_CAP = 250;

/** No Crawl-delay is stated; the usual spacing between pages. */
const INTER_PAGE_DELAY_MS = 250;

const ITEM_RE = /<item\b[^>]*>[\s\S]*?<\/item>/gi;

// Same-length filler over CDATA and comments, so text inside them is never
// read as an <item> tag and positions stay aligned with the real feed (as in
// germantechjobs.mjs).
function maskCdataAndComments(str) {
  return str.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, (m) => '#'.repeat(m.length));
}

/**
 * Parse a careers_url into a Jobindex search URL. Throws on anything else.
 * @param {unknown} raw
 * @returns {URL}
 */
function parseSearchUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('jobindex: careers_url is required (a Jobindex search URL)');
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`jobindex: invalid URL: ${raw}`);
  }
  if (url.protocol !== 'https:') throw new Error(`jobindex: URL must use HTTPS: ${raw}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`jobindex: untrusted hostname "${url.hostname}" — must be www.jobindex.dk`);
  }
  return url;
}

/**
 * Build the RSS URL for one page from the configured search URL.
 * @param {unknown} careersUrl
 * @param {number} page 1-based
 * @returns {string}
 */
export function buildFeedUrl(careersUrl, page) {
  const search = parseSearchUrl(careersUrl);
  if (!SEARCH_PATHS.has(search.pathname)) {
    throw new Error(
      `jobindex: "${search.pathname}" has no RSS feed. Use a search URL with its filters as query `
      + 'parameters, e.g. https://www.jobindex.dk/jobsoegning?q=python&geoareaid=15182',
    );
  }
  const params = new URLSearchParams(search.search);
  params.delete('page');
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `${ORIGIN}${FEED_PATH}${query ? `?${query}` : ''}`;
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

// Strip tags to a fixed point, then drop any stray bracket (see jobbankca.mjs).
function stripTags(s) {
  let prev;
  let out = s;
  do {
    prev = out;
    out = out.replace(/<([^>]*)(>?)/g, (tag, body, close) => (close && body ? '' : tag));
  } while (out !== prev);
  return out.replace(/[<>]/g, '');
}

/** Decode, drop zero-width spaces, collapse whitespace. */
function clean(s) {
  return decodeEntities(String(s)).replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
}

function cleanUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) ? url.href : '';
  } catch {
    return '';
  }
}

function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse one page of the Jobindex RSS feed. Exported for unit tests.
 * Keeps ads placed on Jobindex (`PaidJob` cards); counts collected postings in
 * `collected`, placed ads that name no employer in `noEmployer`, and items it
 * cannot read (another card kind, or a placed ad with no Jobindex link or
 * title) in `unrecognised`.
 * Throws when the body is not a complete RSS channel, when its <item> tags do
 * not pair up (a page cut short), or when it has items and none is recognised
 * (neither a placed ad nor a collected posting).
 * @param {string} xml
 * @returns {{ jobs: {title: string, url: string, company: string, location: string, postedAt?: number}[], rawCount: number, collected: number, noEmployer: number, unrecognised: number }}
 */
export function parseJobindexFeed(xml) {
  const body = String(xml ?? '');
  const masked = maskCdataAndComments(body);
  if (!/<rss\b[\s\S]*<channel\b[\s\S]*<\/channel>/i.test(masked)) {
    throw new Error(`jobindex: unexpected response — expected an RSS <channel>, got: ${JSON.stringify(body.slice(0, 80))}`);
  }
  const items = [...masked.matchAll(ITEM_RE)].map((m) => body.slice(m.index, m.index + m[0].length));
  const opened = (masked.match(/<item\b/gi) || []).length;
  if (opened !== items.length) {
    throw new Error(`jobindex: ${opened} <item> tag(s) but ${items.length} complete item(s) — the feed page is malformed or cut short`);
  }
  const jobs = [];
  let collected = 0;
  let noEmployer = 0;
  let unrecognised = 0;
  for (const item of items) {
    // The card HTML is escaped once inside the XML: decode it once to get HTML,
    // then decode each text node again.
    const card = decodeEntities(tagText(item, 'description'));
    if (/class="jix_robotjob"/i.test(card)) {
      collected++;
      continue;
    }
    if (!/class="PaidJob"/i.test(card)) {
      unrecognised++;
      continue;
    }
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) {
      unrecognised++;
      continue;
    }
    const feedTitle = clean(tagText(item, 'title'));
    const h4 = card.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i);
    const cardTitle = h4 ? clean(stripTags(h4[1])) : '';
    const title = cardTitle || feedTitle;
    if (!title) {
      unrecognised++;
      continue;
    }
    let company = '';
    if (cardTitle && feedTitle.startsWith(`${cardTitle}, `)) company = feedTitle.slice(cardTitle.length + 2).trim();
    if (!company) {
      const alt = card.match(/<img\b[^>]*\balt\s*=\s*"([^"]*)"/i);
      if (alt) company = clean(alt[1]);
    }
    // Rule 1: a listing must name its employer. None was missing on the live
    // feed (2026-11-24), so one without is counted rather than kept. It is
    // still a recognised card, so it does not count as a format change.
    if (!company) {
      noEmployer++;
      continue;
    }
    const area = card.match(/class="jix_robotjob--area"[^>]*>([\s\S]*?)<\/span>/i);
    const location = area ? clean(stripTags(area[1])) : '';
    const postedAt = toEpochMs(clean(tagText(item, 'pubDate')));
    jobs.push({ title, url, company, location, ...(postedAt !== undefined ? { postedAt } : {}) });
  }
  if (items.length && !jobs.length && !collected && !noEmployer) {
    throw new Error(`jobindex: ${items.length} feed item(s) but none recognised — the feed format may have changed`);
  }
  return { jobs, rawCount: items.length, collected, noEmployer, unrecognised };
}

/** @param {{ max_pages?: unknown }} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && /** @type {number} */ (v) > 0) return Math.min(/** @type {number} */ (v), MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'jobindex',

  detect(entry) {
    try {
      const url = parseSearchUrl(entry?.careers_url);
      return { url: url.href };
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMax = resolveMaxPages(entry);
    const maxPages = Math.min(entryMax, probing ? ctx.maxPages : Infinity);
    buildFeedUrl(entry?.careers_url, 1); // config errors throw before any request

    /** @type {Map<string, any>} */
    const byUrl = new Map();
    const stats = { dropped: {} };
    let stop = 'cap';
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let parsed;
      try {
        parsed = parseJobindexFeed(await fetchTextWithRetry(ctx, buildFeedUrl(entry?.careers_url, page), { redirect: 'error' }));
      } catch (err) {
        if (page === 1 || probing) throw err;
        stop = 'fetch-error'; // a failed or broken later page: keep the pages already read
        break;
      }
      const { jobs, rawCount, collected, noEmployer, unrecognised } = parsed;
      if (collected) stats.dropped.collected = (stats.dropped.collected || 0) + collected;
      if (noEmployer) stats.dropped.no_employer = (stats.dropped.no_employer || 0) + noEmployer;
      if (unrecognised) stats.dropped.unrecognised = (stats.dropped.unrecognised || 0) + unrecognised;
      for (const job of jobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
      if (rawCount < PAGE_SIZE) {
        stop = 'complete';
        break;
      }
    }

    const jobs = [...byUrl.values()];
    // Read by scan.mjs for the per-source summary; not part of the job list.
    Object.defineProperty(jobs, 'providerStats', { value: stats, enumerable: false });
    if (stop === 'fetch-error') {
      console.error(`⚠️  jobindex: ${entry?.name || 'entry'} stopped on a failed or broken page; kept ${jobs.length} posting(s) from the pages already read`);
      markTruncated(jobs, 'fetch-error', { fetched: jobs.length });
    } else if (stop === 'cap' && !probing) {
      console.error(`⚠️  jobindex: ${entry?.name || 'entry'} truncated at max_pages=${entryMax} (${jobs.length} postings) — raise max_pages on this entry or narrow the search`);
      markTruncated(jobs, 'page-cap', { fetched: jobs.length });
    }
    return jobs;
  },
};
