// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';

// Agentic Engineering Jobs provider — queries the site's public, documented
// REST API instead of scraping HTML. The previous scraper parsed
// `data-impression-slug` card containers out of the server-rendered listing;
// the site markup changed and the containers no longer exist, breaking the
// scraper outright (#2143). The API is the stable integration point going
// forward — no auth, CORS-enabled, and it's what the site itself recommends
// for programmatic access (OpenAPI spec at /api/v1/openapi.json).
//
//   GET {API_BASE}/jobs?page={n}   — 1-based, PAGE_SIZE per page
//   → { data: [{ title, companyName, slug, location, countries: string[],
//                description (HTML), postedAt (ISO), salaryMin/Max/Currency,
//                geoRegion, … }], meta: { total, page, per_page } }
//
// Detail URL the site itself builds: {SITE_ORIGIN}/jobs/{slug}.
// `location` is already a human-readable string ("Remote (EU)", "Bangalore,
// India") for the overwhelming majority of postings — used as-is for
// scan.mjs's location_filter. The rare posting without one falls back to the
// ISO `countries` array, decoded to country names.
//
// Rate limit: 30 requests/60s per IP (documented in the OpenAPI info block).
// PAGE_DELAY_MS paces requests comfortably under that even for the largest
// boards; MAX_PAGES is a hard stop regardless.
//
// Wire in via a `job_boards:` entry with `provider: agentic-jobs`.

const SITE_ORIGIN = 'https://agentic-engineering-jobs.com';
const API_BASE = `${SITE_ORIGIN}/api/v1`;
const TRUSTED_HOST = 'agentic-engineering-jobs.com';
const PAGE_SIZE = 50; // fixed by the API (meta.per_page)
const MAX_PAGES = 40; // safety cap on request count (40*50 = 2000 postings)
const MAX_JOBS = 2000;
const PAGE_DELAY_MS = 2100; // stays under the documented 30 req/60s limit

/** @param {string} url */
function assertAgenticUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`agentic-jobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`agentic-jobs: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`agentic-jobs: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Resolve a two-letter ISO country code to an English name. Returns '' for
 * anything that isn't a resolvable two-letter code. Exported for tests.
 * @param {unknown} code
 */
export function countryName(code) {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) return '';
  try {
    const name = regionNames.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : '';
  } catch {
    return '';
  }
}

/**
 * Strip tags (dropping script/style content entirely) and decode entities,
 * collapsing whitespace. Descriptions arrive as HTML; content_filter/
 * visa_filter match keywords by substring, so plain text avoids a tag
 * fragment accidentally breaking up (or noisily padding) a match.
 * @param {string} html
 */
export function stripHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  const noMedia = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  return decodeEntities(noMedia.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Derive a human-readable location string. Exported for tests.
 * @param {any} j
 */
export function normalizeAgenticLocation(j) {
  if (typeof j?.location === 'string' && j.location.trim()) return j.location.trim();
  const countries = Array.isArray(j?.countries) ? j.countries : [];
  const names = [...new Set(countries.map(countryName).filter(Boolean))];
  if (names.length) return names.join(' / ');
  return typeof j?.geoRegion === 'string' ? j.geoRegion.trim() : '';
}

/**
 * Extract {min, max, currency} from the API's flat salaryMin/salaryMax/
 * salaryCurrency fields, omitting a bound the API left null (never coerced
 * to 0 — a 0 min/max would read as real comp data downstream). Returns null
 * when neither bound is present. Exported for tests.
 * @param {any} j
 */
export function normalizeAgenticSalary(j) {
  const hasMin = typeof j?.salaryMin === 'number' && Number.isFinite(j.salaryMin);
  const hasMax = typeof j?.salaryMax === 'number' && Number.isFinite(j.salaryMax);
  if (!hasMin && !hasMax) return null;
  /** @type {{min?: number, max?: number, currency?: string}} */
  const salary = {};
  if (hasMin) salary.min = j.salaryMin;
  if (hasMax) salary.max = j.salaryMax;
  const currency = typeof j?.salaryCurrency === 'string' ? j.salaryCurrency.trim().toUpperCase() : '';
  if (currency) salary.currency = currency;
  return salary;
}

/**
 * Normalize one API job record into the shared Job shape, or null when a
 * required field is missing/unsafe. Exported for tests.
 * @param {any} j
 */
export function normalizeAgenticJob(j) {
  if (!j || typeof j !== 'object') return null;
  const title = typeof j.title === 'string' ? j.title.trim() : '';
  const company = typeof j.companyName === 'string' ? j.companyName.trim() : '';
  const slug = typeof j.slug === 'string' ? j.slug.trim() : '';
  // Slug feeds straight into a URL path — keep it to safe path characters.
  if (!title || !company || !slug || !/^[A-Za-z0-9_-]+$/.test(slug)) return null;

  /** @type {{title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: {min?: number, max?: number, currency?: string}}} */
  const job = {
    title,
    url: `${SITE_ORIGIN}/jobs/${slug}`,
    company,
    location: normalizeAgenticLocation(j),
  };

  const description = stripHtml(j.description);
  if (description) job.description = description;

  const posted = typeof j.postedAt === 'string' ? Date.parse(j.postedAt) : NaN;
  if (Number.isFinite(posted)) job.postedAt = posted;

  const salary = normalizeAgenticSalary(j);
  if (salary) job.salary = salary;

  return job;
}

/** @type {Provider} */
export default {
  id: 'agentic-jobs',

  detect(entry) {
    return entry?.provider === 'agentic-jobs' ? { url: SITE_ORIGIN } : null;
  },

  async fetch(_entry, ctx) {
    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const jobs = [];
    const seen = new Set();
    let total = null;

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) await wait(PAGE_DELAY_MS);
      const url = assertAgenticUrl(`${API_BASE}/jobs?page=${page}`);
      const json = await ctx.fetchJson(url, { redirect: 'error', headers: { accept: 'application/json' } });
      // A missing/non-array `data` is a response-shape change, not a legitimate
      // empty page (the API returns `data: []` for that) — fail loudly instead
      // of silently truncating whatever pages were already collected.
      if (!json || !Array.isArray(json.data)) {
        throw new Error(`agentic-jobs: unexpected API response shape on page ${page} — "data" is missing or not an array`);
      }
      const records = json.data;
      if (total === null) total = typeof json.meta?.total === 'number' ? json.meta.total : null;
      // Trust the API's own reported page size over our constant, in case it
      // ever differs from the documented default.
      const effectivePageSize = typeof json.meta?.per_page === 'number' && json.meta.per_page > 0 ? json.meta.per_page : PAGE_SIZE;

      for (const record of records) {
        const job = normalizeAgenticJob(record);
        if (job && !seen.has(job.url)) {
          seen.add(job.url);
          jobs.push(job);
        }
      }

      if (jobs.length >= MAX_JOBS) break;
      if (records.length < effectivePageSize) break; // short page — last one
      if (total !== null && page * effectivePageSize >= total) break;
    }

    if (jobs.length === 0) {
      throw new Error('agentic-jobs: parsed 0 jobs from the API — the response shape likely changed');
    }
    return jobs.slice(0, MAX_JOBS);
  },
};
