// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Alignerr provider — the public AI-training / AI-evaluation contract roles
// Alignerr (Labelbox's expert network) lists at https://www.alignerr.com/jobs.
// That page is a Next.js shell whose "load more" calls the same-origin JSON
// endpoint GET /api/jobs?limit=&offset= (no auth, no cookie). robots.txt
// (checked 2026-10-28) disallows only /cgi-bin/ and *.pdf under
// `User-agent: *`, so neither the listing page nor /api/jobs is excluded.
//
// Every row is Alignerr's own posting, so company is "Alignerr". Location is
// copied as the source states it ("Remote" today) — a remote label here does
// not establish worldwide eligibility, and nothing is inferred beyond it.
// Pay is hourly ("$45-90/hr"), so it goes into description, never `salary`
// (the scanner's salary filter is annual).
//
// The server clamps `limit` to 120 (observed: limit=500 → 120 rows,
// response `limit: 120`) and reported total≈5,640 rows, i.e. ~47 pages.
//
// Wire in via a `job_boards:` entry with `provider: alignerr`.

const ORIGIN = 'https://www.alignerr.com';
const LANDING_URL = `${ORIGIN}/jobs`;
const API_URL = `${ORIGIN}/api/jobs`;
const PAGE_SIZE = 120;
const DEFAULT_MAX_PAGES = 60;
const MAX_PAGES_CAP = 200;
const INTER_PAGE_DELAY_MS = 250;

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Normalize one /api/jobs row. Returns null for a row missing an id or title.
 * Exported for unit tests.
 *
 * @param {any} row
 */
export function normalizeAlignerrJob(row) {
  if (!row || typeof row !== 'object') return null;
  const id = str(row.id);
  const title = str(row.title);
  if (!id || !title) return null;
  const seg = safeEncodeURIComponent(id);
  if (seg === null) return null;
  const description = [
    str(row.description),
    str(row.pay) && `Pay: ${str(row.pay)}`,
    str(row.category) && `Category: ${str(row.category)}`,
  ].filter(Boolean).join('\n');
  /** @type {import('./_types.js').Job} */
  const job = {
    title,
    url: `${ORIGIN}/jobs/${seg}`,
    company: 'Alignerr',
    location: str(row.location),
    externalId: id,
  };
  if (description) job.description = description;
  return job;
}

/**
 * Parse one /api/jobs page. Throws when the `jobs[]` envelope is missing or
 * mistyped; a present-and-empty `jobs` array is an empty page.
 * Exported for unit tests.
 *
 * @param {unknown} json
 * @returns {{ jobs: import('./_types.js').Job[], rawCount: number, total: number | undefined, limit: number | undefined }}
 */
export function parseAlignerrPage(json) {
  const body = /** @type {any} */ (json);
  const rows = body && typeof body === 'object' && Array.isArray(body.jobs) ? body.jobs : null;
  if (!rows) {
    const got = body && typeof body === 'object' ? Object.keys(body).join(', ') : typeof body;
    throw new Error(`alignerr: unexpected response — expected jobs[], got: [${got}]`);
  }
  const jobs = [];
  for (const row of rows) {
    const job = normalizeAlignerrJob(row);
    if (job) jobs.push(job);
  }
  const total = Number.isInteger(body.total) && body.total >= 0 ? body.total : undefined;
  const limit = Number.isInteger(body.limit) && body.limit > 0 ? body.limit : undefined;
  return { jobs, rawCount: rows.length, total, limit };
}

/** @type {Provider} */
export default {
  id: 'alignerr',

  detect(entry) {
    return entry?.provider === 'alignerr' ? { url: LANDING_URL } : null;
  },

  async fetch(entry, ctx) {
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const pagesToFetch = Math.min(resolveMaxPages(entry), probing ? ctxMaxPages : Infinity);

    /** @type {Map<string, import('./_types.js').Job>} */
    const jobs = new Map();
    /** @type {'complete' | 'cap' | 'fetch-error'} */
    let stopReason = 'complete';
    let offset = 0;

    for (let page = 0; page < pagesToFetch; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = `${API_URL}?limit=${PAGE_SIZE}&offset=${offset}`;
      let json;
      try {
        json = await fetchJsonWithRetry(ctx, url, { redirect: 'error', timeoutMs: 20_000 });
      } catch (err) {
        // A probe must see the budget error unwrapped; page 1 failing means
        // there is nothing to keep, so fail loud there too.
        if (probing || page === 0) throw err;
        console.warn(`alignerr: page ${page + 1} failed (${/** @type {Error} */ (err).message}); keeping ${jobs.size} jobs from earlier pages`);
        stopReason = 'fetch-error';
        break;
      }
      const parsed = parseAlignerrPage(json);
      for (const job of parsed.jobs) jobs.set(job.url, job);

      // Short-page stop on the source's own row count, against the page size
      // the server says it applied (it clamps `limit`).
      const effectiveSize = Math.min(PAGE_SIZE, parsed.limit ?? PAGE_SIZE);
      offset += parsed.rawCount;
      if (parsed.rawCount === 0 || parsed.rawCount < effectiveSize) break;
      if (parsed.total !== undefined && offset >= parsed.total) break;
      if (page === pagesToFetch - 1) stopReason = 'cap';
    }

    if (stopReason === 'cap' && !probing) {
      console.warn(`alignerr: stopped at ${pagesToFetch} pages with more rows available; raise max_pages on this entry`);
    }
    return [...jobs.values()];
  },
};
