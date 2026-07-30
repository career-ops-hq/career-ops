// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jobvite provider — per-tenant public jobs JSON API.
// Used by ~3,000 companies across a wide range of industries.
//
// API: GET https://jobs.jobvite.com/api/company/{companyId}/jobs
// Response: { jobs: [ { id, title, category, location, country, jobType,
//   date, applyURL } ] }
//
// Auto-detects from careers_url pattern:
//   https://jobs.jobvite.com/{companyId}
//   https://jobs.jobvite.com/{companyId}/jobs
// The companyId is the slug segment immediately after the host.
//
// SSRF stance: API URL is constructed from the extracted slug only, never
// from a user-supplied path; assertJobviteUrl() pins the hostname to
// jobs.jobvite.com before every fetch. Job applyURLs are display-only
// (written to pipeline/history, never fetched here) and accepted from any
// https: URL returned by the already-validated tenant API response.
//
// Wire in via a `tracked_companies:` entry with:
//   careers_url: https://jobs.jobvite.com/{companyId}
// or explicitly with:
//   provider: jobvite
//   api: https://jobs.jobvite.com/api/company/{companyId}/jobs

const ALLOWED_HOST = 'jobs.jobvite.com';

/** @param {string} url */
function assertJobviteUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobvite: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:')
    throw new Error(`jobvite: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== ALLOWED_HOST)
    throw new Error(`jobvite: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  return url;
}

// NaN-safe Date.parse → epoch ms.
/** @param {string} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Extract the companyId slug from a careers_url or api URL.
 *
 * Accepted forms:
 *   https://jobs.jobvite.com/{slug}
 *   https://jobs.jobvite.com/{slug}/jobs
 *   https://jobs.jobvite.com/api/company/{slug}/jobs  (explicit api: field)
 *
 * Returns null for any non-Jobvite or malformed URL.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
export function resolveCompanyId(entry) {
  // Prefer an explicit api: URL (may be set by the user for custom slugs).
  const raw = typeof entry.api === 'string' && entry.api
    ? entry.api
    : typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_HOST) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);

  // api: https://jobs.jobvite.com/api/company/{slug}/jobs → ['api','company',slug,'jobs']
  const apiIdx = segments.indexOf('company');
  if (apiIdx !== -1 && segments[apiIdx + 1]) {
    return segments[apiIdx + 1];
  }

  // careers_url: https://jobs.jobvite.com/{slug}[/jobs] → [slug] or [slug, 'jobs']
  if (segments.length >= 1 && segments[0] !== 'api') {
    return segments[0];
  }

  return null;
}

/** @param {string} companyId */
function buildApiUrl(companyId) {
  return `https://${ALLOWED_HOST}/api/company/${encodeURIComponent(companyId)}/jobs`;
}

/** @type {Provider} */
export default {
  id: 'jobvite',

  detect(entry) {
    const companyId = resolveCompanyId(entry);
    return companyId ? { url: buildApiUrl(companyId) } : null;
  },

  async fetch(entry, ctx) {
    const companyId = resolveCompanyId(entry);
    if (!companyId) throw new Error(`jobvite: cannot derive company ID for ${entry.name}`);
    const apiUrl = buildApiUrl(companyId);
    assertJobviteUrl(apiUrl);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertJobviteUrl above it guarantees the final hostname stays pinned to
    // jobs.jobvite.com.
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return parseJobviteResponse(json, entry.name);
  },
};

/**
 * Parse a Jobvite /api/company/{id}/jobs response. Exported for unit tests.
 *
 * Response shape: `{ jobs: [ { id, title, location, country, date, applyURL,
 * category?, jobType? } ] }`. The `applyURL` is the per-job application page
 * and is used as the posting URL and dedup key. It is accepted from any
 * https: origin — per-job URLs in Jobvite commonly point to a branded company
 * subdomain (e.g. careers.example.com/jobs/…) rather than jobs.jobvite.com,
 * and these URLs are display-only (never fetched here), so host-pinning is not
 * required. Non-https or malformed applyURLs are dropped.
 *
 * Field mapping:
 *   title    ← `title`              (required; posting dropped when absent)
 *   url      ← `applyURL`           (required; posting dropped when not a valid https: URL)
 *   company  ← `entry.name`         (not in the API payload)
 *   location ← `location` (city/region string) or `country` as fallback
 *   postedAt ← `date` → epoch ms   (omitted when absent/unparseable)
 *
 * @param {unknown} json - raw parsed API response
 * @param {string} companyName - value to write into job.company
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseJobviteResponse(json, companyName) {
  if (!json || typeof json !== 'object') return [];
  const jobs = /** @type {any} */ (json).jobs;
  if (!Array.isArray(jobs)) return [];

  const out = [];
  for (const j of jobs) {
    if (!j || typeof j !== 'object') continue;

    const title = typeof j.title === 'string' ? j.title.trim() : '';
    if (!title) continue;

    // Resolve and validate the application URL.
    const rawUrl = typeof j.applyURL === 'string' ? j.applyURL.trim() : '';
    let url = '';
    if (rawUrl) {
      try {
        const p = new URL(rawUrl);
        if (p.protocol === 'https:') url = p.href;
      } catch {
        // malformed URL — drop posting
      }
    }
    if (!url) continue;

    // Location: prefer the explicit location string, fall back to country.
    const location =
      (typeof j.location === 'string' && j.location.trim())
        ? j.location.trim()
        : (typeof j.country === 'string' ? j.country.trim() : '');

    /** @type {import('./_types.js').Job & {postedAt?: number}} */
    const job = { title, url, company: companyName, location };
    const postedAt = toEpochMs(j.date);
    if (postedAt !== undefined) job.postedAt = postedAt;

    out.push(job);
  }
  return out;
}
