// @ts-check
import { fetchJsonWithRetry } from './_http.mjs';

/** @typedef {import('./_types.js').Provider} Provider */

// a16z speedrun talent network provider — board-wide aggregator feed (a16z
// speedrun + wider a16z portfolio startups, ~200 companies):
// https://speedrun-talent-network.com/api/v1/jobs (public, zero-auth; OpenAPI
// at /api/v1/openapi.json, human docs at /developers).
// Response shape: { jobs: [ { id, title, company, url, location, remote,
//   published_at, ... } ], total, page, page_size, total_pages, facets }
//
// Paginated 50/page via `?page=N` (0-indexed); the response carries
// `total_pages`, so iteration is bounded by min(total_pages, max_pages).
// Page budgets are sized in 50-job pages — see DEFAULT_MAX_PAGES and
// MAX_PAGES_CAP below. Either raise `max_pages` on the entry or narrow
// server-side with `q:` (the feed runs full-text search with synonym
// expansion, e.g. "ml", "swe", "nyc").
//
// Every request carries `source=career-ops` — the feed's documented optional
// attribution param, echoed in the response; it does not change results.
//
// Wire in via a `job_boards:` entry with `provider: a16z-speedrun-talent`, or point
// `careers_url` at https://speedrun-talent-network.com (auto-detected).

const FEED_BASE = 'https://speedrun-talent-network.com/api/v1/jobs';
const TRUSTED_HOST = 'speedrun-talent-network.com';
const PER_PAGE = 50;
const DEFAULT_MAX_PAGES = 6; // × PER_PAGE = the 300-job default scan
// Runaway bound, not a coverage target: iteration already stops at the
// feed's reported total_pages (or a short page), so on an honest feed the
// cap costs nothing and full-board sweeps keep working as the board grows.
// It only bites a misbehaving feed or an absurd max_pages entry — so it
// sits well above plausible board size (~353 pages / ~17.6k jobs as of
// 2026-08), same policy as workday.mjs's cap.
const MAX_PAGES_CAP = 1000;

/** @param {string} url */
function assertFeedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`a16z-speedrun-talent: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`a16z-speedrun-talent: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`a16z-speedrun-talent: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** Optional server-side query: `q:` on the entry, else joined `keywords:`. */
function resolveQuery(entry) {
  if (typeof entry?.q === 'string' && entry.q.trim()) return entry.q.trim();
  if (Array.isArray(entry?.keywords) && entry.keywords.length > 0) {
    const joined = entry.keywords.filter((k) => typeof k === 'string' && k.trim()).join(' ').trim();
    if (joined) return joined;
  }
  return null;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Normalize a single speedrun talent network job. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (postings without one are dropped).
 *   - url:      `url` — the canonical posting page, host-locked to
 *               `speedrun-talent-network.com` (the feed always serves its own
 *               absolute /jobs/... URL). An off-host or non-https URL drops
 *               the posting. url is the dedup key and is display-only here.
 *   - company:  `company`, falling back to the portal entry name, then
 *               "speedrun talent network". Unannounced roles arrive already
 *               masked as "Stealth" by the feed.
 *   - location: `location`; "Remote" is appended when `remote` is true.
 *   - postedAt: `published_at` ISO date → epoch ms (omitted when absent or
 *               unparseable).
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeSpeedrunJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

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
    typeof j.company === 'string' && j.company.trim()
      ? j.company.trim()
      : typeof fallbackCompany === 'string' && fallbackCompany.trim()
        ? fallbackCompany.trim()
        : 'a16z speedrun talent network';

  const base = typeof j.location === 'string' ? j.location.trim() : '';
  const location = [base, j.remote === true ? 'Remote' : ''].filter(Boolean).join(', ');

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url, company, location };
  const postedAt = toEpochMs(j.published_at);
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/** @type {Provider} */
export default {
  id: 'a16z-speedrun-talent',

  detect(entry) {
    for (const candidate of [entry?.careers_url, entry?.api]) {
      if (typeof candidate !== 'string' || !candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_HOST) {
          return { url: candidate };
        }
      } catch {
        // not a URL → not ours
      }
    }
    return null;
  },

  async fetch(entry, ctx) {
    assertFeedUrl(FEED_BASE);
    const maxPages = resolveMaxPages(entry);
    const q = resolveQuery(entry);
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ page: String(page), source: 'career-ops' });
      if (q) params.set('q', q);
      const url = `${FEED_BASE}?${params}`;
      // redirect:'error' prevents SSRF via server-side redirects.
      // Retried on transient upstream failures (429/5xx/timeout): this board
      // paginates into the hundreds of pages, so a single blip mid-sweep used
      // to abort the whole provider and return NOTHING. Retries are bounded
      // and, once exhausted, the error still propagates — a silent partial
      // board would be worse than an loud empty one (#2506).
      const json = await fetchJsonWithRetry(ctx, url, { redirect: 'error' });
      if (!json || !Array.isArray(json.jobs)) {
        throw new Error(
          `a16z-speedrun-talent: unexpected API response on page ${page} — expected { jobs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const j of json.jobs) {
        const normalized = normalizeSpeedrunJob(j, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      // Stop at the last page: a short page, or past the reported total_pages.
      if (json.jobs.length < PER_PAGE) break;
      if (Number.isInteger(json.total_pages) && page + 1 >= json.total_pages) break;
      // Cap warning (same pattern as jibeapply/workday): the feed had more
      // pages than we were allowed to read — surface it, with the fix.
      if (page + 1 >= maxPages && Number.isInteger(json.total_pages) && json.total_pages > maxPages) {
        const name = typeof fallbackCompany === 'string' && fallbackCompany ? fallbackCompany : 'a16z speedrun talent network';
        console.error(
          `⚠️  a16z-speedrun-talent: ${name} truncated at max_pages=${maxPages} (${out.length} of ${Number.isInteger(json.total) ? json.total : 'many'} jobs) — raise max_pages on this entry or narrow with q: for more`,
        );
      }
    }
    return out;
  },
};
