// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Glints provider — hits the undocumented public GraphQL endpoint.
//
// Glints (glints.com) covers Singapore, Indonesia, Malaysia, and Vietnam.
// Their internal API is a no-auth GraphQL endpoint at /api/graphql that
// powers the job search page. The schema is not officially documented, so
// the GraphQL query is configurable via the portal entry.
//
// This provider is designed for explicit `provider: glints` in portals.yml.
// Auto-detection is not supported — Glints is a job board aggregator, not
// a company ATS.
//
// Portal entry fields (all optional except `provider`):
//   api             — GraphQL endpoint URL (default: https://glints.com/api/graphql)
//   searchKeywords  — Search keywords string (default: '')
//   countryCode     — Two-letter country code (default: "ID" for Indonesia)
//   pageSize        — Results per page (default: 30)
//   maxPages        — Maximum pages via offset-based pagination (default: 3)
//   graphqlQuery    — Custom GraphQL query string. If not provided, the
//                     built-in default query is used. The query MUST accept
//                     $keywords (String!), $country (String!), $limit (Int!),
//                     $offset (Int!) as variables and return results that
//                     the parser can map.

const DEFAULT_API = 'https://glints.com/api/graphql';
const DEFAULT_COUNTRY = 'ID';
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_MAX_PAGES = 3;

const ALLOWED_GLINTS_HOSTS = new Set([
  'glints.com',
  'www.glints.com',
  'glints.id',
]);

// Default GraphQL query — based on reverse-engineered schema.
// Field names are best-guess; adjust via `graphqlQuery` in your portal entry
// if the schema changes or differs by region.
const DEFAULT_GRAPHQL_QUERY = `
query SearchJobs($keywords: String!, $country: String!, $limit: Int!, $offset: Int!) {
  opportunities(
    filters: { keywords: $keywords, countryCode: $country }
    first: $limit
    offset: $offset
  ) {
    data {
      id
      title
      company {
        name
      }
      location
      salary {
        min
        max
        currency
      }
      postedAt
      url
    }
    totalCount
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
 * Parse a single Glints opportunity into the canonical Job shape.
 *
 * This parser is exported as a named export for unit tests.
 *
 * @param {any} item — raw GraphQL result item
 * @param {string} baseUrl — scheme + hostname for resolving relative URLs
 * @param {string} fallbackCompany — company name fallback from portal entry
 * @returns {{title: string, url: string, company: string, location: string, postedAt: number|undefined}|null}
 */
export function parseGlintsItem(item, baseUrl, fallbackCompany) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.title || '').trim();
  if (!title) return null;

  // Resolve job URL
  let url = (item.url || '').trim();
  if (url) {
    try {
      // Try absolute URL first
      const parsed = new URL(url);
      url = parsed.href;
    } catch {
      // Relative URL — prepend base
      if (url.startsWith('/')) {
        url = `${baseUrl}${url}`;
      }
    }
  }
  if (!url) return null;

  // Validate URL hostname — allow glints.com, its subdomains, and glints.id
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const allowed = ALLOWED_GLINTS_HOSTS.has(hostname) || hostname.endsWith('.glints.com');
    if (!allowed) return null;
    url = parsed.href;
  } catch {
    return null;
  }

  const company = (item.company?.name || fallbackCompany || '').trim();
  const location = (item.location || '').trim();
  const postedAt = toEpochMs(item.postedAt);

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
  const body = JSON.stringify({ query, variables });
  // _http.mjs's fetchWithTimeout passes method, headers, and body through
  // to the underlying fetch() call, so POST + JSON body works transparently.
  try {
    const res = await ctx.fetchJson(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    let totalCount = null; // API may tell us when to stop

    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;
      const variables = { keywords, country, limit: pageSize, offset };

      let json;
      try {
        json = /** @type {any} */ (await graphqlPage(apiUrl, query, variables, ctx));
      } catch (err) {
        if (page === 0) throw err;
        console.error(`glints: page ${page} fetch failed — ${err.message}`);
        break;
      }

      // Handle both GraphQL response shapes:
      //   { data: { opportunities: { data: [...], totalCount: N } } }
      //   { data: { opportunities: [...] }
      const opportunities = json?.data?.opportunities;
      if (!opportunities) {
        if (page === 0) throw new Error(`glints: unexpected API response — ${JSON.stringify(json).slice(0, 200)}`);
        break;
      }

      const data = Array.isArray(opportunities) ? opportunities : (Array.isArray(opportunities.data) ? opportunities.data : []);
      if (typeof opportunities.totalCount === 'number') totalCount = opportunities.totalCount;

      if (data.length === 0) break;

      for (const item of data) {
        const job = parseGlintsItem(item, baseUrl, fallbackCompany);
        if (job) allJobs.push(job);
      }

      // Stop conditions
      if (totalCount != null && allJobs.length >= totalCount) break;
      if (data.length < pageSize) break;

      // Rate-limit courtesy delay
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    return allJobs;
  },
};
