// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Glints provider — hits the public GraphQL v2-alc endpoint.
//
// Glints (glints.com) covers Singapore, Indonesia, Malaysia, and Vietnam.
// Their internal API is a no-auth GraphQL endpoint at /api/v2-alc/graphql that
// powers the job search page. The schema is reverse-engineered and may change.
//
// This provider is designed for explicit `provider: glints` in portals.yml.
// Auto-detection is not supported — Glints is a job board aggregator, not
// a company ATS.
//
// Portal entry fields (all optional except `provider`):
//   api             — GraphQL endpoint URL (default: https://glints.com/api/v2-alc/graphql)
//   searchKeywords  — Search keywords string (default: '')
//   countryCode     — Two-letter country code (default: "ID" for Indonesia)
//   pageSize        — Results per page (default: 30)
//   maxPages        — Maximum pages (default: 3)
//   graphqlQuery    — Custom GraphQL query string. If not provided, the
//                     built-in default query is used.

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const DEFAULT_API = 'https://glints.com/api/v2-alc/graphql';
const DEFAULT_COUNTRY = 'ID';
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MAX_PAGES = 3;

const ALLOWED_GLINTS_HOSTS = new Set([
  'glints.com',
  'www.glints.com',
  'glints.id',
]);

// Default GraphQL query — reverse-engineered from glints.com/id search.
// Uses the searchJobsV3 operation which replaced the older opportunities query.
const DEFAULT_GRAPHQL_QUERY = `
query searchJobsV3($data: JobSearchConditionInput!) {
  searchJobsV3(data: $data) {
    jobsInPage {
      id
      title
      company {
        name
        brandName
      }
      city {
        name
      }
      country {
        code
        name
      }
      salaries {
        salaryType
        salaryMode
        maxAmount
        minAmount
        CurrencyCode
      }
      createdAt
    }
    expInfo
    hasMore
  }
}`;

/** @param {string} url */
function assertGlintsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`glints: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`glints: URL must use HTTPS: ${url}`);
  if (!ALLOWED_GLINTS_HOSTS.has(parsed.hostname))
    throw new Error(`glints: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_GLINTS_HOSTS].join(', ')}`);
  return url;
}

// NaN-safe Date.parse
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Derive the job detail base URL from the API hostname.
 * @param {string} apiUrl
 * @returns {string}
 */
function deriveBaseUrl(apiUrl) {
  try {
    const parsed = new URL(apiUrl);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return 'https://glints.com';
  }
}

/**
 * Parse a single Glints job (searchJobsV3 response) into the canonical Job shape.
 *
 * This parser is exported as a named export for unit tests.
 *
 * @param {any} item — raw GraphQL result item from searchJobsV3
 * @param {string} baseUrl — scheme + hostname for resolving relative URLs
 * @param {string} fallbackCompany — company name fallback from portal entry
 * @returns {{title: string, url: string, company: string, location: string, postedAt: number|undefined}|null}
 */
export function parseGlintsItem(item, baseUrl, fallbackCompany) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.title || '').trim();
  if (!title) return null;

  // Build job URL from the job ID
  const jobId = (item.id || '').trim();
  if (!jobId) return null;
  const url = `${baseUrl}/id/opportunities/jobs/${jobId}`;

  // Validate URL hostname
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const allowed = ALLOWED_GLINTS_HOSTS.has(hostname) || hostname.endsWith('.glints.com');
    if (!allowed) return null;
  } catch {
    return null;
  }

  const company = (item.company?.name || item.company?.brandName || fallbackCompany || '').trim();
  const location = (item.city?.name || '').trim();
  const postedAt = toEpochMs(item.createdAt);

  return { title, url, company, location, ...(postedAt != null ? { postedAt } : {}) };
}

/**
 * Execute a single GraphQL query page.
 * @param {string} apiUrl
 * @param {string} query
 * @param {object} variables
 * @param {import('./_types.js').Context} ctx
 * @returns {Promise<any>}
 */
async function graphqlPage(apiUrl, query, variables, ctx) {
  const body = JSON.stringify({ operationName: 'searchJobsV3', query, variables });
  // Glints firewall blocks non-browser User-Agents, so use a real Chrome UA
  try {
    const res = await ctx.fetchJson(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': BROWSER_LIKE_USER_AGENT,
        'origin': 'https://glints.com',
        'referer': 'https://glints.com/id/opportunities/jobs/explore',
      },
      body,
      redirect: 'error',
    });
    return res;
  } catch (err) {
    // On POST, some servers return non-JSON errors; attempt text fallback
    if (err.status && err.body) {
      let detail = '';
      try {
        const parsed = JSON.parse(err.body);
        detail = parsed.errors?.[0]?.message || err.body.slice(0, 200);
      } catch {
        detail = err.body.slice(0, 200);
      }
      throw new Error(`glints: HTTP ${err.status} — ${detail}`);
    }
    throw err;
  }
}

/** @type {Provider} */
export default {
  id: 'glints',

  detect(_entry) {
    // Glints is a job board aggregator, not a company ATS.
    // Auto-detection is intentionally not supported —
    // use `provider: glints` explicitly in portals.yml.
    return null;
  },

  async fetch(entry, ctx) {
    const apiUrl = entry.api || DEFAULT_API;
    assertGlintsUrl(apiUrl);
    const baseUrl = deriveBaseUrl(apiUrl);

    const query = entry.graphqlQuery || DEFAULT_GRAPHQL_QUERY;
    const keywords = entry.searchKeywords || '';
    const country = entry.countryCode || DEFAULT_COUNTRY;
    const pageSize = Number(entry.pageSize) || DEFAULT_PAGE_SIZE;
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;
    const fallbackCompany = entry.name || '';

    const allJobs = [];

    for (let page = 1; page <= maxPages; page++) {
      const variables = {
        data: {
          SearchTerm: keywords,
          CountryCode: country,
          includeExternalJobs: true,
          pageSize: pageSize,
          page: page,
        },
      };

      let json;
      try {
        json = /** @type {any} */ (await graphqlPage(apiUrl, query, variables, ctx));
      } catch (err) {
        if (page === 1) throw err;
        console.error(`glints: page ${page} fetch failed — ${err.message}`);
        break;
      }

      const jobsInPage = json?.data?.searchJobsV3?.jobsInPage;
      if (!Array.isArray(jobsInPage)) {
        if (page === 1) throw new Error(`glints: unexpected API response — ${JSON.stringify(json).slice(0, 200)}`);
        break;
      }

      if (jobsInPage.length === 0) break;

      for (const item of jobsInPage) {
        const job = parseGlintsItem(item, baseUrl, fallbackCompany);
        if (job) allJobs.push(job);
      }

      // Stop if no more pages
      if (json?.data?.searchJobsV3?.hasMore === false) break;
      if (jobsInPage.length < pageSize) break;

      // Rate-limit courtesy delay
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    return allJobs;
  },
};
