// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Rippling provider — hits the public per-tenant ATS board API.
// Auto-detects from a careers_url like `https://ats.rippling.com/<slug>/jobs`
// (the `<slug>` is the first path segment). Rippling's board API is public and
// zero-auth:
//   https://api.rippling.com/platform/api/ats/v1/board/<slug>/jobs
// Response shape: a JSON ARRAY of
//   { uuid, name, department: { id, label }, url, workLocation: { id, label } }
//
// The careers host (`ats.rippling.com`) and the API host (`api.rippling.com`)
// are both fixed; the per-tenant slug is the only variable part. It is extracted
// from the careers URL path and constrained to a safe token so it cannot inject
// extra path segments or traversal into the API URL.

const CAREERS_HOST = 'ats.rippling.com';
const API_HOST = 'api.rippling.com';
const API_BASE = `https://${API_HOST}/platform/api/ats/v1/board`;
const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * Resolve the tenant slug (e.g. `just-appraised-jobs`) from a careers_url.
 * Returns null for non-Rippling, malformed, or unsafe-slug URLs.
 * @param {import('./_types.js').PortalEntry} entry
 */
function resolveSlug(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== CAREERS_HOST) return null;
  const segment = parsed.pathname.split('/').filter(Boolean)[0] || '';
  if (!SLUG_RE.test(segment)) return null;
  return segment;
}

/** Build the board API URL for a validated slug. */
function apiUrlForSlug(slug) {
  return `${API_BASE}/${encodeURIComponent(slug)}/jobs`;
}

/** @param {string} url */
function assertRipplingApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`rippling: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`rippling: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== API_HOST) {
    throw new Error(`rippling: untrusted hostname "${parsed.hostname}" — must be ${API_HOST}`);
  }
  return url;
}

/** @type {Provider} */
export default {
  id: 'rippling',

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: apiUrlForSlug(slug) } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`rippling: cannot derive API URL for ${entry.name}`);
    const apiUrl = apiUrlForSlug(slug);
    assertRipplingApiUrl(apiUrl);
    // redirect:'error' prevents SSRF via server-side redirects
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return parseRipplingResponse(json, entry.name);
  },
};

/**
 * Parse a Rippling board API response. Exported for unit tests.
 *
 * The response is a top-level JSON ARRAY of postings. Field mapping → the
 * normalized Job shape:
 *   - title:    `name`, trimmed (postings without one are dropped).
 *   - url:      `url` — an absolute `https:` posting URL host-locked to
 *               `ats.rippling.com` (Rippling always serves postings there, so an
 *               off-host or non-https URL is untrusted and the posting is dropped).
 *               It is the dedup key and is display-only (written to the
 *               pipeline/history, never server-fetched here).
 *   - company:  the portal entry name (the feed is per-tenant and carries no
 *               company field, same as recruitee).
 *   - location: `workLocation.label` (e.g. "Remote (United States)"); falls back
 *               to a bare string `workLocation`, else "".
 *
 * @param {any} json
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseRipplingResponse(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json
    .map(j => {
      const title = typeof j?.name === 'string' ? j.name.trim() : '';
      if (!title) return null;

      // url must be an absolute https posting link on ats.rippling.com — Rippling
      // always serves postings there (no custom-domain case), so an off-host URL
      // is untrusted and dropped. url is the dedup key.
      let url = '';
      const rawUrl = typeof j?.url === 'string' ? j.url.trim() : '';
      if (rawUrl) {
        try {
          const parsed = new URL(rawUrl);
          if (parsed.protocol === 'https:' && parsed.hostname === CAREERS_HOST) url = parsed.href;
        } catch {
          // malformed URL → leave url = '' → dropped below
        }
      }
      if (!url) return null;

      const wl = j?.workLocation;
      const location =
        wl && typeof wl === 'object' && typeof wl.label === 'string'
          ? wl.label.trim()
          : typeof wl === 'string'
            ? wl.trim()
            : '';

      return { title, url, location, company: companyName };
    })
    .filter(Boolean);
}
