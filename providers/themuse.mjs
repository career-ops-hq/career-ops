// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// The Muse provider — public, zero-auth JSON jobs feed.
// Endpoint: https://www.themuse.com/api/public/jobs?page={n}
// Response shape: { results: [...], page: n, page_count: N }
// All pages are fetched sequentially and aggregated before normalizing.
//
// Wire in via a `job_boards:` entry with `provider: themuse`.

const FEED_BASE = 'https://www.themuse.com/api/public/jobs';
const TRUSTED_HOST = 'www.themuse.com';

// Safety cap on pagination. The feed can carry tens of thousands of pages;
// this board only ever samples the first slice of it regardless of retry
// behavior below.
const MAX_PAGES = 100;

// Retry policy for transient page failures (429 rate-limit, 5xx,
// timeouts/aborts). Without retry, one stalled request out of up to 100
// sequential page fetches throws and discards every job already gathered
// from this board for the run -- the whole board reads as "not working" when
// only one page had a bad moment. Mirrors workday.mjs / oraclecloud.mjs.
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;

// Delay between successive pages so a 100-page walk doesn't fire as a burst
// against the same host (mirrors workday.mjs / oraclecloud.mjs).
const INTER_PAGE_DELAY_MS = 150;

function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses a `Retry-After` header value (seconds, or an HTTP-date) to ms, or null. */
function parseRetryAfterMs(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

function isRetryableError(err) {
  const status = err?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  return status === undefined; // network error / timeout / abort — no status set
}

/** Fetches a single page, retrying transient failures with backoff. */
async function fetchPageWithRetry(ctx, url, opts) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await ctx.fetchJson(url, opts);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryableError(err)) throw err;
      const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
      // A server-supplied Retry-After is honored, but still clamped — an
      // unbounded value would otherwise stall this board's fetch for as long
      // as the server says, defeating the point of a bounded backoff.
      const retryAfterMs = parseRetryAfterMs(err?.retryAfter);
      const delayMs = retryAfterMs !== null ? Math.min(retryAfterMs, RETRY_MAX_DELAY_MS * 4) : (backoff + Math.random() * 250);
      await sleep(delayMs, ctx);
    }
  }
  throw lastErr;
}

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
 * Normalize a single result from the Muse API response. Exported for unit tests.
 *
 * Field mapping:
 *   name              → title
 *   refs.landing_page → url
 *   company.name      → company
 *   locations[0].name → location
 *
 * Returns null when required fields (title or url) are missing or invalid.
 *
 * @param {any} j
 * @returns {{ title: string, url: string, company: string, location: string } | null}
 */
export function normalizeMuseJob(j) {
  if (!j || typeof j !== 'object') return null;
  const title = typeof j.name === 'string' ? j.name.trim() : '';
  if (!title) return null;
  const url = typeof j.refs?.landing_page === 'string' ? j.refs.landing_page.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const company =
    typeof j.company?.name === 'string' && j.company.name.trim()
      ? j.company.name.trim()
      : 'The Muse';
  const location =
    Array.isArray(j.locations) && j.locations.length > 0 && typeof j.locations[0]?.name === 'string'
      ? j.locations[0].name.trim()
      : '';
  return { title, url, company, location };
}

/** @type {Provider} */
export default {
  id: 'themuse',

  async fetch(_entry, ctx) {
    assertMuseUrl(FEED_BASE);
    const allResults = [];
    // Fetch page 0 first to discover page_count, then iterate remaining pages.
    let pageCount = 1;
    for (let page = 0; page < pageCount; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = `${FEED_BASE}?page=${page}`;
      let json;
      try {
        // redirect:'error' prevents SSRF via server-side redirects
        json = await fetchPageWithRetry(ctx, url, { redirect: 'error' });
      } catch (err) {
        // A transient failure that survives every retry should not discard
        // every job already gathered from earlier pages in this run — return
        // what was collected instead of throwing the whole board away. A
        // failure on page 0 still surfaces as zero jobs, which scan.mjs's own
        // empty-board reporting already covers; this only changes the
        // behavior for page 1+.
        console.error(`⚠️  themuse: truncated at page ${page} of ${pageCount === 1 ? 'unknown' : pageCount} after ${MAX_RETRIES + 1} attempts (${allResults.length} jobs gathered so far): ${err.message}`);
        break;
      }
      if (!json || !Array.isArray(json.results)) {
        throw new Error(
          `themuse: unexpected API response on page ${page} — expected { results: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      if (page === 0 && Number.isInteger(json.page_count) && json.page_count > 1) {
        pageCount = Math.min(json.page_count, MAX_PAGES);
      }
      allResults.push(...json.results);
    }
    return allResults.map(normalizeMuseJob).filter(Boolean);
  },
};
