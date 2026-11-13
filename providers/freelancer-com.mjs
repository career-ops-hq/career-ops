// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Freelancer.com provider: a freelance project marketplace (many clients), so
// it goes in the `job_boards:` list of portals.yml.
//
// Reads Freelancer.com's public, unauthenticated REST API (the documented
// projects/0.1 "active projects" search, https://developers.freelancer.com),
// one keyword search per entry in `queries`, `limit=100` per page with an
// `offset` walk. robots.txt (checked 2026-10-28) disallows `/jobs/?*`,
// `/ajax/` and a handful of legacy project paths under `User-agent: *`, none of
// which this provider requests; `/api/` is not disallowed.
//
// A Freelancer.com project is gig work: the client is an anonymous account, so
// `company` is the fixed label "Freelancer.com client", and every posting's
// description starts with "Engagement: freelance". The budget and currency in
// the description are the client's own figures from the API, never derived.
// A project with `local: false` is an online project the API marks as not tied
// to a place, so its location is "Remote"; a local project carries the city and
// country the API gives, or nothing.
//
// Bidding on a project needs a free Freelancer.com account (free accounts get
// a limited number of bids per month); reading the listings does not.
//
//   job_boards:
//     - name: Freelancer.com — AI projects
//       provider: freelancer-com
//       queries: ["machine learning", "LLM", "AI agent"]  # optional; default: one
//                                                       #   unfiltered pass (newest
//                                                       #   active projects)
//       max_pages: 3         # pages of 100 per query (default 3, cap 20)
//       enabled: true

const API_URL = 'https://www.freelancer.com/api/projects/0.1/projects/active/';
const SITE_ORIGIN = 'https://www.freelancer.com';
// The API clamps `limit` to 100 (limit=200 answered 100 rows, 2026-10-28).
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 20;
const MAX_QUERIES = 20;
const INTER_PAGE_DELAY_MS = 250;
const COMPANY_LABEL = 'Freelancer.com client';
const PREVIEW_CHARS = 400;

/**
 * The entry's search keywords: trimmed, de-duplicated, at most MAX_QUERIES.
 * No usable keyword means one unfiltered pass (`''`).
 * @param {any} entry
 * @returns {string[]}
 */
export function parseQueries(entry) {
  const raw = Array.isArray(entry?.queries) ? entry.queries : [];
  const list = [...new Set(raw.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim()))];
  return list.length ? list.slice(0, MAX_QUERIES) : [''];
}

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @param {string} query @param {number} offset */
export function buildSearchUrl(query, offset) {
  const params = new URLSearchParams({
    compact: 'true',
    job_details: 'true',
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (query) params.set('query', query);
  return `${API_URL}?${params.toString()}`;
}

/**
 * `seo_url` ("python/Build-a-scraper") → the public project page. Each path
 * segment is a host-controlled value, so it goes through
 * safeEncodeURIComponent; any bad or empty segment drops the posting.
 * @param {any} seoUrl
 * @returns {string | null}
 */
function projectUrl(seoUrl) {
  if (typeof seoUrl !== 'string' || !seoUrl.trim()) return null;
  const segments = seoUrl.trim().split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) return null;
  const encoded = segments.map((s) => safeEncodeURIComponent(s));
  if (encoded.some((s) => s === null)) return null;
  return `${SITE_ORIGIN}/projects/${encoded.join('/')}`;
}

/** @param {any} v */
const str = (v) => (typeof v === 'string' ? v.trim() : '');
/** @param {any} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** @param {any} p */
function buildLocation(p) {
  if (p.local === false) return 'Remote';
  const loc = p.location && typeof p.location === 'object' ? p.location : {};
  const country = loc.country && typeof loc.country === 'object' ? str(loc.country.name) : '';
  return [str(loc.city), country].filter(Boolean).join(', ');
}

/** @param {any} p */
function buildDescription(p) {
  const parts = ['Engagement: freelance'];
  if (p.type === 'hourly') parts.push('Project type: hourly');
  else if (p.type === 'fixed') parts.push('Project type: fixed price');
  if (p.upgrades && p.upgrades.fulltime === true) parts.push('Full-time: yes');
  const min = num(p.budget?.minimum);
  const max = num(p.budget?.maximum);
  const currency = str(p.currency?.code);
  if (min !== null || max !== null) {
    const range = min !== null && max !== null && max !== min ? `${min}–${max}` : String(min ?? max);
    parts.push(`Budget: ${range}${currency ? ` ${currency}` : ''}${p.type === 'hourly' ? ' per hour' : ''}`);
  }
  const skills = Array.isArray(p.jobs) ? p.jobs.map((j) => str(j?.name)).filter(Boolean) : [];
  if (skills.length) parts.push(`Skills: ${skills.join(', ')}`);
  let text = parts.join(' · ');
  const preview = str(p.preview_description);
  if (preview) text += `\n\n${preview.slice(0, PREVIEW_CHARS)}`;
  return text;
}

/**
 * Parses one projects/active API response. Exported for unit tests.
 *
 * Envelope: `{ status: 'success', result: { projects: [...], total_count } }`.
 * Anything else (an error body, a missing or non-array `projects`) throws; an
 * empty `projects` array is an empty result. Deleted, non-public, title-less
 * or URL-less rows are dropped.
 *
 * @param {any} json
 * @returns {{ jobs: Array<{title: string, url: string, company: string, location: string, description: string, postedAt?: number, language?: string}>, rawCount: number, total: number | null }}
 */
export function parseFreelancerProjects(json) {
  const projects = json && json.status === 'success' && json.result && Array.isArray(json.result.projects)
    ? json.result.projects
    : null;
  if (!projects) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    const detail = json && typeof json === 'object' && typeof json.message === 'string' ? ` (${json.message})` : '';
    throw new Error(`freelancer-com: unexpected response — expected {status:'success', result.projects[]}, got: [${got}]${detail}`);
  }
  const jobs = [];
  for (const p of projects) {
    if (!p || typeof p !== 'object') continue;
    if (p.deleted === true || p.nonpublic === true) continue;
    const title = str(p.title);
    if (!title) continue;
    const url = projectUrl(p.seo_url);
    if (!url) continue;
    /** @type {{title: string, url: string, company: string, location: string, description: string, postedAt?: number, language?: string}} */
    const job = {
      title,
      url,
      company: COMPANY_LABEL,
      location: buildLocation(p),
      description: buildDescription(p),
    };
    const submitted = num(p.time_submitted);
    if (submitted !== null && submitted > 0) job.postedAt = submitted * 1000;
    const language = str(p.language);
    if (language) job.language = language;
    jobs.push(job);
  }
  const total = num(json.result.total_count);
  return { jobs, rawCount: projects.length, total };
}

/** @type {Provider} */
export default {
  id: 'freelancer-com',

  detect(entry) {
    return entry?.provider === 'freelancer-com' ? { url: API_URL } : null;
  },

  async fetch(entry, ctx) {
    const queries = parseQueries(entry);
    const ctxMaxPages = Number(ctx?.maxPages);
    const probing = ctxMaxPages > 0;
    const pagesPerQuery = Math.min(resolveMaxPages(entry), probing ? ctxMaxPages : Infinity);
    // The probe's budget covers the whole walk, not one allowance per query.
    let requestBudget = probing ? ctxMaxPages : Infinity;
    const label = entry?.name || 'Freelancer.com';
    /** @type {Map<string, any>} */
    const byUrl = new Map();
    let lastError = null;
    let pagesRead = 0;

    for (const query of queries) {
      if (requestBudget <= 0) break;
      let stopReason = 'complete';
      try {
        for (let page = 0; page < pagesPerQuery; page++) {
          if (requestBudget <= 0) { stopReason = 'probe'; break; }
          if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
          requestBudget--;
          const json = await fetchJsonWithRetry(ctx, buildSearchUrl(query, page * PAGE_SIZE), { redirect: 'error' });
          const { jobs, rawCount, total } = parseFreelancerProjects(json);
          pagesRead++;
          for (const job of jobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
          // Stop on the source's own page shape, never on a post-dedup count.
          if (rawCount < PAGE_SIZE) break;
          if (total !== null && (page + 1) * PAGE_SIZE >= total) break;
          if (page === pagesPerQuery - 1) stopReason = probing ? 'probe' : 'cap';
        }
      } catch (err) {
        // While probing, a rejection (ProbePageBudgetReached included) must
        // propagate unwrapped.
        if (probing) throw err;
        lastError = err;
        stopReason = 'fetch-error';
        console.warn(`freelancer-com: "${label}" query ${JSON.stringify(query)} failed: ${err && err.message ? err.message : err}`);
      }
      if (stopReason === 'cap') {
        console.warn(`freelancer-com: "${label}" query ${JSON.stringify(query)} hit max_pages (${pagesPerQuery}); raise max_pages on this entry for more`);
      }
    }
    // Nothing read at all (every query failed on its first page): fail loud
    // rather than report an empty board. Otherwise keep what was read.
    if (!pagesRead && lastError) throw lastError;
    return [...byUrl.values()];
  },
};
