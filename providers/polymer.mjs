// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Polymer Hire provider (→ tracked_companies:). A tenant's public board is
// https://jobs.polymer.co/<slug>, and the board reads a public no-auth JSON
// API:
//
//   GET https://api.polymer.co/v1/hire/organizations/<slug>/jobs?page=N
//   → { items: [{ id, title, job_post_url, display_location, city,
//        state_region, country, remoteness_pretty, published_at,
//        published_at_timestamp, ... }], meta: { page, count, total, is_last,
//        next_page, ... } }
//
// Measured on the vendor demo tenant: `per_page` is ignored, `meta.total`
// stays at 1 on a multi-job board, and `?page=2` returns `items: []` while
// `meta.is_last` is false and `meta.next_page` is 3. Trusting `is_last`,
// `next_page`, or `total` walks until the page cap. The walk stops on an
// empty page, a repeated page, `is_last: true` on a page that has rows, or a
// `meta.count` that is at least this page's length and already covered by the
// rows seen. A count smaller than the page (the demo's `total` shape) is
// ignored. An unknown slug is HTTP 422, not an empty `items` array.
//
// The list payload has no description. `salary_pretty` is free text, not a
// structured salary, so it is left off the job. The request URL is rebuilt
// from the fixed API host plus a charset-checked slug.

const API_HOST = 'api.polymer.co';
const BOARD_HOST = 'jobs.polymer.co';
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 100;
const PAGE_DELAY_MS = 200;

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
export function extractSlug(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  let candidate = null;
  if (host === BOARD_HOST) {
    candidate = u.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === API_HOST) {
    const m = u.pathname.match(/^\/v1\/hire\/organizations\/([^/]+)/);
    candidate = m ? m[1] : null;
  }
  if (!candidate) return null;
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  candidate = candidate.toLowerCase();
  return SLUG_RE.test(candidate) ? candidate : null;
}

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveSlug(entry) {
  return extractSlug(entry?.api) || extractSlug(entry?.careers_url);
}

/** @param {import('./_types.js').PortalEntry} entry */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @param {unknown} value @returns {string} */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {unknown} value @returns {number | undefined} */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * @param {any} row
 * @returns {string}
 */
export function jobLocation(row) {
  const display = text(row?.display_location);
  if (display) return display;
  const place = [row?.city, row?.state_region, row?.country].map(text).filter(Boolean).join(', ');
  const remote = text(row?.remoteness_pretty);
  const isRemote = remote.length > 0 && !/^no\s+remote\b/i.test(remote) && /\bremote\b/i.test(remote);
  if (isRemote) return place ? `Remote (${place})` : 'Remote';
  return place;
}

/**
 * Use job_post_url only when it is https on jobs.polymer.co. Anything else
 * is rebuilt from the posting id so a payload cannot point the dedup key
 * at another host.
 * @param {any} row
 * @param {string} slug
 * @returns {string | null}
 */
function postingUrl(row, slug) {
  if (typeof row?.job_post_url === 'string' && row.job_post_url.trim()) {
    try {
      const u = new URL(row.job_post_url.trim());
      if (u.protocol === 'https:' && u.hostname.toLowerCase() === BOARD_HOST) return u.href;
    } catch {
      // Fall through and rebuild from the id.
    }
  }
  const id = row?.id ?? row?.job_id;
  if (id === undefined || id === null || id === '') return null;
  const encoded = safeEncodeURIComponent(id);
  if (!encoded) return null;
  return `https://${BOARD_HOST}/${slug}/${encoded}`;
}

/**
 * @param {any} row
 * @returns {number | undefined}
 */
function postedAtOf(row) {
  const fromIso = toEpochMs(row?.published_at);
  if (fromIso !== undefined) return fromIso;
  const ts = row?.published_at_timestamp;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts * 1000;
  return undefined;
}

/**
 * @param {any} json
 * @param {string} company
 * @param {string} slug
 */
export function parsePolymerPage(json, company, slug) {
  const rows = json && Array.isArray(json.items) ? json.items : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`polymer: unexpected response, expected items[], got: [${got}]`);
  }
  const meta = json.meta && typeof json.meta === 'object' ? json.meta : {};
  const count = typeof meta.count === 'number' && Number.isFinite(meta.count) ? meta.count : null;
  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const title = typeof row.title === 'string' ? row.title.replace(/\s+/g, ' ').trim() : '';
    const url = postingUrl(row, slug);
    if (!title || !url) continue;
    /** @type {import('./_types.js').Job} */
    const job = { title, url, company, location: jobLocation(row) };
    const postedAt = postedAtOf(row);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  const rawKey = JSON.stringify(rows.map((r) => (r && typeof r === 'object' ? r.id ?? r.job_id ?? null : null)));
  return { rawCount: rows.length, rawKey, isLast: meta.is_last === true, count, jobs };
}

/** @type {Provider} */
export default {
  id: 'polymer',

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: `https://${API_HOST}/v1/hire/organizations/${slug}/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) {
      throw new Error(`polymer: cannot derive the organization slug for ${entry?.name}. Set careers_url to https://${BOARD_HOST}/<slug>`);
    }
    const maxPages = resolveMaxPages(entry);
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = Number.isInteger(ctxMaxPages) && ctxMaxPages > 0;
    const pagesToFetch = Math.min(maxPages, probing ? ctxMaxPages : Infinity);

    const jobs = [];
    const seen = new Set();
    let stopReason = 'complete';
    let endedNaturally = false;
    let lastRawCount = 0;
    let lastRawKey = null;
    let seenRaw = 0;
    let page = 1;
    for (; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(PAGE_DELAY_MS, ctx);
      const apiUrl = `https://${API_HOST}/v1/hire/organizations/${slug}/jobs?page=${page}`;
      let parsed;
      try {
        parsed = parsePolymerPage(await fetchJsonWithRetry(ctx, apiUrl, { redirect: 'error' }), entry.name, slug);
      } catch (err) {
        if (page === 1 || probing) throw err;
        console.error(`⚠️  polymer: ${entry.name} truncated at page ${page} (${jobs.length} jobs): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }
      lastRawCount = parsed.rawCount;
      const repeated = lastRawKey !== null && parsed.rawKey === lastRawKey;
      seenRaw += parsed.rawCount;
      lastRawKey = parsed.rawKey;
      for (const job of parsed.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      const countCovers = parsed.count !== null && parsed.count >= parsed.rawCount && seenRaw >= parsed.count;
      if (parsed.rawCount === 0 || repeated || parsed.isLast === true || countCovers) {
        endedNaturally = true;
        break;
      }
    }
    if (
      stopReason === 'complete' && !endedNaturally && !probing &&
      pagesToFetch === maxPages && page > pagesToFetch && lastRawCount > 0
    ) {
      stopReason = 'cap';
    }
    if (stopReason === 'cap') {
      console.error(`⚠️  polymer: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length} jobs). Raise max_pages on this entry for more`);
    }
    if (stopReason !== 'complete') /** @type {any} */ (jobs).polymerTruncated = true;
    return jobs;
  },
};
