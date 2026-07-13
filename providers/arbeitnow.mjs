// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Arbeitnow provider — board-wide aggregator feed (EU/DACH-heavy, but
// international): https://www.arbeitnow.com/api/job-board-api
// Response shape: { data: [ { slug, company_name, title, description, remote,
//   url, tags, job_types, location, created_at } ], links, meta }
//
// Jobs are ordered newest-first, 100 per page. The API echoes a rotating
// featured `?search=` term into links.next, so page URLs are built directly as
// `?page=N` (never by following links.next) to keep the FULL board in view —
// scan.mjs's title_filter then gates on the configured titles. Pages are fetched
// until one comes back short/empty or the page cap is reached (default 3,
// override with `max_pages` on the portal entry).
//
// Wire in via a `job_boards:` entry with `provider: arbeitnow`.

const FEED_BASE = 'https://www.arbeitnow.com/api/job-board-api';
const TRUSTED_HOST = 'www.arbeitnow.com';
const PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 50;

/** @param {string} url */
function assertArbeitnowUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`arbeitnow: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`arbeitnow: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`arbeitnow: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Normalize a single Arbeitnow job. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (items without one are dropped).
 *   - url:      `url` — an absolute `https:` posting URL host-locked to
 *               www.arbeitnow.com (an off-host or non-https URL is untrusted and
 *               drops the item). It is the dedup key and is display-only (written
 *               to the pipeline/history, never server-fetched here).
 *   - company:  `company_name`, falling back to the portal entry name, then
 *               "Arbeitnow".
 *   - location: `location`, with "Remote" appended when `remote` is true.
 *   - postedAt: `created_at` (epoch SECONDS) → epoch ms (omitted when absent).
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeArbeitnowJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  // url must be an absolute https posting link on www.arbeitnow.com — Arbeitnow
  // always serves postings there, so an off-host URL is untrusted and dropped.
  let url = '';
  const rawUrl = typeof j.url === 'string' ? j.url.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_HOST) url = parsed.href;
    } catch {
      // malformed URL → leave url = '' → dropped below
    }
  }
  if (!url) return null;

  const company =
    typeof j.company_name === 'string' && j.company_name.trim()
      ? j.company_name.trim()
      : fallbackCompany || 'Arbeitnow';

  const baseLocation = typeof j.location === 'string' ? j.location.trim() : '';
  const location = [baseLocation, j.remote === true ? 'Remote' : ''].filter(Boolean).join(', ');

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url, company, location };
  if (Number.isFinite(j.created_at)) job.postedAt = j.created_at * 1000; // epoch seconds → ms
  return job;
}

/** @type {Provider} */
export default {
  id: 'arbeitnow',

  async fetch(entry, ctx) {
    assertArbeitnowUrl(FEED_BASE);
    const maxPages = resolveMaxPages(entry);
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 1; page <= maxPages; page++) {
      // Build the page URL directly (do NOT follow links.next — it carries a
      // featured `?search=` term that would narrow the board).
      const url = `${FEED_BASE}?page=${page}`;
      // redirect:'error' prevents SSRF via server-side redirects
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      if (!json || !Array.isArray(json.data)) {
        throw new Error(
          `arbeitnow: unexpected API response on page ${page} — expected { data: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const j of json.data) {
        const normalized = normalizeArbeitnowJob(j, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      if (json.data.length < PER_PAGE) break; // short page → last page reached
    }
    return out;
  },
};
