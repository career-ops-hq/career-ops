// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Kalibrr provider — reads the public job-board search JSON that kalibrr.com's
// own job board calls.
//
// Kalibrr (kalibrr.com) is a South-East Asian board, Indonesia-heavy (99 of the
// first 100 live rows) with the Philippines and Thailand behind it. The endpoint
// is a public, no-auth JSON search at /kjs/job_board/search, paginated by
// limit/offset, with a server-side keyword filter in the `text` param.
//
// This provider is designed for explicit `provider: kalibrr` in portals.yml.
// Auto-detection is not supported — Kalibrr is a job board aggregator, not a
// company ATS.
//
// Portal entry fields (all optional except `provider`):
//   api             — search endpoint (default: https://www.kalibrr.com/kjs/job_board/search)
//   searchKeywords  — server-side keyword filter (sent as the API's `text` param)
//   pageSize        — rows per request (default 100; 500 is accepted live)
//   maxPages        — page cap (default 20)
//
// Three board facts the provider is built around:
//
//   - The response's `count` is the TOTAL number of matches, not the page size,
//     so the loop stops on `offset >= count`. Traversing that total with no
//     facet filter is what keeps a scan complete rather than a slice of a
//     promoted view (Source Indexing Policy rule 3). The API does expose
//     `is_featured` and `priority_score`; neither is ever used as a filter here,
//     and neither is read as a signal.
//
//   - Every posting is employer-attributed (`company.name`) and the posting page
//     is the canonical URL — `https://www.kalibrr.com/c/{company code}/jobs/{id}/{slug}`.
//     Kalibrr's own page emits exactly this URL in its <link rel="canonical">.
//     The company-code segment is cosmetic (any value resolves to the same page),
//     but the real code is used when present so links match what the site emits.
//
//   - `apply_redirect_url` (set on ~12% of rows) is deliberately NOT used as the
//     URL: it is an opaque shortener (bit.ly/…), which Source Indexing Policy
//     rule 2 excludes — the same call `telegram-channel.mjs` makes. The posting
//     page carries the real apply path.
//
// Salary is deliberately not attached. The API publishes a month/day figure
// (`salary_interval: "month"` on 31% of live rows, `"day"` on some) while the
// normalized Job contract's `salary` is annualized compensation — attaching a
// monthly number there would be read as a yearly one by scan.mjs's
// salary_filter. The figures stay unused until they can be annualized honestly.

import { htmlToText } from './_html-to-text.mjs';

const DEFAULT_API = 'https://www.kalibrr.com/kjs/job_board/search';
const SITE_ORIGIN = 'https://www.kalibrr.com';
const TRUSTED_HOST = 'www.kalibrr.com';
const DEFAULT_PAGE_SIZE = 100;
const PAGE_SIZE_CAP = 500;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 200;

/** @param {string} url */
function assertKalibrrUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`kalibrr: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`kalibrr: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`kalibrr: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve a positive-integer entry field, falling back to a default and capped. */
function resolveInt(value, fallback, cap) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, cap);
}

/**
 * Parse the ISO timestamp Kalibrr sends (e.g. "2026-09-23T11:55:37.266927+00:00").
 * @param {unknown} value
 * @returns {number|undefined} epoch ms
 */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Build the canonical posting URL. Both `id` and `slug` come from the payload;
 * the company `code` segment is cosmetic, so a missing one falls back to the
 * placeholder segment that still resolves (verified live).
 * @param {any} job
 * @returns {string}
 */
function buildJobUrl(job) {
  const id = job?.id;
  if (!id) return '';
  const code = typeof job?.company?.code === 'string' && job.company.code.trim() ? job.company.code.trim() : '-';
  const slug = typeof job.slug === 'string' ? job.slug.trim() : '';
  const path = slug ? `/c/${code}/jobs/${id}/${slug}` : `/c/${code}/jobs/${id}`;
  const url = `${SITE_ORIGIN}${path}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== TRUSTED_HOST) return '';
  } catch {
    return '';
  }
  return url;
}

/**
 * Normalize one Kalibrr job row into the canonical Job shape.
 * Exported for tests.
 *
 * Field mapping:
 *   - title:    `name`
 *   - url:      /c/{company.code}/jobs/{id}/{slug} on kalibrr.com
 *   - company:  `company.name` → `company_name` → the portal entry's name
 *   - location: `google_location.address_components` city/region/country, with
 *               "Remote" appended when `is_work_from_home` is set
 *   - postedAt: `activation_date` (when the posting went live), else `created_at`
 *   - description: `description` + `qualifications`, flattened from HTML so
 *               scan.mjs's content_filter can match against plain text
 *
 * @param {any} job — raw row from /kjs/job_board/search
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number } | null}
 */
export function normalizeKalibrrJob(job, fallbackCompany) {
  if (!job || typeof job !== 'object') return null;

  const title = typeof job.name === 'string' ? job.name.trim() : '';
  if (!title) return null;

  const url = buildJobUrl(job);
  if (!url) return null; // an id-less (or off-host) row cannot be deduped or linked

  const name = typeof job.company?.name === 'string' ? job.company.name.trim() : '';
  const company =
    name || (typeof job.company_name === 'string' && job.company_name.trim()) || fallbackCompany || '';

  const parts = [];
  const addr = job.google_location?.address_components;
  if (addr && typeof addr === 'object') {
    for (const key of ['city', 'region', 'country']) {
      const v = typeof addr[key] === 'string' ? addr[key].trim() : '';
      if (v && !parts.includes(v)) parts.push(v);
    }
  }
  if (job.is_work_from_home === true) parts.push('Remote');

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number }} */
  const out = { title, url, company, location: parts.join(', ') };

  const description = htmlToText([job.description, job.qualifications].filter(Boolean).join(' '));
  if (description) out.description = description;

  const postedAt = toEpochMs(job.activation_date) ?? toEpochMs(job.created_at);
  if (postedAt != null) out.postedAt = postedAt;

  return out;
}

/** @type {Provider} */
export default {
  id: 'kalibrr',

  detect(_entry) {
    // Kalibrr is a job board aggregator, not a company ATS.
    // Auto-detection is intentionally not supported —
    // use `provider: kalibrr` explicitly in portals.yml.
    return null;
  },

  async fetch(entry, ctx) {
    const api = assertKalibrrUrl(entry?.api || DEFAULT_API);
    const pageSize = resolveInt(entry?.pageSize, DEFAULT_PAGE_SIZE, PAGE_SIZE_CAP);
    const maxPages = resolveInt(entry?.maxPages, DEFAULT_MAX_PAGES, MAX_PAGES_CAP);
    const keywords = typeof entry?.searchKeywords === 'string' ? entry.searchKeywords.trim() : '';
    const fallbackCompany = typeof entry?.name === 'string' ? entry.name : '';

    const out = [];
    const seen = new Set();
    let offset = 0;
    let total = null;

    for (let page = 0; page < maxPages; page++) {
      const url = new URL(api);
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String(offset));
      // `text` is the API's own keyword filter. It serverside-narrows the set
      // instead of re-ranking it, so an entry that sets it still traverses every
      // match (preferred over fetching the whole board, per rule 3's spirit).
      if (keywords) url.searchParams.set('text', keywords);

      const json = /** @type {any} */ (await ctx.fetchJson(url.href, { redirect: 'error' }));

      if (!json || !Array.isArray(json.jobs)) {
        throw new Error(
          `kalibrr: unexpected API response on offset ${offset} — expected { jobs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      if (total === null && Number.isFinite(json.count) && json.count >= 0) total = json.count;

      for (const row of json.jobs) {
        const normalized = normalizeKalibrrJob(row, fallbackCompany);
        if (!normalized || seen.has(normalized.url)) continue;
        seen.add(normalized.url);
        out.push(normalized);
      }

      offset += pageSize;
      // `count` is the total match count, so it is the honest stop condition.
      // A short page is the fallback when `count` is absent or moves mid-loop.
      if (total !== null && offset >= total) break;
      if (json.jobs.length < pageSize) break;
    }

    return out;
  },
};
