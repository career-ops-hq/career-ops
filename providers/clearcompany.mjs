// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { coerceId } from './_ids.mjs';

// ClearCompany (ClearCo) provider — a single-company ATS adapter
// (→ tracked_companies:). A ClearCompany tenant embeds its job list on its
// own branded careers page with a script tag:
//
//   <script src="https://careers-content.clearcompany.com/js/v1/career-site.js?siteId=<GUID>">
//
// and that widget reads a public, no-auth JSON API keyed on the same siteId:
//
//   GET https://careers-api.clearcompany.com/v1/<siteId>?pageIndex=N&pageSize=M
//   → { results: [{ id, userDefinedId, positionTitle, description, postedDate,
//        openDate, location, locations: [{ city, subdivision, country, isRemote }],
//        brandName, applyLink, ... }],
//       currentPageIndex, totalCount, currentPageCount }
//
// `pageIndex` is 0-based (the widget's own comment says so); a page past the
// end answers `results: []`. The widget sends its configured `pageSize` (10
// by default); whether the server honours or clamps a larger one could not be
// checked live, since the tenant had too few postings to tell. So a short page
// is never read as the end of the board: without a `totalCount`, the walk
// stops only on an empty page or a repeat of the previous one.
//
// The branded careers page is the only "job page" a tenant has, and its URL is
// not in the payload, so there is nothing to build a posting URL from except
// `applyLink`: an absolute `https://jobs.clearcompany.com/careers/jobs/<id>/apply`
// page that serves the posting and its application form. That is the canonical
// `Job.url`. The widget treats an `applyLink` containing `@` as an
// email-to-apply posting (the link is then a bare address); such a row has no
// URL to dedup on and is dropped, as is any non-https link.
//
// Detection: the siteId is the tenant key, so detect() claims the two URLs that
// carry it — the API URL itself, or the embed-script URL a user finds in the
// careers page source. A branded careers page is never claimed (shape 1 in
// ADDING_A_PROVIDER.md). The fetched URL is rebuilt from a fixed literal host
// plus a GUID-validated siteId, so no input host or path reaches the request.

const API_HOST = 'careers-api.clearcompany.com';
const EMBED_HOST = 'careers-content.clearcompany.com';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_SIZE = 100;
// Safety cap on pagination, independent of the source-reported totalCount and
// of ctx.maxPages. 20 pages = 2,000 postings; override per entry with
// max_pages, itself capped at MAX_PAGES_CAP.
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 300;
const PAGE_DELAY_MS = 200;

/**
 * Extract the siteId from an API URL (`careers-api.clearcompany.com/v1/<siteId>`)
 * or an embed-script URL (`careers-content.clearcompany.com/...?siteId=<siteId>`).
 * @param {unknown} raw
 * @returns {string | null} lower-cased siteId, or null
 */
export function extractSiteId(raw) {
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
    const m = u.pathname.match(/^\/v1\/([^/]+)\/?$/);
    candidate = m ? m[1] : null;
  } else if (host === EMBED_HOST) {
    // The widget lowercases its own script URL before reading params, so the
    // key is matched case-insensitively too.
    for (const [k, v] of u.searchParams) {
      if (k.toLowerCase() === 'siteid') { candidate = v; break; }
    }
  }
  return candidate && GUID_RE.test(candidate) ? candidate.toLowerCase() : null;
}

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null} the API base URL for the entry's tenant
 */
export function resolveApiUrl(entry) {
  const siteId = extractSiteId(entry?.api) || extractSiteId(entry?.careers_url);
  return siteId ? `https://${API_HOST}/v1/${siteId}` : null;
}

/** @param {import('./_types.js').PortalEntry} entry */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @param {unknown} value @returns {number | undefined} */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} raw @returns {string | null} */
function httpsUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** @param {any} row @returns {string} */
export function jobLocation(row) {
  if (typeof row?.location === 'string' && row.location.trim()) return row.location.trim();
  const first = Array.isArray(row?.locations) ? row.locations[0] : null;
  if (!first || typeof first !== 'object') return '';
  const parts = [first.city, first.subdivisionFullName || first.subdivision, first.country]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  const place = parts.join(', ');
  if (first.isRemote === true) return place ? `Remote (${place})` : 'Remote';
  return place;
}

/**
 * Map one API page to { rawCount, rawKey, total, jobs }. Throws when the envelope is
 * not the documented `{ results: [] }` shape; drops a single malformed row.
 * @param {any} json
 * @param {string} company
 */
export function parseClearCompanyPage(json, company) {
  const rows = json && Array.isArray(json.results) ? json.results : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`clearcompany: unexpected response — expected results[], got: [${got}]`);
  }
  const total = typeof json.totalCount === 'number' && Number.isFinite(json.totalCount) ? json.totalCount : null;
  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const title = typeof row.positionTitle === 'string' ? row.positionTitle.replace(/\s+/g, ' ').trim() : '';
    const url = httpsUrl(row.applyLink);
    if (!title || !url) continue;
    /** @type {import('./_types.js').Job} */
    const job = { title, url, company, location: jobLocation(row) };
    const postedAt = toEpochMs(row.postedDate) ?? toEpochMs(row.openDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    const requisitionId = coerceId(row.userDefinedId);
    if (requisitionId !== undefined) job.requisitionId = requisitionId;
    const description = htmlToText(row.description);
    if (description) job.description = description;
    jobs.push(job);
  }
  // Identity of the raw page, malformed rows included, so a repeat of the
  // same page can be told apart from a page whose rows were all dropped.
  const rawKey = JSON.stringify(rows.map((r) => (r && typeof r === 'object' ? r.id ?? r.applyLink ?? null : null)));
  return { rawCount: rows.length, rawKey, total, jobs };
}

/** @type {Provider} */
export default {
  id: 'clearcompany',

  detect(entry) {
    const url = resolveApiUrl(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) {
      throw new Error(`clearcompany: cannot derive the siteId for ${entry?.name} — set careers_url or api to https://${API_HOST}/v1/<siteId>`);
    }
    const maxPages = resolveMaxPages(entry);
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = Number.isInteger(ctxMaxPages) && ctxMaxPages > 0;
    const pagesToFetch = Math.min(maxPages, probing ? ctxMaxPages : Infinity);

    const jobs = [];
    const seen = new Set();
    let total = null;
    let seenRaw = 0;
    // Why the walk stopped: 'complete' (the board ended), 'cap' (max_pages
    // cut a full board), 'fetch-error' (a later page failed after retries).
    let stopReason = 'complete';
    let lastRawCount = 0;
    let lastRawKey = null;
    let page = 0;
    for (; page < pagesToFetch; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS, ctx);
      const url = `${apiUrl}?pageIndex=${page}&pageSize=${PAGE_SIZE}`;
      let parsed;
      try {
        // Parsed inside the try, so a later page that answers 200 with a
        // broken envelope keeps the pages already read, like a failed request.
        parsed = parseClearCompanyPage(await fetchJsonWithRetry(ctx, url, { redirect: 'error' }), entry.name);
      } catch (err) {
        // First page, or any page during a probe: propagate unwrapped, so a
        // dead tenant reads as broken and ProbePageBudgetReached survives.
        if (page === 0 || probing) throw err;
        console.error(`⚠️  clearcompany: ${entry.name} truncated at page ${page + 1} (${jobs.length}${total !== null ? ` of ${total}` : ''} jobs): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }
      if (total === null) total = parsed.total;
      lastRawCount = parsed.rawCount;
      seenRaw += parsed.rawCount;
      for (const job of parsed.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      // Natural end: an empty page, every posting the source counted has been
      // served, or (with no count) a repeat of the previous page, which is what
      // a server ignoring pageIndex returns. A short page alone is not an end,
      // since the server may clamp pageSize below ours.
      if (parsed.rawCount === 0) break;
      if (total !== null && seenRaw >= total) break;
      if (total === null && parsed.rawKey === lastRawKey) break;
      lastRawKey = parsed.rawKey;
    }
    // Ran out of page budget on a full page with more postings still counted.
    if (
      stopReason === 'complete' && page === maxPages && lastRawCount > 0 &&
      (total !== null ? seenRaw < total : true)
    ) {
      stopReason = 'cap';
    }
    if (stopReason === 'cap') {
      console.error(`⚠️  clearcompany: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length}${total !== null ? ` of ${total}` : ''} jobs) — raise max_pages on this entry for more`);
    }
    if (stopReason !== 'complete') /** @type {any} */ (jobs).clearcompanyTruncated = true;
    return jobs;
  },
};
