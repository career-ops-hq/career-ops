/** Collect glints postings using the shared profile search terms. */
// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { providerKeywords } from './_profile-keywords.mjs';
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
  const jobId = (item.id || '').trim();
  if (!jobId) return null;
  const url = `${baseUrl}/id/opportunities/jobs/${jobId}`;
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
    return null;
  },

  async fetch(entry, ctx) {
    const apiUrl = entry.api || DEFAULT_API;
    assertGlintsUrl(apiUrl);
    const baseUrl = deriveBaseUrl(apiUrl);

    const query = entry.graphqlQuery || DEFAULT_GRAPHQL_QUERY;
    const country = entry.countryCode || DEFAULT_COUNTRY;
    const pageSize = Number(entry.pageSize) || DEFAULT_PAGE_SIZE;
    const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;
    const fallbackCompany = entry.name || '';

    const allJobs = [];

    for (const keywords of providerKeywords(ctx)) {
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
        if (json?.data?.searchJobsV3?.hasMore === false) break;
        if (jobsInPage.length < pageSize) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      }

    }
    return [...new Map(allJobs.map(job => [job.url, job])).values()];
  },
};
