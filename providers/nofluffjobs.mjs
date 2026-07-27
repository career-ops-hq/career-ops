// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// NoFluffJobs provider — hits the public search posting API.
// It intentionally returns only the core scanner job fields; richer skill and
// salary metadata can be added later if the provider contract is expanded.

const ALLOWED_HOSTS = new Set(['nofluffjobs.com']);
const API_URL = 'https://nofluffjobs.com/api/search/posting';
const JOB_BASE = 'https://nofluffjobs.com/pl/job/';
const PAGE_SIZE = 20;
const MAX_PAGES = 5;

function assertNoFluffUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`nofluffjobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`nofluffjobs: URL must use HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`nofluffjobs: untrusted hostname "${parsed.hostname}" — must be nofluffjobs.com`);
  }
  return parsed;
}

function detectUrl(entry) {
  const url = entry.api || entry.careers_url || '';
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    return { url: assertNoFluffUrl(url).href };
  } catch {
    return null;
  }
}

function normalizeLocation(posting) {
  const parts = [];
  if (posting?.fullyRemote || posting?.location?.fullyRemote) parts.push('Remote');
  if (Array.isArray(posting?.location?.places)) {
    for (const place of posting.location.places) {
      const city = String(place?.city || '').trim();
      const province = String(place?.province || '').trim();
      const country = String(place?.country?.name || '').trim();
      if (city) parts.push(city);
      else if (province) parts.push(province);
      else if (country) parts.push(country);
    }
  }
  return [...new Set(parts.filter(Boolean))].join(', ');
}

function postedAtMillis(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function buildRequest(entry, pageTo) {
  const apiUrl = assertNoFluffUrl(entry.api || API_URL);
  apiUrl.pathname = '/api/search/posting';
  apiUrl.search = '';
  apiUrl.searchParams.set('sort', 'newest');
  apiUrl.searchParams.set('withSalaryMatch', 'true');
  apiUrl.searchParams.set('pageTo', String(pageTo));
  apiUrl.searchParams.set('pageSize', String(Number(entry.page_size || PAGE_SIZE)));
  apiUrl.searchParams.set('salaryCurrency', String(entry.currency || 'PLN').toUpperCase());
  apiUrl.searchParams.set('salaryPeriod', String(entry.salary_period || 'month'));
  apiUrl.searchParams.set('region', String(entry.region || 'pl'));
  apiUrl.searchParams.set('language', String(entry.language || 'pl-PL'));

  const rawSearch = String(entry.search || entry.raw_search || '').trim();
  const body = rawSearch
    ? {
        criteria: '',
        url: { searchParam: rawSearch },
        rawSearch,
        pageSize: Number(entry.page_size || PAGE_SIZE),
        withSalaryMatch: true,
      }
    : {
        criteriaSearch: {
          country: [],
          withSalaryMatch: [],
          city: [],
          more: [],
          employment: [],
          requirement: [],
          salary: [],
          jobPosition: [],
          applicationStatus: [],
          province: [],
          company: [],
          id: [],
          category: [],
          keyword: [],
          jobLanguage: [],
          seniority: [],
        },
        pageSize: Number(entry.page_size || PAGE_SIZE),
        withSalaryMatch: true,
      };

  return { url: apiUrl.href, body };
}

export function parseNoFluffJobsResponse(json) {
  if (!json || !Array.isArray(json.postings)) {
    throw new Error(`nofluffjobs: unexpected API response — expected { postings: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
  }
  return json.postings
    .filter(posting => posting && typeof posting === 'object')
    .map(posting => {
      const title = String(posting.title || '').trim();
      const company = String(posting.name || '').trim();
      const slug = String(posting.url || posting.id || '').trim();
      if (!title || !slug) return null;
      return {
        title,
        url: `${JOB_BASE}${slug}`,
        company,
        location: normalizeLocation(posting),
        postedAt: postedAtMillis(posting.posted),
      };
    })
    .filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'nofluffjobs',

  detect(entry) {
    return detectUrl(entry);
  },

  async fetch(entry, ctx) {
    if (!detectUrl(entry)) throw new Error('nofluffjobs: careers_url or api must be a trusted nofluffjobs.com URL');

    const maxPages = Number(entry.max_pages || MAX_PAGES);
    const jobs = [];
    const seen = new Set();

    for (let pageTo = 1; pageTo <= maxPages; pageTo++) {
      const { url, body } = buildRequest(entry, pageTo);
      const json = await ctx.fetchJson(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/infiniteSearch+json',
        },
        redirect: 'error',
      });
      for (const job of parseNoFluffJobsResponse(json)) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      const totalPages = Number(json?.totalPages || 0);
      if (totalPages && pageTo >= totalPages) break;
      if (json.postings.length === 0) break;
    }

    return jobs;
  },
};
