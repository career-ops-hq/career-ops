// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchTextWithRetry, parseRetryAfterMs, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Paylocity provider — single-company ATS adapter for `tracked_companies:`.
// Auto-detects from careers_url `https://recruiting.paylocity.com/Recruiting/Jobs/All/<guid>`
// (path matched case-insensitively; a trailing company slug or query string,
// both of which Paylocity serves the same board under, are ignored).
//
// Paylocity has no usable public JSON list API for a board: its job feed
// endpoint (/recruiting/v2/api/feed/jobs/<guid>) answers `jobs: []` for boards
// whose page lists open postings. The public board page itself is
// server-rendered with the whole list in one inline script —
// `window.pageData = {...}` — and is not paginated: a board with 2,000+
// postings arrives in a single ~1.6 MB response. One request per board.
//
// The blob is JSON, so titles arrive already decoded (a literal `&`, never
// `&amp;`) and need no pass through _html-entities.mjs.
//
// Field choices:
// - location: `LocationName`, the employer's own label. `JobLocation.Country`
//   is not used: it is often the tenant's default (`USA`) on postings whose
//   LocationName is a German or UK site. City/State are a fallback for an
//   empty LocationName. A posting with `ShouldDisplayLocation: false` gets
//   no place. "Remote" or "Hybrid" is appended the way the board page labels
//   the posting (see REMOTE_TYPE_LABELS), also when the place is hidden.
// - postedAt: `PublishedDate` (ISO with offset).
// - description: omitted — the list carries only a truncated ~110-char snippet.
// - requisitionId / language: omitted — the payload has no such fields.
// - company: entry.name, or the board's own `ModuleTitle` when entry.name is
//   empty.
// - `IsInternal` postings are dropped: they are for the employer's staff.
//
// A board GUID that doesn't exist answers 302 -> /Recruiting/Jobs/JobNotFound.
// fetch() requests with redirect:'manual' (never followed) so that 3xx can be
// told apart from any other redirect, and maps it to a synthetic 404 so
// dead-boards.mjs's cross-run cache (which only trusts a literal 404) retires
// the board, the same convention as providers/bamboohr.mjs.

const HOST = 'recruiting.paylocity.com';
const ORIGIN = `https://${HOST}`;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOARD_PATH_RE = /^\/recruiting\/jobs\/all\/([^/?#]+)/i;
const NOT_FOUND_PATH_RE = /^(?:https:\/\/recruiting\.paylocity\.com)?\/recruiting\/jobs\/jobnotfound\/?$/i;
// The biggest observed board (2,000+ postings) took ~5 s; the shared 10 s
// default leaves too little headroom on a slow day.
const TIMEOUT_MS = 30_000;
// recruiting.paylocity.com serves every tenant's board and holds each client to
// a request rate, not a concurrency: measured 2026-11-22 from one IP, 20
// requests at ~2.8/s all answered 200, while 5 requests inside about a second
// were followed by HTTP 429 with `Retry-After: 30` on every request until the
// 30 s block ended (24 requests at 5/s: 5 x 200, then 19 x 429). A board answers
// in ~0.1 s, so two workers offered ~15-20 requests/s and the sweep spent its
// time inside 30 s blocks (9,052 of 10,252 boards got a 429; 10 h run).
// The provider therefore spaces requests itself, for every worker, and treats a
// 429 as a host-wide pause rather than a per-board retry.
const MIN_INTERVAL_MS = Number.isFinite(Number(process.env.CAREER_OPS_PAYLOCITY_MIN_INTERVAL_MS))
  && process.env.CAREER_OPS_PAYLOCITY_MIN_INTERVAL_MS !== undefined
  ? Number(process.env.CAREER_OPS_PAYLOCITY_MIN_INTERVAL_MS)
  : 400;
const DEFAULT_BLOCK_MS = 30_000;
// The shared retry honours a Retry-After header (up to maxDelayMs * 4) and
// otherwise backs off exponentially; a 302 is not retried.
const RETRY_POLICY = { retries: 3, baseDelayMs: 2_000, maxDelayMs: 15_000 };

/** Shared by every board fetch in the process. */
export const pacing = { nextSlot: 0, blockedUntil: 0, lastDispatch: -Infinity };

/**
 * Wait for this request's turn: at least `minIntervalMs` after the previous
 * dispatch, and not before a 429 block has ended. Reserves the slot and records
 * the dispatch synchronously, so concurrent workers queue instead of racing.
 * @param {{ sleep?: (ms: number) => Promise<void> }} ctx
 * @param {{ now?: () => number, minIntervalMs?: number }} [opts]
 */
export async function waitForSlot(ctx, { now = Date.now, minIntervalMs = MIN_INTERVAL_MS } = {}) {
  // A 429 can land while this caller sleeps, and a stalled event loop can wake
  // several sleepers in one turn; re-reserve until neither applies.
  for (;;) {
    const at = Math.max(now(), pacing.nextSlot, pacing.blockedUntil, pacing.lastDispatch + minIntervalMs);
    pacing.nextSlot = at + minIntervalMs;
    const wait = at - now();
    if (wait > 0) await sleep(wait, ctx);
    if (pacing.blockedUntil <= at && now() >= pacing.lastDispatch + minIntervalMs) {
      pacing.lastDispatch = now();
      return;
    }
  }
}

/** @param {unknown} err @param {() => number} [now] */
export function noteRateLimit(err, now = Date.now) {
  const status = /** @type {any} */ (err)?.status;
  if (status !== 429) return;
  const retryMs = parseRetryAfterMs(/** @type {any} */ (err)?.retryAfter);
  const ms = retryMs > 0 ? Math.min(retryMs, 120_000) : DEFAULT_BLOCK_MS;
  pacing.blockedUntil = Math.max(pacing.blockedUntil, now() + ms);
}

/** Context whose fetchText waits its turn and records a 429 block. Only the real HTTP transport is paced. */
function pacedCtx(ctx) {
  if (ctx?.transport !== 'http' || MIN_INTERVAL_MS <= 0) return ctx;
  return {
    ...ctx,
    fetchText: async (url, opts) => {
      await waitForSlot(ctx);
      try {
        return await ctx.fetchText(url, opts);
      } catch (err) {
        noteRateLimit(err);
        throw err;
      }
    },
  };
}
// The board page labels a posting from `IndeedRemoteType`, and only when
// `IsRemote` is true: 0 "Temporarily WFH due to COVID-19", 1 "Hybrid Remote",
// 2 "Fully Remote", any other value no label. The label is shown whether or not
// the location itself is displayed.
const REMOTE_TYPE_LABELS = { 0: 'Remote', 1: 'Hybrid', 2: 'Remote' };

/**
 * Canonical board URL for a board GUID, or null when the value is not a GUID.
 * @param {unknown} guid
 * @returns {string | null}
 */
export function boardUrl(guid) {
  const value = typeof guid === 'string' ? guid.trim() : '';
  return GUID_RE.test(value) ? `${ORIGIN}/Recruiting/Jobs/All/${value.toLowerCase()}` : null;
}

/**
 * Canonical board URL from an entry's `api` or `careers_url`, or null. Only
 * the GUID is taken from the input; the URL is rebuilt on the fixed host.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveBoardUrl(entry) {
  const rawApi = typeof entry?.api === 'string' ? entry.api : '';
  const rawCareers = typeof entry?.careers_url === 'string' ? entry.careers_url : '';
  const raw = (rawApi || rawCareers).trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== HOST) return null;
  return boardUrl(parsed.pathname.match(BOARD_PATH_RE)?.[1]);
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} value */
function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The `window.pageData` object from a board page, or null when the page
 * carries no such script or its content is not valid JSON.
 * @param {unknown} html
 */
export function extractPageData(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/window\.pageData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Parse a board page into Job[]. Exported for unit tests.
 * Throws when the page has no `window.pageData` blob or the blob has no
 * `Jobs` array (a markup change); returns [] for a board with no openings.
 * @param {unknown} html
 * @param {string} companyName
 */
export function parsePaylocityBoard(html, companyName) {
  const pageData = extractPageData(html);
  if (!pageData || typeof pageData !== 'object') {
    throw new Error('paylocity: window.pageData not found on the board page');
  }
  const rows = Array.isArray(pageData.Jobs) ? pageData.Jobs : null;
  if (!rows) {
    throw new Error(`paylocity: unexpected pageData — expected Jobs[], got: [${Object.keys(pageData).join(', ')}]`);
  }
  const company = clean(companyName) || clean(pageData.ModuleTitle);
  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.IsInternal === true) continue;
    const title = clean(row.JobTitle);
    if (!title) continue;
    const id = row.JobId == null ? '' : String(row.JobId).trim();
    if (!id) continue;
    const encodedId = safeEncodeURIComponent(id);
    if (encodedId === null) continue;

    const place = row.JobLocation && typeof row.JobLocation === 'object' ? row.JobLocation : {};
    // ShouldDisplayLocation:false is the employer hiding the location on its
    // own board, so neither LocationName nor the structured fields are shown.
    const hidden = row.ShouldDisplayLocation === false;
    const name = hidden ? '' : clean(row.LocationName);
    const parts = hidden ? [] : name ? [name] : [clean(place.City), clean(place.State)].filter(Boolean);
    const remoteType = String(row.IndeedRemoteType);
    const workMode = row.IsRemote === true && Object.hasOwn(REMOTE_TYPE_LABELS, remoteType)
      ? REMOTE_TYPE_LABELS[remoteType]
      : undefined;
    if (workMode) parts.push(workMode);

    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = {
      title,
      url: `${ORIGIN}/Recruiting/Jobs/Details/${encodedId}`,
      company,
      location: parts.join(', '),
    };
    const postedAt = toEpochMs(row.PublishedDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'paylocity',

  detect(entry) {
    const url = resolveBoardUrl(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const url = resolveBoardUrl(entry);
    if (!url) throw new Error(`paylocity: cannot derive board URL for ${entry?.name}`);
    let html;
    try {
      html = await fetchTextWithRetry(pacedCtx(ctx), url, { redirect: 'manual', timeoutMs: TIMEOUT_MS }, RETRY_POLICY);
    } catch (err) {
      if (typeof err?.status === 'number' && err.status >= 300 && err.status < 400
        && NOT_FOUND_PATH_RE.test(String(err.location || ''))) {
        const deadErr = /** @type {Error & {status?: number}} */ (
          new Error(`paylocity: ${url} redirected to JobNotFound — no such board`));
        deadErr.status = 404;
        throw deadErr;
      }
      throw err;
    }
    return parsePaylocityBoard(html, entry?.name);
  },
};
