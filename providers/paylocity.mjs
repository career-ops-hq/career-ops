// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchTextWithRetry } from './_http.mjs';
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
// recruiting.paylocity.com serves every tenant's board and answers 429 once a
// client sends requests faster than a few per second. The shared retry honours
// a Retry-After header (up to maxDelayMs * 4) and otherwise backs off
// exponentially; a 302 is not retried.
const RETRY_POLICY = { retries: 3, baseDelayMs: 2_000, maxDelayMs: 15_000 };
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
      html = await fetchTextWithRetry(ctx, url, { redirect: 'manual', timeoutMs: TIMEOUT_MS }, RETRY_POLICY);
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
