// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// The Hub provider — board-wide aggregator feed (Nordic / EU startups):
// https://thehub.io/api/v2/jobsandfeatured
// Response shape: { jobs: { docs: [ { id, key, title, company: { name, ... },
//   location: { address, locality, country }, isRemote, ... } ], total, page,
//   pages, limit } }. No job URL or posting date in the response, so
// `normalizeHubJob` builds the URL from `id` and the Job shape omits `postedAt`.
//
// `countryCode` is required on every request: omitting it scopes results to
// the caller's geo-IP, making scan coverage depend on where this process runs.
//
// The site's "Remote jobs only" filter is a separate query mode, not a value
// combinable with `countryCode` — it queries `isRemote=true` with no
// `countryCode` at all. Covering both a region and remote postings takes two
// separate paginated passes, merged and deduped by job id. Configure via a
// `thehub:` block:
//
//   - name: The Hub — EU startups
//     provider: thehub
//     thehub:
//       countryCode: EU     # optional; any value the API accepts. Default: EU
//       includeRemote: true # optional; also runs an isRemote=true pass, merged in. Default: false
//     max_pages: 5           # applies to each pass independently
//
// Paginated 15/page via `?page=N` (1-indexed); the response carries `pages`, so
// iteration is bounded by min(pages, max_pages). Default cap is modest; override
// with `max_pages` on the entry.
//
// Wire in via a `job_boards:` entry with `provider: thehub`.

const FEED_BASE = 'https://thehub.io/api/v2/jobsandfeatured';
const TRUSTED_HOST = 'thehub.io';
const DEFAULT_COUNTRY_CODE = 'EU';
const PER_PAGE = 15;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 67;

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Reads the entry's `thehub:` config block. Exported for unit tests.
 * @param {{ thehub?: any }} entry
 * @returns {{ countryCode: string, includeRemote: boolean }}
 */
export function parseThehubConfig(entry) {
  const cfg = (entry && entry.thehub) || {};
  const countryCode = typeof cfg.countryCode === 'string' && cfg.countryCode.trim()
    ? cfg.countryCode.trim()
    : DEFAULT_COUNTRY_CODE;
  return { countryCode, includeRemote: cfg.includeRemote === true };
}

/**
 * Normalize a single The Hub job. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (postings without one are dropped).
 *   - url:      built from `id` as `https://thehub.io/jobs/{id}` (postings
 *               without a usable id are dropped). This host is always
 *               thehub.io, so url is not attacker-controlled; it is the
 *               dedup key and is display-only (written to the
 *               pipeline/history, never fetched here).
 *   - company:  `company.name`, falling back to the portal entry name, then
 *               "The Hub".
 *   - location: `location.address`, else assembled from `location.locality` /
 *               `location.country`; "Remote" is appended when `isRemote` is true.
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string } | null}
 */
export function normalizeHubJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  const id = typeof j.id === 'string' ? j.id.trim() : '';
  if (!id) return null;
  const url = `https://${TRUSTED_HOST}/jobs/${encodeURIComponent(id)}`;

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

  return { title, url, company, location };
}

/**
 * Paginates one query mode (`?countryCode=X` or `?isRemote=true`) up to
 * `maxPages`, normalizing and appending each hit into `byUrl` (keyed by url,
 * so a job present in both passes is only counted once).
 *
 * `state.succeededOnce` is shared across both passes: a dead board should
 * still read as a failure, but once anything has resolved — in this pass or
 * an earlier one — a later failure (mid-pagination, or the remote pass
 * failing after the region pass already landed) must not discard what's
 * already collected (same `succeededOnce`/`firstErr` idiom as
 * tencent/meituan/alibaba/phenom/radancy/successfactors after #2379).
 * Returns `false` when the pass stopped early on a failure (region-pass
 * caller uses this to skip the remote pass), `true` otherwise.
 *
 * @param {string} query the query string beyond `?`, e.g. `countryCode=EU` or `isRemote=true`
 * @param {number} maxPages
 * @param {string | undefined} fallbackCompany
 * @param {Map<string, {title: string, url: string, company: string, location: string}>} byUrl
 * @param {{ fetchJson: (url: string, opts?: object) => Promise<any> }} ctx
 * @param {{ succeededOnce: boolean }} state
 * @returns {Promise<boolean>}
 */
async function fetchScope(query, maxPages, fallbackCompany, byUrl, ctx, state) {
  for (let page = 1; page <= maxPages; page++) {
    const url = `${FEED_BASE}?page=${page}&${query}`;
    let jobs;
    try {
      // redirect:'error' prevents SSRF via server-side redirects
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      jobs = json && json.jobs;
      if (!jobs || !Array.isArray(jobs.docs)) {
        throw new Error(
          `thehub: unexpected API response on page ${page} — expected { jobs: { docs: [...] } }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
    } catch (err) {
      if (!state.succeededOnce) throw err;
      console.error(`  ⚠ thehub: query "${query}" page ${page} failed (${err.message}) — keeping the ${byUrl.size} jobs collected so far`);
      return false;
    }
    state.succeededOnce = true;
    for (const j of jobs.docs) {
      const normalized = normalizeHubJob(j, fallbackCompany);
      if (normalized && !byUrl.has(normalized.url)) byUrl.set(normalized.url, normalized);
    }
    // Stop at the last page: a short page, or page >= the reported total pages.
    if (jobs.docs.length < PER_PAGE) break;
    if (Number.isInteger(jobs.pages) && page >= jobs.pages) break;
  }
  return true;
}

/** @type {Provider} */
export default {
  id: 'thehub',

  async fetch(entry, ctx) {
    const maxPages = resolveMaxPages(entry);
    const { countryCode, includeRemote } = parseThehubConfig(entry);
    const fallbackCompany = entry?.name;
    const byUrl = new Map();
    const state = { succeededOnce: false };

    const regionOk = await fetchScope(`countryCode=${encodeURIComponent(countryCode)}`, maxPages, fallbackCompany, byUrl, ctx, state);
    if (regionOk && includeRemote) {
      await fetchScope('isRemote=true', maxPages, fallbackCompany, byUrl, ctx, state);
    }

    return [...byUrl.values()];
  },
};
