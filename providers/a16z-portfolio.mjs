// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// a16z portfolio jobs provider — board-wide aggregator for `job_boards:`.
// https://jobs.a16z.com/jobs lists open roles across Andreessen Horowitz's
// portfolio companies (~18.4k postings as of 2026-10), each carrying the
// portfolio company's own ATS link (Ashby, Greenhouse, Lever, ...) as
// `apply_url`. That link is the Job.url (Source Indexing Policy rule 2), so
// these rows dedup against the ashby/greenhouse/lever providers.
//
// Not the same source as `a16z-speedrun-talent.mjs` (speedrun-talent-network
// .com): that feed links to its own posting pages and its company set differs
// (it carries no Pinterest/Stripe roles, for one). The two overlap; downstream
// URL dedup does not fold them, because the speedrun feed has no ATS link.
//
// The board is a Next.js app with no documented API. Its "Load more" button
// calls a Next.js server action, `loadMorePublicJobs`, which is a plain POST
// to the board page itself:
//
//   POST https://jobs.a16z.com/jobs
//   headers: next-action: <action id>, accept: text/x-component
//   body:    [ {sort: "recent"}, {page: N, limit: 25} ]      (page is 1-based)
//   -> React Server Components text; the line `1:{...}` is the JSON payload
//      { jobs: [...], total, page, perPage, isDone, facets }
//
// The action id is a build hash: it changes on every deploy of the board.
// It is read from the board's own JavaScript chunks (the chunk that calls
// `createServerReference("<id>", ..., "loadMorePublicJobs")`), kept in
// `ctx.idCache` for a day, and read again when the board answers the POST
// with 404 "Server action not found" (a new deploy). robots.txt on
// jobs.a16z.com is `Allow: /` for `User-agent: *` (checked 2026-10-28).
//
//   - name: a16z (portfolio)
//     provider: a16z-portfolio
//     enabled: true
//     # max_pages: 60          # 25 jobs per page, newest first
//     # a16z_max_age_days: 14  # stop paging once postings are older than this
//
// Observed behaviour this provider relies on (live, 2026-10-28):
//   - results are newest-first by `posted_at` (monotonic across pages);
//   - `limit` above 25 shifts the offset (page N starts at N*limit-25), so the
//     provider keeps the page size the board's own client uses, 25;
//   - the backend stops paging around result 10,000: a request past that
//     window answers with an earlier `page` number instead of an error. The
//     provider treats a response whose `page` differs from the one it asked
//     for as the end of the walk (stop reason `window`).
//
// The board posts roughly 150 roles a day, so the default (60 pages x 25 =
// 1,500 newest postings) covers about ten days; `a16z_max_age_days` (default
// 14) usually ends the walk first. Both are pagination bounds, not filters.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry, sleep } from './_http.mjs';
import { cachedLookup } from './_cached-lookup.mjs';

const ORIGIN = 'https://jobs.a16z.com';
const BOARD_URL = `${ORIGIN}/jobs`;
const CACHE_KEY = 'jobs.a16z.com';
const PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 60;
// Hard ceiling on a user `max_pages`. The backend's own result window (~10,000
// postings = 400 pages of 25) ends a walk before this; the cap is for a board
// that stops clamping.
const MAX_PAGES_CAP = 400;
const DEFAULT_MAX_AGE_DAYS = 14;
const INTER_PAGE_DELAY_MS = 250;
// The board page links ~12 chunks; the action lives in a page chunk near the
// end of the list. A bound keeps a changed page from fanning out into dozens
// of chunk downloads.
const MAX_CHUNKS = 30;
// A day: a deploy changes the id, and a stale id costs one 404 + one lookup.
const ACTION_ID_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const ACTION_ID_RE = /^[0-9a-f]{20,64}$/;

/**
 * Same-origin chunk paths the board page loads, in reverse document order
 * (page-specific chunks, where the server action lives, come last).
 * Exported for unit tests.
 *
 * @param {string} html
 * @returns {string[]} paths such as `/_next/static/chunks/abc.js`
 */
export function extractChunkPaths(html) {
  if (typeof html !== 'string') return [];
  const seen = new Set();
  for (const m of html.matchAll(/["'](\/_next\/static\/chunks\/[A-Za-z0-9_.~-]+\.js)["']/g)) {
    seen.add(m[1]);
  }
  return [...seen].reverse();
}

/**
 * The `loadMorePublicJobs` server action id in a Next.js client chunk, or null.
 * Exported for unit tests.
 *
 * @param {string} js
 * @returns {string | null}
 */
export function extractActionId(js) {
  if (typeof js !== 'string') return null;
  const m = js.match(/createServerReference\)\(\s*["']([0-9a-f]{20,64})["'][^)]{0,160}?["']loadMorePublicJobs["']\s*\)/);
  return m ? m[1] : null;
}

/**
 * React Server Components escape a string that starts with `$` as `$$`, and
 * encode `undefined` as `"$undefined"`. Undo both for display strings.
 *
 * @param {unknown} value
 * @returns {string}
 */
function rscString(value) {
  if (typeof value !== 'string') return '';
  if (value === '$undefined') return '';
  return (value.startsWith('$$') ? value.slice(1) : value).trim();
}

/**
 * Parse a `loadMorePublicJobs` response body. Exported for unit tests.
 *
 * Throws when no RSC line carries a `{ jobs: [...] }` object: the action
 * answered, but not with the documented shape (a markup/API change), which
 * must not read as an empty board.
 *
 * @param {string} text
 * @returns {{ jobs: any[], total: number | null, page: number | null, isDone: boolean }}
 */
export function parseActionResponse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('a16z-portfolio: empty response from the load-more action');
  }
  const seenKeys = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^[0-9a-f]+:(\{.*\})\s*$/);
    if (!m) continue;
    let obj;
    try {
      obj = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (obj && Array.isArray(obj.jobs)) {
      return {
        jobs: obj.jobs,
        total: Number.isFinite(obj.total) ? obj.total : null,
        page: Number.isInteger(obj.page) ? obj.page : null,
        isDone: obj.isDone === true,
      };
    }
    if (obj && typeof obj === 'object') seenKeys.push(...Object.keys(obj));
  }
  throw new Error(`a16z-portfolio: unexpected load-more response — expected jobs[], got keys: [${[...new Set(seenKeys)].join(', ')}]`);
}

// NaN-safe; non-positive values are a board bug, not 1970.
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}

/**
 * The employer's https posting link. Ashby apply links end in `/application`;
 * the posting itself is the path without it, which is the form the ashby
 * provider emits, so URL dedup folds the two.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function postingUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:') return '';
  if (parsed.hostname === 'jobs.ashbyhq.com') parsed.pathname = parsed.pathname.replace(/\/application\/?$/, '');
  return parsed.href;
}

function locationString(job) {
  const parts = [];
  const add = (s) => {
    for (const piece of rscString(s).split(' · ')) {
      const p = piece.trim();
      if (p && !parts.includes(p)) parts.push(p);
    }
  };
  if (Array.isArray(job.locations) && job.locations.length > 0) job.locations.forEach(add);
  else add(job.location);
  if (job.remote === true && !parts.some((p) => /remote/i.test(p))) parts.push('Remote');
  return parts.join(' · ');
}

function salaryOf(job) {
  const period = typeof job.salary_period === 'string' ? job.salary_period.trim().toLowerCase() : '';
  if (period && period !== 'year') return null;
  const min = Number(job.salary_min);
  const max = Number(job.salary_max);
  const lo = Number.isFinite(min) && min > 0 ? min : null;
  const hi = Number.isFinite(max) && max > 0 ? max : null;
  if (lo === null && hi === null) return null;
  const currency = typeof job.salary_currency === 'string' ? job.salary_currency.trim() : '';
  return { min: lo ?? hi, max: hi ?? lo, currency };
}

/**
 * Map one `jobs[]` row to a Job, or null when it has no title or no https
 * employer link, or the board marks it inactive. Exported for unit tests.
 *
 * @param {any} job
 */
export function toJob(job) {
  if (!job || typeof job !== 'object') return null;
  if (job.active === false) return null;
  const title = rscString(job.title);
  const url = postingUrl(job.apply_url);
  if (!title || !url) return null;
  /** @type {any} */
  const row = {
    title,
    url,
    company: rscString(job.company_name) || 'a16z portfolio',
    location: locationString(job),
  };
  const postedAt = toEpochMs(job.posted_at);
  if (postedAt !== undefined) row.postedAt = postedAt;
  const salary = salaryOf(job);
  if (salary) row.salary = salary;
  return row;
}

function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

function resolveMaxAgeDays(entry) {
  const v = entry?.a16z_max_age_days;
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MAX_AGE_DAYS;
}

/** Read the action id from the board page's chunks. Throws when none has it. */
async function discoverActionId(ctx) {
  const probing = Number(ctx?.maxPages) > 0;
  const html = await fetchTextWithRetry(ctx, BOARD_URL, {
    redirect: 'error',
    headers: { accept: 'text/html', 'user-agent': BROWSER_LIKE_USER_AGENT },
  });
  const chunks = extractChunkPaths(html).slice(0, MAX_CHUNKS);
  if (chunks.length === 0) {
    throw new Error(`a16z-portfolio: no Next.js chunks found on ${BOARD_URL} — the board page changed`);
  }
  for (const path of chunks) {
    let js;
    try {
      // `path` is matched as a same-origin `/_next/static/chunks/...` path, so
      // the request stays on the fixed jobs.a16z.com origin.
      js = await fetchTextWithRetry(ctx, `${ORIGIN}${path}`, { redirect: 'error' });
    } catch (err) {
      // A health probe's request budget surfaces as a rejection here; it must
      // reach verify-portals unwrapped.
      if (probing) throw err;
      continue;
    }
    const id = extractActionId(js);
    if (id) return id;
  }
  throw new Error(`a16z-portfolio: the loadMorePublicJobs action was not found in ${chunks.length} chunks of ${BOARD_URL} — the board changed`);
}

function resolveActionId(ctx) {
  return cachedLookup(ctx?.idCache, CACHE_KEY, () => discoverActionId(ctx), {
    isValid: (v) => typeof v === 'string' && ACTION_ID_RE.test(v),
    maxAgeMs: ACTION_ID_MAX_AGE_MS,
  });
}

async function loadPage(ctx, actionId, page) {
  const text = await fetchTextWithRetry(ctx, BOARD_URL, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'next-action': actionId,
      accept: 'text/x-component',
      'content-type': 'text/plain;charset=UTF-8',
      'user-agent': BROWSER_LIKE_USER_AGENT,
    },
    body: JSON.stringify([{ sort: 'recent' }, { page, limit: PAGE_SIZE }]),
  });
  return parseActionResponse(text);
}

/** @type {Provider} */
export default {
  id: 'a16z-portfolio',

  // One fixed board; no per-entry URL to match.
  detect(entry) {
    return entry?.provider === 'a16z-portfolio' ? { url: BOARD_URL } : null;
  },

  async fetch(entry, ctx) {
    const label = entry?.name || 'a16z portfolio';
    const ctxMax = Number(ctx?.maxPages);
    const probing = ctxMax > 0;
    const maxPages = Math.min(resolveMaxPages(entry), probing ? ctxMax : Infinity);
    const maxAgeDays = resolveMaxAgeDays(entry);
    const cutoffMs = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86_400_000 : 0;

    let actionId = await resolveActionId(ctx);
    const out = [];
    const seen = new Set();
    /** @type {'complete' | 'age' | 'window' | 'cap' | 'probe' | 'fetch-error'} */
    let stopReason = 'cap';

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let res;
      try {
        res = await loadPage(ctx, actionId, page);
      } catch (err) {
        if (page === 1 && err?.status === 404 && !probing) {
          // "Server action not found": the board was redeployed. Read the new
          // id once and retry the first page; a second 404 is a real failure.
          ctx?.idCache?.delete(CACHE_KEY);
          actionId = await resolveActionId(ctx);
          res = await loadPage(ctx, actionId, page);
        } else if (page === 1 || probing) {
          throw err;
        } else {
          const cause = err instanceof Error ? err.message : String(err);
          console.error(`⚠️  a16z-portfolio: ${label} truncated at page ${page} after retries (${out.length} jobs): ${cause}`);
          stopReason = 'fetch-error';
          break;
        }
      }

      // Past the backend's result window the board answers an earlier page.
      if (res.page !== null && res.page !== page) {
        stopReason = 'window';
        break;
      }

      let reachedOld = false;
      for (const raw of res.jobs) {
        const job = toJob(raw);
        if (!job) continue;
        if (cutoffMs > 0 && job.postedAt !== undefined && job.postedAt < cutoffMs) {
          reachedOld = true;
          continue;
        }
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        out.push(job);
      }

      // Short-page stop reads the source's own row count, not the kept count.
      if (res.jobs.length < PAGE_SIZE || res.isDone) {
        stopReason = 'complete';
        break;
      }
      if (reachedOld) {
        stopReason = 'age';
        break;
      }
      if (page === maxPages) stopReason = probing ? 'probe' : 'cap';
    }

    if (stopReason === 'cap') {
      const until = maxAgeDays > 0 ? `a16z_max_age_days (${maxAgeDays})` : 'the end of the board';
      console.error(`⚠️  a16z-portfolio: ${label} stopped at max_pages (${maxPages} pages, ${out.length} jobs) before reaching ${until} — raise max_pages on this entry for older postings`);
    }
    return out;
  },
};
