// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

// techjobs.vn provider — https://techjobs.vn, a Vietnamese tech-jobs index
// built from each employer's own careers page or ATS board. Board-wide feed,
// so it goes in a `job_boards:` entry with an explicit `provider: techjobs`:
//
//   - name: techjobs.vn (Vietnam tech jobs)
//     provider: techjobs
//     enabled: true
//
// Source proposal: career-ops-hq/career-ops#6471 (operator-declared; the
// rule-by-rule walk-through and live measurements are on that issue).
//
// Feed. A public JSON feed published for source indexes, no key, cookie or
// session (OpenAPI 3.1 at https://techjobs.vn/feeds/openapi.json):
//
//   GET https://techjobs.vn/feeds/jobs.json?page=N&per_page=M   (M ≤ 500)
//   → { source, description, generated_at, total, page, per_page, pages,
//       next, jobs: [ { id, title, company, company_slug, location, cities,
//       workplace_type, employment_type, seniority, skills, posted_at,
//       apply_url, url, summary } ] }
//
// It is a separate endpoint from the site's search API (`/api/v1/jobs`),
// which is capped for anonymous callers; this provider never calls it.
//
// URL / dedup key (rule 2). `apply_url` is the employer's own posting
// (Greenhouse, Ashby, Lever, Workday, SmartRecruiters, or the employer's
// careers site), and that is the emitted URL — the same key a direct ATS
// provider produces for the same role, so a company tracked both ways dedups
// to one row. The feed already leaves out any job without an employer link or
// whose link points at another job board. The techjobs.vn page (`url`) is the
// fallback, used only when `apply_url` is missing or not https:, and only when
// it is itself on techjobs.vn. As in yourator.mjs, `apply_url` is accepted from
// any https: origin and not host-pinned: it is display-only and never fetched
// here, so the host lock belongs on the feed URL this provider requests.
//
// Complete inventory (rule 3). The default, unfiltered feed is the whole
// inventory: no promoted field, no ranking, pages in ascending job id (a job
// opened mid-walk lands on the last page instead of shifting earlier ones).
// The provider walks it to the end and leaves every filter to scan.mjs. The
// optional `q` / `city` / `posted_within_days` feed parameters are never sent.
//
// Measured on 2026-11-12: `total` 5,800, i.e. 12 pages at per_page=500.
// DEFAULT_MAX_PAGES is a safety bound above that, not a coverage setting.
//
// Pacing (rule 6). robots.txt allows `/feeds/` and states `Crawl-delay: 2`,
// which is used directly as the inter-page delay. A full walk is ~12 requests.
//
// No description. `summary` is a sentence generated from tagged fields (level,
// skills, domain), not the JD text, and content_filter reads any description
// as the full JD — so it is not emitted. No requisitionId either: `id` is the
// feed's own row id, not the employer's requisition id.

const TRUSTED_HOST = 'techjobs.vn';
const FEED_BASE = `https://${TRUSTED_HOST}/feeds/jobs.json`;
/** The feed's documented maximum. */
const PER_PAGE = 500;
/** 12 pages on 2026-11-12; room for the index to more than triple. */
const DEFAULT_MAX_PAGES = 40;
/** Hard ceiling even for a user-set `max_pages`. */
const MAX_PAGES_CAP = 200;
/** robots.txt `Crawl-delay: 2`. */
const INTER_PAGE_DELAY_MS = 2000;

/** @param {string} url */
function assertTechjobsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`techjobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`techjobs: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`techjobs: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @param {number} page */
export function buildPageUrl(page) {
  return `${FEED_BASE}?page=${page}&per_page=${PER_PAGE}`;
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Canonical URL for a posting: the employer's `apply_url` when it is a valid
 * https: URL, otherwise the techjobs.vn posting page when that is on
 * techjobs.vn over https:. '' when neither is usable (the caller drops the row).
 * @param {any} j
 * @returns {string}
 */
export function resolveTechjobsUrl(j) {
  const apply = typeof j?.apply_url === 'string' ? j.apply_url.trim() : '';
  if (apply) {
    try {
      const parsed = new URL(apply);
      if (parsed.protocol === 'https:') return parsed.href;
    } catch {
      // malformed: fall through to the techjobs.vn page
    }
  }
  const own = typeof j?.url === 'string' ? j.url.trim() : '';
  if (own) {
    try {
      const parsed = new URL(own);
      if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_HOST) return parsed.href;
    } catch {
      // malformed: unusable
    }
  }
  return '';
}

/**
 * The feed's `workplace_type` values the workplace policy understands
 * (`providers/_country.mjs` reads `workplaceType`). Other values the feed
 * carries ('field', 'rotational-shift', null) are left out rather than mapped.
 */
const WORKPLACE_TYPES = new Set(['remote', 'hybrid', 'onsite']);

/**
 * Normalize one feed item into the scanner's Job shape. Exported for tests.
 * @param {any} j
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number, workplaceType?: string } | null}
 */
export function normalizeTechjobsJob(j) {
  if (!j || typeof j !== 'object') return null;
  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;
  const url = resolveTechjobsUrl(j);
  if (!url) return null;
  const company = typeof j.company === 'string' ? j.company.trim() : '';
  const location = typeof j.location === 'string' ? j.location.trim() : '';
  const postedAt = toEpochMs(j.posted_at);
  const workplace = typeof j.workplace_type === 'string' ? j.workplace_type.trim().toLowerCase() : '';
  return {
    title,
    url,
    company,
    location,
    ...(postedAt !== undefined ? { postedAt } : {}),
    // A remote posting that names a city keeps its remote tag, so a
    // workplace_policy does not read it as on-site in that city.
    ...(WORKPLACE_TYPES.has(workplace) ? { workplaceType: workplace } : {}),
  };
}

/**
 * The documented envelope's jobs[] array, or a descriptive throw.
 * @param {unknown} json
 * @param {number} page
 * @returns {any[]}
 */
export function jobsOf(json, page) {
  const rows = json && typeof json === 'object' && Array.isArray(/** @type {any} */ (json).jobs)
    ? /** @type {any} */ (json).jobs
    : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`techjobs: unexpected response on page ${page} — expected { jobs: [...] }, got: [${got}]`);
  }
  return rows;
}

/** @type {Provider} */
export default {
  id: 'techjobs',

  detect(entry) {
    return entry?.provider === 'techjobs' ? { url: buildPageUrl(1) } : null;
  },

  async fetch(entry, ctx) {
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const entryMaxPages = resolveMaxPages(entry);
    const maxPages = Math.min(entryMaxPages, probing ? ctxMaxPages : Infinity);

    /** @type {any[]} */
    const jobs = [];
    const seen = new Set();
    /** @type {'complete' | 'cap' | 'fetch-error'} */
    let stopReason = 'complete';
    /** @type {number | undefined} */
    let total;

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = assertTechjobsUrl(buildPageUrl(page));

      let json;
      try {
        json = await fetchJsonWithRetry(ctx, url, { redirect: 'error' });
      } catch (err) {
        // A probe needs the rejection unwrapped (ProbePageBudgetReached), and
        // a failing first page is a broken board, not an empty one.
        if (probing || page === 1) throw err;
        console.warn(`techjobs: page ${page} failed after retries (${/** @type {any} */ (err)?.message ?? err}); keeping ${jobs.length} postings from earlier pages`);
        stopReason = 'fetch-error';
        break;
      }

      const rows = jobsOf(json, page);
      if (Number.isFinite(json.total)) total = json.total;
      for (const row of rows) {
        const job = normalizeTechjobsJob(row);
        if (!job || seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }

      // The walk's own end: an empty or short page (raw row count, before
      // malformed rows are dropped), or no `next` link.
      if (rows.length < PER_PAGE) break;
      // A full page must say whether more follow: `next` is required by the
      // feed schema, null on the last page. Absent or not a string means the
      // envelope changed, so fail loud instead of returning a silent partial.
      if (json.next === null) break;
      if (typeof json.next !== 'string' || !json.next) {
        throw new Error(`techjobs: page ${page} is full but next is ${'next' in json ? JSON.stringify(json.next) : 'missing'} — expected a URL or null`);
      }

      // Out of page budget on a full page with more to come.
      if (page === maxPages && page === entryMaxPages) stopReason = 'cap';
    }

    if (stopReason === 'cap') {
      console.warn(`techjobs: stopped at ${entryMaxPages} pages with more to read; raise max_pages on this entry`);
    }
    if (stopReason !== 'complete') {
      markTruncated(jobs, stopReason === 'cap' ? 'page-cap' : 'fetch-error', {
        fetched: jobs.length,
        ...(total !== undefined ? { total } : {}),
      });
    }
    return jobs;
  },
};
