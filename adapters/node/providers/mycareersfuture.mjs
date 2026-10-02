/** Collect mycareersfuture postings using the shared profile search terms. */
// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { intInRange } from './_config-utils.mjs';
import { providerKeywords } from './_profile-keywords.mjs';
import { fetchJsonWithRetry } from './_http.mjs';

const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 20;

/**
 * Reads and sanitizes the entry's `mycareersfuture:` config block, plus the
 * shared `max_pages` field (same key jobbankca.mjs/workday.mjs use).
 * @param {{ mycareersfuture?: any, max_pages?: unknown }} entry
 * @returns {{ size: number, maxPages: number }}
 */
export function parseConfig(entry) {
  const cfg = (entry && entry.mycareersfuture) || {};
  return {
    size: intInRange(cfg.size, MAX_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    maxPages: intInRange(entry && entry.max_pages, DEFAULT_MAX_PAGES, 1, MAX_PAGES_CAP),
  };
}

const TRUSTED_JOB_HOST = 'www.mycareersfuture.gov.sg';

/**
 * Cleans and host-locks a job detail URL straight from the API response —
 * defense in depth against the API ever returning (or being tricked into
 * returning) an off-host URL, the same discipline jobbankca.mjs applies to
 * its Atom `<link href>`.
 *
 * Requires the trusted host's exact default-port HTTPS origin with no
 * embedded credentials: `.hostname` alone already can't be fooled by a
 * `https://TRUSTED_JOB_HOST@evil.example/` userinfo trick (`.hostname`
 * extracts only the real host, `evil.example` there), but a URL carrying a
 * non-default port or `user:pass@` userinfo on the REAL host would still
 * pass a `.hostname`-only check — confirmed by execution — and has no
 * legitimate reason to appear in this feed, so both are rejected outright.
 * @param {unknown} value
 * @returns {string}
 */
export function cleanUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:'
      && parsed.hostname === TRUSTED_JOB_HOST
      && parsed.port === ''
      && parsed.username === ''
      && parsed.password === ''
      ? parsed.href
      : '';
  } catch {
    return '';
  }
}

/**
 * Normalizes one raw `results[]` record into a Job plus its jobPostId (kept
 * for dedup, stripped before the provider returns it). Returns null when the
 * posting lacks a usable id, title, or trusted url.
 *
 * `company` prefers `hiringCompany` (the real employer) over `postedCompany`
 * (the poster, which is a recruitment agency when `isPostedOnBehalf` is
 * true) — confirmed live samples never populated `hiringCompany`, but the
 * schema clearly reserves it for exactly this case, so preferring it costs
 * nothing on the common path and gets the right answer on the uncommon one.
 * @param {any} r
 * @returns {({title: string, url: string, company: string, location: string, postedAt?: number, id: string}) | null}
 */
export function normalizeJob(r) {
  const id = r && r.metadata && r.metadata.jobPostId;
  const title = String((r && r.title) || '').trim();
  const url = cleanUrl(r && r.metadata && r.metadata.jobDetailsUrl);
  if (!id || !title || !url) return null;
  const company = String(
    (r.hiringCompany && r.hiringCompany.name)
    || (r.postedCompany && r.postedCompany.name)
    || '',
  ).trim();
  const districts = Array.isArray(r.address && r.address.districts) ? r.address.districts : [];
  const location = districts.map((d) => d && d.location).filter(Boolean).join(', ');
  const result = { title, url, company, location, id: String(id) };
  const posted = Date.parse((r.metadata && r.metadata.newPostingDate) || '');
  if (Number.isFinite(posted)) result.postedAt = posted;
  return result;
}

const API_URL = 'https://api.mycareersfuture.gov.sg/v2/search';

/** @type {Provider} */
export default {
  id: 'mycareersfuture',

  detect(entry) {
    return entry?.provider === 'mycareersfuture' ? { url: API_URL } : null;
  },

  /**
   * Fetches and normalizes postings from MyCareersFuture's public search API.
   * @param {{ name?: string, mycareersfuture?: any, max_pages?: unknown }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const { size, maxPages: configuredMaxPages } = parseConfig(entry);
    const keywords = providerKeywords(ctx);
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pageLimit = probing ? Math.min(ctx.maxPages, configuredMaxPages) : configuredMaxPages;

    /** @param {string} keyword */
    const fetchKeyword = async (keyword) => {
      const out = [];
      for (let page = 0; page < pageLimit; page++) {
        const json = await fetchJsonWithRetry(ctx, `${API_URL}?limit=${size}&page=${page}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ search: keyword, sortBy: ['new_posting_date'], page }),
          redirect: 'error',
          timeoutMs: 12_000,
        });
        const results = Array.isArray(json && json.results) ? json.results : [];
        out.push(...results);
        if (results.length < size) break;
      }
      return out;
    };

    const byId = new Map();
    const errors = [];
    let succeeded = 0;
    for (const keyword of keywords) {
      let raw;
      try {
        raw = await fetchKeyword(keyword);
        succeeded++;
      } catch (err) {
        if (probing) throw err;
        errors.push(`"${keyword}": ${(err && err.message) || err}`);
        continue;
      }
      for (const r of raw) {
        const job = normalizeJob(r);
        if (job && !byId.has(job.id)) byId.set(job.id, job);
      }
    }
    if (succeeded === 0 && errors.length) {
      throw new Error(`mycareersfuture: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...byId.values()].map(({ id, ...job }) => job);
  },
};
