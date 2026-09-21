// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';

// SchoolSpring provider — K-12 districts hosted at `<district>.schoolspring.com`.
// tracked_companies: (one entry = one district). Auto-detects from careers_url.
//
// The board is an SPA over a public, unauthenticated JSON API
// (api.schoolspring.com) that takes the district's hostname as `domainName`.
// The list endpoint returns id / title / employer / location / date only — pay
// and description live behind a per-job request the zero-token scanner skips.
//
// Paginated 100 at a time. A network/HTTP failure on ANY page fails the whole
// target loudly rather than returning a silently partial board.

const SCHOOLSPRING_HOST_RE = /^[a-z0-9][a-z0-9-]*\.schoolspring\.com$/;
// `www` and `api` are the platform's own hosts, not districts.
const NON_DISTRICT = new Set(['www.schoolspring.com', 'api.schoolspring.com']);

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20; // 2,000 postings; a district never comes close
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 200;

/** @param {import('./_types.js').PortalEntry} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * District hostname from a careers_url, or null.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveHost(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !SCHOOLSPRING_HOST_RE.test(host) || NON_DISTRICT.has(host)) return null;
  return host;
}

/**
 * @param {string} host
 * @param {number} page
 */
function pageUrl(host, page) {
  const q = new URLSearchParams({
    domainName: host,
    keyword: '',
    location: '',
    category: '',
    gradelevel: '',
    jobtype: '',
    organization: '',
    swLat: '',
    swLon: '',
    neLat: '',
    neLon: '',
    page: String(page),
    size: String(PAGE_SIZE),
    sortDateAscending: 'false',
  });
  return `https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch?${q}`;
}

/** @type {Provider} */
export default {
  id: 'schoolspring',

  detect(entry) {
    const host = resolveHost(entry);
    return host ? { url: `https://${host}/` } : null;
  },

  async fetch(entry, ctx) {
    const host = resolveHost(entry);
    if (!host) throw new Error(`schoolspring: cannot derive district host for ${entry.name} (need an https://<district>.schoolspring.com careers_url)`);

    const ctxMax = Number(ctx?.maxPages);
    const ceiling = resolveMaxPages(entry);
    const pagesToFetch = ctxMax > 0 ? Math.min(ceiling, ctxMax) : ceiling;

    const jobs = [];
    const seen = new Set();
    let lastPageFull = false;
    let stoppedOnRepeat = false;
    let pagesFetched = 0;
    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      // No catch: a ctx.fetchJson rejection (including the probe's
      // ProbePageBudgetReached) propagates unwrapped, and a real failure on any
      // page fails the target instead of returning a partial list.
      const json = await fetchJsonWithRetry(ctx, pageUrl(host, page), { redirect: 'error' });
      const list = parseSchoolSpringPage(json, entry.name, `https://${host}`);
      pagesFetched++;
      // A repeated or overlapping page must not add the same postings again. A
      // page that adds nothing new is the end of the board, or the API ignoring
      // `page` and repeating itself; either way, stop instead of looping to the
      // ceiling.
      let fresh = 0;
      for (const job of list.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
        fresh++;
      }
      lastPageFull = list.rawCount >= PAGE_SIZE;
      if (!lastPageFull) break;
      if (fresh === 0) {
        stoppedOnRepeat = true;
        break;
      }
    }
    // Warn only when OUR ceiling cut a board that had more, never for a
    // ctx.maxPages probe cap and never when the API just repeated itself.
    if (lastPageFull && !stoppedOnRepeat && pagesFetched >= ceiling && !(ctxMax > 0 && ctxMax < ceiling)) {
      console.warn(`schoolspring: ${entry.name}: stopped at ${ceiling} pages (${ceiling * PAGE_SIZE} postings); raise max_pages on this entry`);
    }
    return jobs;
  },
};

/** NaN-safe; the API's timestamps carry no zone, so they read as local time. @param {unknown} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * The API HTML-escapes titles and employer names ("Hudson&#x27;s Bay", "Grade 5
 * &#8211; Teacher"), so they go through the shared decoder.
 * @param {unknown} s
 */
const clean = (s) => decodeEntities(String(s ?? '')).trim();

/**
 * Parse one `GetPagedJobsWithSearch` page. Exported for unit tests.
 *
 * Shape: `{ success, message, value: { page, size, jobsList: [{ jobId,
 * employer, title, location, displayDate }] } }`.
 *
 * - `{}`/`null` (a contentless body) or `jobsList: []` (a real empty board) → empty.
 * - `success: false`, or any other body with no `jobsList` array (including
 *   `value: null` and `jobsList: null`) → throws, naming what it got.
 * - Rows with no numeric `jobId` or no title are skipped.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {string} origin  e.g. "https://acme.schoolspring.com"
 * @returns {{jobs: Array<{title: string, url: string, company: string, location: string, postedAt?: number}>, rawCount: number}}
 */
export function parseSchoolSpringPage(json, companyName, origin) {
  if (json == null || typeof json !== 'object' || Object.keys(json).length === 0) return { jobs: [], rawCount: 0 };
  if (json.success === false) throw new Error(`schoolspring: API error: ${json.message || 'success:false'}`);
  // A real empty board answers `jobsList: []`. A response with no jobsList array
  // at all is not that, so it throws instead of silently reading as empty.
  const list = json.value?.jobsList;
  if (!Array.isArray(list)) {
    throw new Error(`schoolspring: unexpected response shape, no jobsList array (${json.value && typeof json.value === 'object' ? `value keys: ${Object.keys(json.value).join(', ') || 'none'}` : `top-level keys: ${Object.keys(json).join(', ')}`})`);
  }
  const jobs = [];
  for (const j of list) {
    const id = String(j?.jobId ?? '').trim();
    const title = clean(j?.title);
    // jobId is numeric; anything else is not a posting we can link to.
    if (!/^\d+$/.test(id) || !title) continue;
    const where = clean(j.location);
    const employer = clean(j.employer);
    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = {
      title,
      url: `${origin}/?jobid=${id}`,
      company: companyName,
      location: [where, employer].filter(Boolean).join(' - '),
    };
    const postedAt = toEpochMs(j.displayDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return { jobs, rawCount: list.length };
}
