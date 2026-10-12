// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// staff.am provider — Armenia's dominant job board (https://staff.am), the
// project's first Armenian source. Board-wide aggregator, so it targets the
// `job_boards:` list and is reached only by an explicit `provider: staffam`
// (no URL-pattern detect(): a staff.am URL in a `tracked_companies:` entry is
// usually a single company's profile page, and claiming it would hand that
// entry the whole board).
//
// Optional per-entry tuning:
//   categories: [software-development, ...]  — the board's own category path
//       segments (the `{category}` in https://staff.am/en/jobs/{category}).
//       Each is walked separately and results are de-duped by posting id.
//       Omit to walk the whole board.
//   max_pages: N  — per category (or for the whole board); see below.
//
// HOW IT READS THE BOARD. Measured on 2026-10-02: the listing is a Next.js
// app whose pages are server-rendered with the full page of postings in the
// `__NEXT_DATA__` script (`props.pageProps.jobs`, 50 postings per page plus
// one interleaved banner row, `totalCount` alongside). No auth, no JS, and the
// default scanner User-Agent is served. The whole board was ~1,200 postings
// over 24 pages; a page past the end answers 200 with `jobs: []`.
//
// robots.txt (fetched 2026-10-02) is `Allow: /`, `Disallow: /*?`,
// `Allow: /*?page=` for `User-agent: *` — query-string filters are off-limits
// but `?page=N` is explicitly allowed. This provider issues exactly two URL
// shapes, `/en/jobs[/{category}]` and the same with `?page=N`, both allowed.
// Category scoping is a PATH segment, not a query parameter, for that reason.
//
// The list payload carries no upstream employer/ATS link, so `job.url` is the
// board's own posting page (Source Indexing Policy rule 2 fallback).

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

const ORIGIN = 'https://staff.am';
const LANG = 'en';

/** Postings per listing page, as served (excluding the banner row). */
const PAGE_SIZE = 50;

/** 24 pages covered the whole board on 2026-10-02; 40 leaves headroom so a
 *  default scan still reads the complete inventory as it grows. */
const DEFAULT_MAX_PAGES = 40;

/** Hard ceiling even for an explicit `max_pages` override. */
const MAX_PAGES_CAP = 100;

/** Pacing between pages. No throttling was observed; this is the norm. */
const INTER_PAGE_DELAY_MS = 250;

/** A category segment as the board spells them: lowercase words joined by hyphens. */
const CATEGORY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** staff.am timestamps are wall-clock Yerevan time (UTC+4, no DST). */
const YEREVAN_OFFSET = '+04:00';

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Normalize the entry's `categories:` into validated path segments. An invalid
 * value is a config error and throws — silently dropping it would quietly
 * widen or empty the scan. `null` means "the whole board".
 * @param {any} entry
 * @returns {string[] | null}
 */
export function resolveCategories(entry) {
  const raw = entry?.categories;
  if (raw == null) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const c of list) {
    const code = String(c ?? '').trim().toLowerCase();
    if (!CATEGORY_RE.test(code)) {
      throw new Error(`staffam: invalid category ${JSON.stringify(c)} — use the path segment from https://staff.am/en/jobs/{category}`);
    }
    if (!out.includes(code)) out.push(code);
  }
  return out.length ? out : null;
}

/**
 * Build a listing URL. Only the two shapes robots.txt allows: a path, and the
 * same path with `?page=N`.
 * @param {string | null} category - Pre-validated category segment, or null.
 * @param {number} page - 1-based.
 */
export function buildListUrl(category, page) {
  const path = `${ORIGIN}/${LANG}/jobs${category ? `/${category}` : ''}`;
  return page <= 1 ? path : `${path}?page=${page}`;
}

/** @param {unknown} html */
export function extractNextData(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

/**
 * "2026-10-02 07:00:32" (Yerevan wall clock) → epoch ms; undefined if absent
 * or unparseable.
 * @param {unknown} value
 */
export function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(value.trim());
  const parsed = m ? Date.parse(`${m[1]}T${m[2]}${YEREVAN_OFFSET}`) : Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Text fields arrive HTML-escaped inside the JSON, sometimes twice
 * ("Google Cloud &amp;amp; AI Platform Engineer", observed 2026-10-02), so
 * decode two levels — same idiom as cryptocurrencyjobs.mjs.
 * @param {string} s
 */
const decodeText = (s) => decodeEntities(decodeEntities(s)).replace(/\s+/g, ' ').trim();

/**
 * Pick a display string from staff.am's per-language object
 * (`{ en, am, ru, am_en }`), preferring English.
 * @param {any} obj
 */
function pickText(obj) {
  if (typeof obj === 'string') return decodeText(obj);
  if (!obj || typeof obj !== 'object') return '';
  for (const k of ['en', 'am_en', 'am', 'ru']) {
    if (typeof obj[k] === 'string') {
      const text = decodeText(obj[k]);
      if (text) return text;
    }
  }
  return '';
}

/**
 * Map one row of `pageProps.jobs` to a Job, or null for a banner / malformed row.
 * @param {any} row
 */
export function normalizeRow(row) {
  if (!row || typeof row !== 'object' || row.itemType === 0) return null;
  const title = pickText(row.title);
  const slug = typeof row.slug?.[LANG] === 'string' ? row.slug[LANG] : null;
  const categoryCode = typeof row.category?.code === 'string' ? row.category.code : null;
  if (!title || !slug || !categoryCode || row.id == null) return null;
  const catSeg = safeEncodeURIComponent(categoryCode);
  const slugSeg = safeEncodeURIComponent(slug);
  if (catSeg === null || slugSeg === null) return null;

  const city = pickText(row.job_city?.title);
  const location = row.is_remote ? (city ? `${city} (Remote)` : 'Remote') : city;

  /** @type {{title: string, url: string, company: string, location: string, postedAt?: number, id: string}} */
  const job = {
    id: String(row.id),
    title,
    url: `${ORIGIN}/${LANG}/jobs/${catSeg}/${slugSeg}`,
    company: pickText(row.companiesStruct?.title),
    location,
  };
  const postedAt = toEpochMs(row.activated_at?.staffam);
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/**
 * Parse one listing page. Throws when the page is not the documented shape
 * (no `__NEXT_DATA__`, or `pageProps.jobs` missing / not an array) — a markup
 * change must look like a broken board, not an empty one. A present-and-empty
 * `jobs: []` is the past-the-end / empty-category case.
 * @param {string} html
 * @param {string} url
 * @returns {{ jobs: ReturnType<typeof normalizeRow>[], rawCount: number, totalCount: number | null }}
 */
export function parseListingPage(html, url) {
  const data = extractNextData(html);
  if (!data) throw new Error(`staffam: ${url} has no parseable __NEXT_DATA__ — the page markup changed`);
  const pp = data?.props?.pageProps;
  const rows = pp && Array.isArray(pp.jobs) ? pp.jobs : null;
  if (!rows) {
    const got = pp && typeof pp === 'object' ? Object.keys(pp).join(', ') : typeof pp;
    throw new Error(`staffam: unexpected __NEXT_DATA__ at ${url} — expected pageProps.jobs[], got: [${got}]`);
  }
  // rawCount is what the SOURCE served (banners excluded, malformed rows kept)
  // so the short-page stop isn't fooled by rows this parser drops.
  const rawCount = rows.filter((r) => !(r && typeof r === 'object' && r.itemType === 0)).length;
  const totalCount = Number.isInteger(pp.totalCount) ? pp.totalCount : null;
  return { jobs: rows.map(normalizeRow).filter(Boolean), rawCount, totalCount };
}

/** @type {Provider} */
export default {
  id: 'staffam',

  detect(entry) {
    return entry?.provider === 'staffam' ? { url: buildListUrl(null, 1) } : null;
  },

  async fetch(entry, ctx) {
    const maxPages = resolveMaxPages(entry);
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const probing = ctxCap !== Infinity;
    // A health probe only needs to know the board answers: one category's
    // first page(s), not one request per configured category.
    const allCategories = resolveCategories(entry) ?? [null];
    const categories = probing ? allCategories.slice(0, 1) : allCategories;
    const pagesToFetch = Math.min(maxPages, ctxCap);

    /** @type {any[]} */
    const jobs = [];
    const seen = new Set();
    let requests = 0;
    let unknownCategories = 0;

    for (const category of categories) {
      const label = category ?? 'all categories';
      /** @type {'complete' | 'cap' | 'fetch-error'} */
      let stopReason = 'complete';
      let lastRawCount = 0;
      let totalCount = null;
      let page = 1;
      for (; page <= pagesToFetch; page++) {
        if (requests > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
        const url = buildListUrl(category, page);
        let html;
        try {
          requests++;
          html = await fetchTextWithRetry(ctx, url, { redirect: 'error' });
        } catch (err) {
          // Any probe failure surfaces unwrapped (keeps ProbePageBudgetReached
          // identity for verify-portals). An unknown category 404s — that is a
          // typo in one config value, so it is skipped loudly and the other
          // categories still scan. Any other first-page failure is the board
          // itself failing. A later page failing keeps what was read and warns.
          if (probing) throw err;
          if (page === 1 && category && /** @type {any} */ (err)?.status === 404) {
            console.error(`⚠️  staffam: ${entry.name} — category "${category}" does not exist on staff.am (404), skipped; check the path segment in https://staff.am/en/jobs/{category}`);
            unknownCategories++;
            break;
          }
          if (page === 1) throw err;
          console.error(`⚠️  staffam: ${entry.name} (${label}) stopped at page ${page}: ${/** @type {Error} */ (err).message} — keeping ${jobs.length} postings read so far`);
          stopReason = 'fetch-error';
          break;
        }
        const parsed = parseListingPage(html, url);
        if (totalCount === null) totalCount = parsed.totalCount;
        lastRawCount = parsed.rawCount;
        for (const job of parsed.jobs) {
          if (!job || seen.has(job.id)) continue;
          seen.add(job.id);
          const { id: _id, ...rest } = job;
          jobs.push(rest);
        }
        // Natural end: an empty or short page, or the source-reported total
        // reached. Keyed off the source's own page shape, not the de-duped count.
        if (parsed.rawCount < PAGE_SIZE) break;
        if (totalCount !== null && page * PAGE_SIZE >= totalCount) break;
      }
      if (stopReason === 'complete' && page > pagesToFetch && lastRawCount >= PAGE_SIZE
          && !(totalCount !== null && pagesToFetch * PAGE_SIZE >= totalCount)) {
        stopReason = 'cap';
      }
      if (stopReason === 'cap' && !probing) {
        const of = totalCount !== null ? ` of ${totalCount}` : '';
        console.error(`⚠️  staffam: ${entry.name} (${label}) truncated at max_pages=${maxPages} (${pagesToFetch * PAGE_SIZE}${of} postings) — raise max_pages on this entry for more`);
      }
    }

    // Every configured category 404'd: nothing was scanned, and [] would read
    // as "no openings" rather than "this entry is misconfigured".
    if (unknownCategories > 0 && unknownCategories === categories.length) {
      throw new Error(`staffam: none of the configured categories exist on staff.am (${categories.join(', ')})`);
    }

    return jobs;
  },
};
