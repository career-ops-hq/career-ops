// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// 4 Day Week provider — board-wide aggregator of 4-day-week / reduced-hours
// roles. Public, zero-auth JSON API: https://4dayweek.io/api/jobs
// Response shape: { jobs: [ { id, title, slug, company_name, company: { name,
//   slug, ... }, work_arrangement, locations: [{ city, country, ... }],
//   posted (epoch SECONDS), is_expired, ... } ], total, page, has_more }
//
// The feed carries no per-job URL — the canonical posting page is
// https://4dayweek.io/job/<slug> (verified via the page's rel=canonical; the
// /jobs and /remote-jobs paths soft-404 to the listing). The slug is the only
// variable part of the built URL and is constrained to a safe token.
//
// Paginated 25/page via ?page=N; bounded by max_pages (default 3, cap 50) and
// the has_more flag. Expired postings (is_expired) are dropped.
//
// Wire in via a `job_boards:` entry with `provider: 4dayweek`.

const FEED_BASE = 'https://4dayweek.io/api/jobs';
const TRUSTED_HOST = '4dayweek.io';
const JOB_BASE = `https://${TRUSTED_HOST}/job`;
const PER_PAGE = 25;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 50;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

function detectFourDayEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.provider === '4dayweek') return { url: FEED_BASE };
  if (entry.provider) return null;

  for (const value of [entry.api, entry.careers_url]) {
    if (typeof value !== 'string') continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_HOST) {
        return { url: FEED_BASE };
      }
    } catch {
      // Ignore malformed URLs; another provider may still claim the entry.
    }
  }
  return null;
}

/** @param {string} url */
function assertFourDayUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`4dayweek: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`4dayweek: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`4dayweek: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

// NaN-safe: posted is epoch SECONDS → ms; anything non-finite yields undefined.
function toEpochMs(seconds) {
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/**
 * Normalize a single 4 Day Week job. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (postings without one are dropped).
 *   - url:      built as `https://4dayweek.io/job/<slug>` — the feed has no URL
 *               field. The slug must match a safe token (no slashes/spaces) or
 *               the posting is dropped; the URL is the dedup key and display-only.
 *   - company:  `company_name` (else `company.name`), falling back to the portal
 *               entry name, then "4 Day Week".
 *   - location: first `locations[]` as "city, country"; "Remote" is appended when
 *               the job's (or location's) work_arrangement is "remote".
 *   - postedAt: `posted` (epoch SECONDS) → epoch ms (omitted when absent).
 *
 * Expired postings (`is_expired === true`) are dropped.
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalize4dwJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;
  if (j.is_expired === true) return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  const slug = typeof j.slug === 'string' ? j.slug.trim() : '';
  if (!SLUG_RE.test(slug)) return null; // need a clean slug to build the url
  const url = `${JOB_BASE}/${encodeURIComponent(slug)}`;

  const company =
    typeof j.company_name === 'string' && j.company_name.trim()
      ? j.company_name.trim()
      : j.company && typeof j.company === 'object' && typeof j.company.name === 'string' && j.company.name.trim()
        ? j.company.name.trim()
        : typeof fallbackCompany === 'string' && fallbackCompany.trim()
          ? fallbackCompany.trim()
          : '4 Day Week';

  const first = Array.isArray(j.locations) && j.locations[0] && typeof j.locations[0] === 'object' ? j.locations[0] : {};
  const city = typeof first.city === 'string' ? first.city.trim() : '';
  const country = typeof first.country === 'string' ? first.country.trim() : '';
  const base = [city, country].filter(Boolean).join(', ');
  const remote = j.work_arrangement === 'remote' || first.work_arrangement === 'remote';
  const location = [base, remote ? 'Remote' : ''].filter(Boolean).join(', ');

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url, company, location };
  const postedAt = toEpochMs(j.posted);
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/** @type {Provider} */
export default {
  id: '4dayweek',

  detect: detectFourDayEntry,

  async fetch(entry, ctx) {
    assertFourDayUrl(FEED_BASE);
    const maxPages = resolveMaxPages(entry);
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = `${FEED_BASE}?page=${page}`;
      // redirect:'error' prevents SSRF via server-side redirects
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      if (!json || !Array.isArray(json.jobs)) {
        throw new Error(
          `4dayweek: unexpected API response on page ${page} — expected { jobs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const j of json.jobs) {
        const normalized = normalize4dwJob(j, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      if (json.has_more === false) break; // last page per the API flag
      if (json.jobs.length < PER_PAGE) break; // short page → last page
    }
    return out;
  },
};
