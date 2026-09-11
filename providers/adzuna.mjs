// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Adzuna provider — UK / EU job aggregator with free API tier
// https://developer.adzuna.com/overview
// API key: ADZUNA_APP_ID + ADZUNA_APP_KEY env vars (sign up at adzuna.co.uk)
// Free tier: 50 requests/day, no auth required but rate-limited.
//
// Response shape (from /api/uk/jobs?query=...&results_per_page=N&page=P):
// {
//   results: [ { title, description, category, location, salary_min, salary_max,
//                created: ISO date, company.display_name, redirect_url, ... } ],
//   count, mean, page, last_page
// }

import { readFileSync, existsSync } from 'fs';
import path from 'path';

const BASE_URL = 'https://uk.api.adzuna.com/api/jobs/1/search/';
const DEFAULT_RESULTS_PER_PAGE = 20;
const MAX_PAGES = 10; // ~200 jobs per search

function getEnvVar(name) {
  return process.env[name] || '';
}

/** @param {string} s */
function clean(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a single Adzuna job to career-ops Job shape.
 * @param {any} j
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeAdzunaJob(j) {
  if (!j || typeof j !== 'object') return null;

  const title = clean(j.title || '');
  if (!title) return null;

  // URL: use redirect_url if available (points to employer ATS), else the Adzuna listing
  let url = '';
  if (typeof j.redirect_url === 'string' && j.redirect_url.trim()) {
    try {
      const parsed = new URL(j.redirect_url.trim());
      if (parsed.protocol === 'https:') url = parsed.href;
    } catch {}
  }
  if (!url && typeof j.location === 'object') {
    url = `https://www.adzuna.co.uk/jobs/details/${j.id}`;
  }
  if (!url) return null;

  const company = clean(j.company?.display_name || j.company || 'Adzuna');
  const location = typeof j.location === 'object'
    ? clean(j.location.display_name)
    : clean(j.location);

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url, company, location };

  if (j.created) {
    const ts = new Date(j.created).getTime();
    if (Number.isFinite(ts)) job.postedAt = ts;
  }

  return job;
}

/** @type {Provider} */
export default {
  id: 'adzuna',

  detect(entry) {
    // Adzuna is a job board, not a company ATS — always requires explicit provider:
    return null;
  },

  async fetch(entry, ctx) {
    /** @type {string[]} */
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    if (keywords.length === 0) {
      console.warn('adzuna: no keywords provided, skipping');
      return [];
    }

    const app_id = getEnvVar('ADZUNA_APP_ID');
    const app_key = getEnvVar('ADZUNA_APP_KEY');
    const perPage = Math.min(Number(entry.results_per_page) || DEFAULT_RESULTS_PER_PAGE, 50);
    const maxPages = Math.min(Number(entry.max_pages) || MAX_PAGES, 20);

    const out = [];

    for (const kw of keywords) {
      const searchQuery = encodeURIComponent(kw);
      for (let page = 1; page <= maxPages; page++) {
        const params = new URLSearchParams({
          app_id: app_id || 'test',
          app_key: app_key || 'test',
          results_per_page: String(perPage),
          page: String(page),
          what: searchQuery,
          where: entry.where || 'london',
          contract_time: 'full_time',
          sort_by: 'date',
        });

        const url = `${BASE_URL}?${params.toString()}`;

        try {
          const json = await ctx.fetchJson(url, { redirect: 'error' });
          if (!json || !Array.isArray(json.results)) {
            console.warn(`adzuna: unexpected response for "${kw}" page ${page}`);
            break;
          }
          for (const job of json.results) {
            const normalized = normalizeAdzunaJob(job);
            if (normalized) out.push(normalized);
          }
          if (json.results.length < perPage) break; // last page
        } catch (err) {
          console.warn(`adzuna: failed for "${kw}" page ${page}: ${err.message}`);
          break;
        }
      }
    }

    return out;
  },
};
