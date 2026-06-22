// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jobstreet / SEEK provider — hits the public chalice-search JSON API.
// Jobstreet (jobstreet.com, jobstreet.co.id, etc.) and SEEK (seek.com.au,
// seek.co.nz) share the same SEEK infrastructure and expose a public,
// no-auth JSON search endpoint at /api/chalice-search/v4/search.
//
// This provider is designed for explicit `provider: jobstreet` in
// portals.yml. Auto-detection from careers_url is not supported because
// Jobstreet is a job board aggregator, not a company ATS — setting
// `provider: jobstreet` on a tracked_companies entry is the intended usage.
//
// Portal entry fields (all optional except `provider`):
//   api             — Base search URL (default: https://id.jobstreet.com/api/chalice-search/v4/search)
//   siteKey         — SEEK site key (default: "ID-Main" for Indonesia)
//   searchKeywords  — Search keywords, space-separated (default: reads from title_filter via keywords parameter)
//   searchLocation  — Location filter string (default: none)
//   pageSize        — Results per page (default: 30, max observed: 100)
//   maxPages        — Maximum pages to fetch (default: 3, set to 1 for speed)
//   countryCode     — Two-letter country code for building job detail URLs (default: "id")

const DEFAULT_API = 'https://id.jobstreet.com/api/chalice-search/v4/search';
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
 * Derive the job detail base URL from the API hostname.
 * e.g. id.jobstreet.com → https://id.jobstreet.com
 * @param {string} apiUrl
 * @returns {string}
 */
function deriveBaseUrl(apiUrl) {
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
 * Parse a single Jobstreet/SEEK API result into the canonical Job shape.
 * The SEEK chalice-search API returns objects like:
 *   {
 *     id: 123456,
 *     title: "Senior Data Scientist",
 *     teaser: "...",
 *     bulletText: [...],
 *     branding: { companyName: "Tech Corp" },
 *     location: "Jakarta Selatan",
 *     listingDate: "2026-06-15T00:00:00Z",
 *     salary: "Rp 15.000.000 - 25.000.000 per month",
 *     jobUrl: "/id/job/123456",
 *     ...
 *   }
 *
 * This parser is exported as a named export for unit tests.
 *
 * @param {any} item — raw API result item
 * @param {string} baseUrl — scheme + hostname for resolving relative job URLs
 * @param {string} fallbackCompany — company name fallback from the portal entry
 * @returns {{title: string, url: string, company: string, location: string, postedAt: number|undefined}|null}
 */
export function parseJobstreetItem(item, baseUrl, fallbackCompany) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.title || '').trim();
  if (!title) return null;

  // Resolve job URL — can be relative (/id/job/123) or absolute
  let url = '';
  const rawUrl = item.jobUrl || '';
  if (rawUrl) {
    try {
      // Try absolute first
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        url = parsed.href;
      }
    } catch {
      // Relative URL — prepend base
      if (rawUrl.startsWith('/')) {
        url = `${baseUrl}${rawUrl}`;
      }
    }
  }
  if (!url) return null;

  // Validate URL hostname belongs to allowed set
  try {
    const parsed = new URL(url);
    if (!ALLOWED_JOBSTREET_HOSTS.has(parsed.hostname)) return null;
    url = parsed.href;
  } catch {
    return null;
  }

  const company = (item.branding?.companyName || item.companyName || item.advertiser?.description || fallbackCompany || '').trim();
  const location = (item.location || '').trim();
  const postedAt = toEpochMs(item.listingDate);

  return { title, url, company, location, ...(postedAt != null ? { postedAt } : {}) };
}

/**
 * Build the search URL with query parameters.
 * @param {string} apiUrl
 * @param {object} params
 * @returns {string}
 */
function buildSearchUrl(apiUrl, params) {
  const url = new URL(apiUrl);
  const { siteKey, keywords, location, pageSize, page } = params;
  if (siteKey) url.searchParams.set('siteKey', siteKey);
  if (keywords) url.searchParams.set('keywords', keywords);
  if (location) url.searchParams.set('where', location);
  url.searchParams.set('pageSize', String(pageSize || DEFAULT_PAGE_SIZE));
  url.searchParams.set('page', String(page || 1));
  // Request Solr fields relevant for job listings — narrower than the default
  // response which includes full ad body. Keeps payloads small.
  url.searchParams.set('solrFields', 'id,title,location,listingDate,jobUrl,companyName,branding.companyName,advertiser.description,salary');
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
    const baseUrl = deriveBaseUrl(apiUrl);

    const siteKey = entry.siteKey || DEFAULT_SITE_KEY;
    const keywords = entry.searchKeywords || '';
    const searchLocation = entry.searchLocation || '';
    const pageSize = Number(entry.pageSize) || DEFAULT_PAGE_SIZE;
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;
    const fallbackCompany = entry.name || '';

    const allJobs = [];

    for (let page = 1; page <= maxPages; page++) {
      const searchUrl = buildSearchUrl(apiUrl, {
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
        const job = parseJobstreetItem(item, baseUrl, fallbackCompany);
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
