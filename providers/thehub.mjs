// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// The Hub provider — board-wide aggregator feed (Nordic / EU startups):
// https://thehub.io/api/jobs
// Response shape: { docs: [ { id, key, title, company: { name, ... },
//   location: { address, locality, country }, absoluteJobUrl, isRemote,
//   publishedAt, createdAt, ... } ], total, page, pages, limit }
//
// Paginated 15/page via `?page=N` (1-indexed); the response carries `pages`, so
// iteration is bounded by min(pages, max_pages). Default cap is modest (the
// board is ~1000 jobs / ~67 pages); override with `max_pages` on the entry.
//
// Wire in via a `job_boards:` entry with `provider: thehub`.

const FEED_BASE = 'https://thehub.io/api/jobs';
const TRUSTED_HOST = 'thehub.io';
const PER_PAGE = 15;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 67;

/** @param {string} url */
function assertHubUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`thehub: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`thehub: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`thehub: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Normalize a single The Hub job. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (postings without one are dropped).
 *   - url:      `absoluteJobUrl` — host-locked to `thehub.io` (The Hub always
 *               serves its canonical posting page there; the per-posting `link`
 *               field is an external apply URL and is NOT used). An off-host or
 *               non-https URL drops the posting. url is the dedup key and is
 *               display-only (written to the pipeline/history, never fetched here).
 *   - company:  `company.name`, falling back to the portal entry name, then
 *               "The Hub".
 *   - location: `location.address`, else assembled from `location.locality` /
 *               `location.country`; "Remote" is appended when `isRemote` is true.
 *   - postedAt: `publishedAt` (else `createdAt`) ISO date → epoch ms (omitted
 *               when absent/unparseable).
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number } | null}
 */
export function normalizeHubJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  let url = '';
  const rawUrl = typeof j.absoluteJobUrl === 'string' ? j.absoluteJobUrl.trim() : '';
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
    j.company && typeof j.company === 'object' && typeof j.company.name === 'string' && j.company.name.trim()
      ? j.company.name.trim()
      : typeof fallbackCompany === 'string' && fallbackCompany.trim()
        ? fallbackCompany.trim()
        : 'The Hub';

  const loc = j.location && typeof j.location === 'object' ? j.location : {};
  const address = typeof loc.address === 'string' ? loc.address.trim() : '';
  const locality = typeof loc.locality === 'string' ? loc.locality.trim() : '';
  const country = typeof loc.country === 'string' ? loc.country.trim() : '';
  const base = address || [locality, country].filter(Boolean).join(', ');
  const location = [base, j.isRemote === true ? 'Remote' : ''].filter(Boolean).join(', ');

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number }} */
  const job = { title, url, company, location };
  const postedAt = toEpochMs(j.publishedAt) ?? toEpochMs(j.createdAt);
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/** @type {Provider} */
export default {
  id: 'thehub',

  async fetch(entry, ctx) {
    assertHubUrl(FEED_BASE);
    const maxPages = resolveMaxPages(entry);
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = `${FEED_BASE}?page=${page}`;
      // redirect:'error' prevents SSRF via server-side redirects
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      if (!json || !Array.isArray(json.docs)) {
        throw new Error(
          `thehub: unexpected API response on page ${page} — expected { docs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const j of json.docs) {
        const normalized = normalizeHubJob(j, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      // Stop at the last page: a short page, or page >= the reported total pages.
      if (json.docs.length < PER_PAGE) break;
      if (Number.isInteger(json.pages) && page >= json.pages) break;
    }
    return out;
  },
};
