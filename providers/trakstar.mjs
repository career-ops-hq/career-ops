// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Trakstar Hire provider (→ tracked_companies:). The product was Recruiterbox.
// A tenant board is https://<client>.hire.trakstar.com (legacy host
// <client>.recruiterbox.com). The public Frontend API needs no key:
//
//   GET https://jsapi.recruiterbox.com/v1/openings?client_name=<client>&limit=N&offset=N
//   → { meta: { offset, limit, total | total_count },
//       objects: [{ id, title, description, location: { city, state, country },
//         allows_remote, hosted_url, close_date, ... }] }
//
// limit is honoured (max 250). A short page is the end. An unknown client is
// HTTP 400, not an empty objects array. close_date is when the opening
// closes, and created_on is not in the list payload, so jobs have no
// postedAt. The request URL is rebuilt from the fixed API host plus a
// charset-checked client name. robots.txt disallows /prepare* only.

const API_HOST = 'jsapi.recruiterbox.com';
const HIRE_SUFFIX = '.hire.trakstar.com';
const LEGACY_SUFFIX = '.recruiterbox.com';
const RESERVED = new Set(['www', 'jsapi', 'api', 'app', 'mail', 'support', 'help', 'status', 'blog', 'docs']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 50;
const PAGE_DELAY_MS = 200;

/**
 * One label before a known suffix, or the client_name on the Frontend API URL.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function extractClient(raw) {
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
  if (host === API_HOST) {
    if (!/^\/v1\/openings\/?$/.test(u.pathname)) return null;
    candidate = u.searchParams.get('client_name');
  } else if (host.endsWith(HIRE_SUFFIX)) {
    candidate = host.slice(0, -HIRE_SUFFIX.length);
  } else if (host.endsWith(LEGACY_SUFFIX)) {
    candidate = host.slice(0, -LEGACY_SUFFIX.length);
  }
  if (!candidate || candidate.includes('.')) return null;
  candidate = candidate.toLowerCase();
  if (RESERVED.has(candidate) || !SLUG_RE.test(candidate)) return null;
  return candidate;
}

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveClient(entry) {
  return extractClient(entry?.api) || extractClient(entry?.careers_url);
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

/**
 * @param {any} row
 * @returns {string}
 */
export function jobLocation(row) {
  const loc = row?.location && typeof row.location === 'object' ? row.location : {};
  const place = [loc.city, loc.state, loc.country].map(text).filter(Boolean).join(', ');
  if (row?.allows_remote === true) return place ? `Remote (${place})` : 'Remote';
  return place;
}

/**
 * hosted_url is kept only when it is https on this client's own board host.
 * @param {any} row
 * @param {string} client
 * @returns {string | null}
 */
function postingUrl(row, client) {
  const hireHost = `${client}.hire.trakstar.com`;
  const legacyHost = `${client}.recruiterbox.com`;
  if (typeof row?.hosted_url === 'string' && row.hosted_url.trim()) {
    try {
      const u = new URL(row.hosted_url.trim());
      const host = u.hostname.toLowerCase();
      if (u.protocol === 'https:' && (host === hireHost || host === legacyHost)) return u.href;
    } catch {
      // Fall through and rebuild from the id.
    }
  }
  const id = row?.id;
  if (id === undefined || id === null || id === '') return null;
  const encoded = safeEncodeURIComponent(id);
  if (!encoded) return null;
  return `https://${hireHost}/jobs/${encoded}/`;
}

/**
 * @param {any} json
 * @param {string} company
 * @param {string} client
 */
export function parseTrakstarPage(json, company, client) {
  const rows = json && Array.isArray(json.objects) ? json.objects : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`trakstar: unexpected response, expected objects[], got: [${got}]`);
  }
  const meta = json.meta && typeof json.meta === 'object' ? json.meta : {};
  const totalRaw = typeof meta.total === 'number' ? meta.total : meta.total_count;
  const total = typeof totalRaw === 'number' && Number.isFinite(totalRaw) ? totalRaw : null;
  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const title = typeof row.title === 'string' ? row.title.replace(/\s+/g, ' ').trim() : '';
    const url = postingUrl(row, client);
    if (!title || !url) continue;
    /** @type {import('./_types.js').Job} */
    const job = { title, url, company, location: jobLocation(row) };
    if (typeof row.description === 'string') {
      const description = htmlToText(row.description);
      if (description) job.description = description;
    }
    jobs.push(job);
  }
  const rawKey = JSON.stringify(rows.map((r) => (r && typeof r === 'object' ? r.id ?? null : null)));
  return { rawCount: rows.length, rawKey, total, jobs };
}

/** @type {Provider} */
export default {
  id: 'trakstar',

  detect(entry) {
    const client = resolveClient(entry);
    return client ? { url: `https://${API_HOST}/v1/openings?client_name=${client}` } : null;
  },

  async fetch(entry, ctx) {
    const client = resolveClient(entry);
    if (!client) {
      throw new Error(`trakstar: cannot derive the client name for ${entry?.name}. Set careers_url to https://<client>.hire.trakstar.com`);
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
    let total = null;
    let offset = 0;
    let pages = 0;
    for (; pages < pagesToFetch; pages++) {
      if (pages > 0) await sleep(PAGE_DELAY_MS, ctx);
      const apiUrl = `https://${API_HOST}/v1/openings?client_name=${client}&limit=${PAGE_SIZE}&offset=${offset}`;
      let parsed;
      try {
        parsed = parseTrakstarPage(await fetchJsonWithRetry(ctx, apiUrl, { redirect: 'error' }), entry.name, client);
      } catch (err) {
        if (pages === 0 || probing) throw err;
        console.error(`⚠️  trakstar: ${entry.name} truncated at page ${pages + 1} (${jobs.length}${total !== null ? ` of ${total}` : ''} jobs): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }
      if (total === null) total = parsed.total;
      lastRawCount = parsed.rawCount;
      const repeated = lastRawKey !== null && parsed.rawKey === lastRawKey && parsed.rawCount > 0;
      seenRaw += parsed.rawCount;
      lastRawKey = parsed.rawKey;
      for (const job of parsed.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      const counted = total !== null && seenRaw >= total;
      if (parsed.rawCount === 0 || parsed.rawCount < PAGE_SIZE || repeated || counted) {
        endedNaturally = true;
        break;
      }
      offset += parsed.rawCount;
    }
    if (
      stopReason === 'complete' && !endedNaturally && !probing &&
      pagesToFetch === maxPages && pages === pagesToFetch && lastRawCount >= PAGE_SIZE
    ) {
      stopReason = 'cap';
    }
    if (stopReason === 'cap') {
      console.error(`⚠️  trakstar: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length}${total !== null ? ` of ${total}` : ''} jobs). Raise max_pages on this entry for more`);
    }
    if (stopReason !== 'complete') /** @type {any} */ (jobs).trakstarTruncated = true;
    return jobs;
  },
};
