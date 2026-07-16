// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jobstreet / SEEK provider — hits the public SEEK v5 JobSearch REST API.
//
// Jobstreet (jobstreet.com, jobstreet.co.id, etc.) and SEEK (seek.com.au,
// seek.co.nz) share the same SEEK infrastructure. The old chalice-search
// v4 API (/api/chalice-search/v4/search) was deprecated; the v5 API at
// /api/jobsearch/v5/search is the current replacement.
//
// This provider is designed for explicit `provider: jobstreet` in portals.yml.
// Auto-detection from careers_url is not supported because Jobstreet is a
// job board aggregator, not a company ATS.
//
// Portal entry fields (all optional except `provider`):
//   api             — v5 search endpoint URL (default: https://id.jobstreet.com/api/jobsearch/v5/search)
//   siteKey         — SEEK site key for regional filtering (default: "ID-Main")
//   searchKeywords  — Search keywords, space-separated (default: "")
//   searchLocation  — Location filter (default: "")
//   pageSize        — Results per page (default: 30)
//   maxPages        — Maximum pages to fetch (default: 3)
//
// Site keys by market:
//   ID-Main  → id.jobstreet.com (Indonesia)
//   SG-Main  → sg.jobstreet.com (Singapore)
//   MY-Main  → my.jobstreet.com (Malaysia)

const DEFAULT_API = 'https://id.jobstreet.com/api/jobsearch/v5/search';
const DEFAULT_SITE_KEY = 'ID-Main';
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MAX_PAGES = 3;

const ALLOWED_JOBSTREET_HOSTS = new Set([
  'id.jobstreet.com',
  'www.jobstreet.com',
  'www.jobstreet.co.id',
  'jobstreet.com',
  'jobstreet.co.id',
  'sg.jobstreet.com',
  'my.jobstreet.com',
  'www.seek.com.au',
  'www.seek.co.nz',
]);

// v5 API paths (the client-side JS on jobstreet uses these relative paths
// resolved against the current origin). We keep the allowlist for SSRF
// protection on the base URL, then build the v5 search path from it.
const V5_SEARCH_PATH = '/api/jobsearch/v5/search';

/** @param {string} url */
function assertJobstreetUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobstreet: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`jobstreet: URL must use HTTPS: ${url}`);
  if (!ALLOWED_JOBSTREET_HOSTS.has(parsed.hostname))
    throw new Error(`jobstreet: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_JOBSTREET_HOSTS].join(', ')}`);
  return url;
}

/**
 * Derive the origin from the API hostname.
 * e.g. id.jobstreet.com → https://id.jobstreet.com
 * @param {string} apiUrl
 * @returns {string}
 */
function deriveOrigin(apiUrl) {
  try {
    const parsed = new URL(apiUrl);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return 'https://id.jobstreet.com';
  }
}

// NaN-safe Date.parse
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse a single Jobstreet/SEEK v5 search API result into the canonical Job shape.
 *
 * The v5 search API returns objects shaped like:
 *   {
 *     id: "92996157",
 *     title: "Facility Engineer",
 *     advertiser: { id: "60960115", description: "PT YOFC International Indonesia" },
 *     companyName: "YOFC International",
 *     locations: [{ label: "Karawang, West Java", countryCode: "ID", ... }],
 *     listingDate: "2026-06-29T02:53:00Z",
 *     listingDateDisplay: "16h ago",
 *     roleId: "facilities-engineer",
 *     salaryLabel: "",
 *     teaser: "...",
 *     workTypes: ["Full time"],
 *     workArrangements: { data: [{ id: "1", label: { text: "On-site" } }] },
 *     ...
 *   }
 *
 * This parser is exported as a named export for unit tests.
 *
 * @param {any} item — raw v5 API result item
 * @param {string} origin — scheme + hostname for building job detail URLs
 * @param {string} fallbackCompany — company name fallback from the portal entry
 * @returns {{title: string, url: string, company: string, location: string, postedAt: number|undefined}|null}
 */
export function parseJobstreetItem(item, origin, fallbackCompany) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.title || '').trim();
  if (!title) return null;

  // Build job URL from the job ID
  const jobId = (item.id || '').trim();
  if (!jobId) return null;
  const url = `${origin}/id/job/${jobId}`;

  // Validate URL hostname belongs to allowed set
  try {
    const parsed = new URL(url);
    if (!ALLOWED_JOBSTREET_HOSTS.has(parsed.hostname)) return null;
  } catch {
    return null;
  }

  // Prefer advertiser.description for the branded company name, fall back
  // to companyName (which can be shorter/less specific), then entry name.
  const company = (item.advertiser?.description || item.companyName || fallbackCompany || '').trim();
  const location = (item.locations?.[0]?.label || '').trim();
  const postedAt = toEpochMs(item.listingDate);

  return { title, url, company, location, ...(postedAt != null ? { postedAt } : {}) };
}

/**
 * Build the v5 search URL with query parameters.
 * @param {string} origin — scheme + hostname
 * @param {object} params
 * @returns {string}
 */
function buildSearchUrl(origin, params) {
  const url = new URL(V5_SEARCH_PATH, origin);
  const { siteKey, keywords, location, pageSize, page } = params;
  if (siteKey) url.searchParams.set('siteKey', siteKey);
  if (keywords) url.searchParams.set('keywords', keywords);
  if (location) url.searchParams.set('where', location);
  url.searchParams.set('pageSize', String(pageSize || DEFAULT_PAGE_SIZE));
  url.searchParams.set('page', String(page || 1));
  return url.href;
}

/** @type {Provider} */
export default {
  id: 'jobstreet',

  detect(_entry) {
    // Jobstreet is a job board aggregator, not a company ATS.
    // Auto-detection from careers_url is intentionally not supported —
    // use `provider: jobstreet` explicitly in portals.yml.
    return null;
  },

  async fetch(entry, ctx) {
    const apiUrl = entry.api || DEFAULT_API;
    assertJobstreetUrl(apiUrl);
    const origin = deriveOrigin(apiUrl);

    const siteKey = entry.siteKey || DEFAULT_SITE_KEY;
    const keywords = entry.searchKeywords || '';
    const searchLocation = entry.searchLocation || '';
    const pageSize = Number(entry.pageSize) || DEFAULT_PAGE_SIZE;
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;
    const fallbackCompany = entry.name || '';

    const allJobs = [];

    for (let page = 1; page <= maxPages; page++) {
      const searchUrl = buildSearchUrl(origin, {
        siteKey,
        keywords,
        location: searchLocation,
        pageSize,
        page,
      });

      let json;
      try {
        json = /** @type {any} */ (await ctx.fetchJson(searchUrl, { redirect: 'error' }));
      } catch (err) {
        // If page 1 fails, surface the error. Later pages failing is non-fatal
        // — we return whatever we've collected so far.
        if (page === 1) throw err;
        console.error(`jobstreet: page ${page} fetch failed — ${err.message}`);
        break;
      }

      const data = Array.isArray(json?.data) ? json.data : [];
      if (data.length === 0) break;

      for (const item of data) {
        const job = parseJobstreetItem(item, origin, fallbackCompany);
        if (job) allJobs.push(job);
      }

      // Stop if we got fewer results than pageSize (last page)
      if (data.length < pageSize) break;

      // Respect rate limits — small delay between pages
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return allJobs;
  },
};
