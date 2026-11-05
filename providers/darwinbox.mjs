// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { coerceId } from './_ids.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';


const DARWINBOX_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.darwinbox\.in$/;
const CAREERS_PATH_RE = /^\/ms\/candidatev2\/([a-z0-9_-]+)\/careers(?:\/|$)/i;


const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 20; // 1,000 postings; the largest board sampled had 122
const MAX_PAGES_CAP = 200; // hard ceiling even for a max_pages override
const INTER_PAGE_DELAY_MS = 200;

/**
 * The tenant origin and company id for an entry, or null.
 * @param {any} entry
 * @returns {{origin: string, companyId: string} | null}
 */
export function resolveBoard(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let parsed;
    try {
      parsed = new URL(raw.trim());
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' || !DARWINBOX_HOST_RE.test(parsed.hostname)) continue;
    const m = parsed.pathname.match(CAREERS_PATH_RE);
    if (m) return { origin: `https://${parsed.hostname}`, companyId: m[1] };
  }
  return null;
}

/** @param {any} entry @returns {number} */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Every listed location, joined with "; ". `locations` is the display string
 * (literally "Multiple Locations" on a multi-site posting), so it is only the
 * fallback for a row without `tool_tip_locations`.
 * @param {any} row
 * @returns {string}
 */
export function jobLocation(row) {
  const tips = Array.isArray(row?.tool_tip_locations) ? row.tool_tip_locations : [];
  /** @type {string[]} */
  const parts = [];
  for (const loc of tips.length ? tips : [row?.locations]) {
    if (typeof loc !== 'string') continue;
    const label = decodeEntities(loc).replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
    if (label && !parts.includes(label)) parts.push(label);
  }
  return parts.join('; ');
}

/**
 * `posted_on` is epoch SECONDS and moves when a posting is re-released;
 * `created_on` is an ISO string for when the job was created, so only the fallback.
 * @param {any} row
 * @returns {number | undefined}
 */
function postedAtMs(row) {
  if (Number.isFinite(row?.posted_on) && row.posted_on > 0) return row.posted_on * 1000;
  if (typeof row?.created_on !== 'string' || !row.created_on) return undefined;
  const parsed = Date.parse(row.created_on);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} value @returns {number | undefined} */
function toAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Salary only for a posting that states real annual figures. Other timeframes
 * are left out rather than converted: `Job.salary` is annualized, never inferred.
 * @param {any} row
 * @returns {import('./_types.js').Job['salary'] | undefined}
 */
function jobSalary(row) {
  if (String(row?.salary_timeframe ?? '').trim().toLowerCase() !== 'annual') return undefined;
  const min = toAmount(row.salary_min);
  const max = toAmount(row.salary_max);
  if (min === undefined && max === undefined) return undefined;
  const currency = typeof row.salary_currency === 'string' ? row.salary_currency.trim().toUpperCase() : '';
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), currency };
}

/**
 * Parse an `alljobs` response. Exported for unit tests.
 *
 * `{status: "success", data: []}` is an empty board; any other envelope throws,
 * so a silent API change does not read as zero postings forever. A single
 * malformed row is dropped.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {{origin: string, companyId: string}} board
 * @returns {import('./_types.js').Job[]}
 */
export function parseDarwinboxResponse(json, companyName, board) {
  if (json?.status !== 'success' || !Array.isArray(json.data)) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`darwinbox: unexpected response — expected status "success" and a data array, got: [${got}]`);
  }
  const jobs = [];
  for (const row of json.data) {
    if (!row || typeof row !== 'object') continue;
    const title = typeof row.title === 'string' ? decodeEntities(row.title).replace(/\s+/g, ' ').trim() : '';
    const id = coerceId(row.id);
    if (!title || id === undefined) continue;
    // A lone surrogate in a host-controlled id would throw out of this loop
    // and lose the whole board; drop just that posting instead.
    const seg = safeEncodeURIComponent(id);
    if (seg === null) continue;
    /** @type {import('./_types.js').Job} */
    const job = {
      title,
      url: `${board.origin}/ms/candidatev2/${board.companyId}/careers/jobDetails/${seg}`,
      company: companyName,
      location: jobLocation(row),
    };
    const postedAt = postedAtMs(row);
    if (postedAt !== undefined) job.postedAt = postedAt;
    const requisitionId = coerceId(row.internal_job_code);
    if (requisitionId !== undefined) job.requisitionId = requisitionId;
    const salary = jobSalary(row);
    if (salary) job.salary = salary;
    const description = htmlToText(row.jd);
    if (description) job.description = description;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'darwinbox',

  detect(entry) {
    const board = resolveBoard(entry);
    return board ? { url: `${board.origin}/ms/candidatev2/${board.companyId}/careers/allJobs` } : null;
  },

  async fetch(entry, ctx) {
    const board = resolveBoard(entry);
    if (!board) {
      throw new Error(`darwinbox: cannot derive a board for ${entry?.name} — set careers_url to https://<tenant>.darwinbox.in/ms/candidatev2/<companyId>/careers/allJobs`);
    }
    const endpoint = `${board.origin}/ms/candidateapi/job/alljobs?companyId=${board.companyId}`;

    const maxPages = resolveMaxPages(entry);
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const pagesToFetch = probing ? Math.min(maxPages, ctxMaxPages) : maxPages;

    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    const seen = new Set();
    let fetched = 0;
    let total;
    // Assume the budget runs out; a short page or a failed page says otherwise.
    let stopReason = 'cap';

    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let json;
      let pageJobs;
      try {
        json = await fetchJsonWithRetry(ctx, endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ companyId: board.companyId, page, sort_option: 'new', limit: PAGE_SIZE }),
        });
        pageJobs = parseDarwinboxResponse(json, entry.name, board);
      } catch (err) {
        // The first page failing means the board is broken, not empty, and a
        // probe needs the rejection unwrapped so a budget stop keeps its identity.
        if (probing || page === 1) throw err;
        // Keep the pages already collected rather than lose the whole board.
        const cause = err instanceof Error ? err.message : String(err);
        console.error(`⚠️  darwinbox: ${entry.name} stopped at page ${page} (${jobs.length} jobs so far): ${cause}`);
        stopReason = 'fetch-error';
        break;
      }

      for (const job of pageJobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }

      // Count the rows the source returned, not the ones kept: a full page with
      // one malformed row is still a full page, and the board goes on.
      fetched += json.data.length;
      if (Number.isFinite(json.job_counts)) total = json.job_counts;
      if (json.data.length < PAGE_SIZE) {
        stopReason = 'complete';
        break;
      }
    }

    // A full last page is only a truncation if the source says there is more.
    if (stopReason === 'cap' && total !== undefined && fetched >= total) stopReason = 'complete';
    if (stopReason === 'cap' && !probing) {
      const summary = `${jobs.length}${total !== undefined ? ` of ${total}` : ''} jobs`;
      console.error(`⚠️  darwinbox: ${entry.name} truncated at max_pages=${maxPages} (${summary}) — raise max_pages on this entry for more`);
    }

    return jobs;
  },
};
