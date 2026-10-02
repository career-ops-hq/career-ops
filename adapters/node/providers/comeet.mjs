// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Comeet (Spark Hire Recruit) provider — hits the public, no-auth careers API.
//
// The positions endpoint needs BOTH a company-uid and a per-tenant token:
//   https://www.comeet.co/careers-api/2.0/company/<uid>/positions?token=<token>
// Neither is derivable from a branded careers URL, so unlike greenhouse/recruitee
// there is no slug→API shortcut: the full API URL must be supplied via the
// `api:` field (or pasted into `careers_url`). The API host is a single fixed
// origin, so the SSRF defence pins hostname to www.comeet.co AND requires the
// /careers-api/ path prefix (rather than a per-tenant subdomain regex).

const COMEET_API_HOST = 'www.comeet.co';

/** @param {unknown} raw */
function isComeetApiUrl(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname === COMEET_API_HOST && parsed.pathname.startsWith('/careers-api/');
}

/** @param {string} url */
function assertComeetUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`comeet: invalid URL: ${redactToken(url)}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`comeet: URL must use HTTPS: ${redactToken(url)}`);
  if (parsed.hostname !== COMEET_API_HOST)
    throw new Error(`comeet: untrusted hostname "${parsed.hostname}" — must be ${COMEET_API_HOST}`);
  if (!parsed.pathname.startsWith('/careers-api/'))
    throw new Error(`comeet: URL path must be the careers-api endpoint: ${redactToken(url)}`);
  return url;
}

// Redact the per-tenant ?token= so neither the (informational, possibly-logged)
// DetectHit url nor a thrown validation error carries the secret. Best-effort:
// falls back to a regex strip when the value can't be parsed as a URL.
function redactToken(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('token')) parsed.searchParams.set('token', 'REDACTED');
    return parsed.href;
  } catch {
    return typeof url === 'string' ? url.replace(/([?&]token=)[^&#]*/gi, '$1REDACTED') : url;
  }
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveApiUrl(entry) {
  if (isComeetApiUrl(entry.api)) return entry.api;
  // Fall back to careers_url only when it already IS the full careers-api URL
  // (the branded www.comeet.com/jobs/... page carries no token, so it can't be
  // turned into an API call).
  if (isComeetApiUrl(entry.careers_url)) return entry.careers_url;
  return null;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @type {Provider} */
export default {
  id: 'comeet',

  detect(entry) {
    const apiUrl = resolveApiUrl(entry);
    // The DetectHit url is informational (the framework may log it), so strip
    // the secret ?token= before returning it — fetch() re-resolves the real
    // URL from the entry, so redaction here is safe.
    return apiUrl ? { url: redactToken(apiUrl) } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`comeet: cannot derive API URL for ${entry.name} (set api: to the full careers-api positions URL)`);
    assertComeetUrl(apiUrl);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertComeetUrl above it guarantees the final hostname stays www.comeet.co.
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return parseComeetResponse(json, entry.name);
  },
};

/**
 * Parse a Comeet careers-api positions response. Exported for unit tests.
 *
 * Comeet returns a top-level ARRAY of position objects:
 *   [{ name, location: { name, is_remote }, url_active_page,
 *      url_comeet_hosted_page, time_updated, ... }]
 *
 * - url: prefer `url_active_page` (the tenant's live careers page), fall back to
 *   `url_comeet_hosted_page` (the Comeet-hosted page). Both are public, display-
 *   only URLs (recorded in the pipeline/history, never server-fetched here), so
 *   they are NOT host-locked. Require a well-formed https: URL; a position whose
 *   URL is missing/non-https/malformed is dropped (url is the dedup key).
 * - location: `location.name`, appending "Remote" when `location.is_remote`.
 *
 * @param {any} json
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseComeetResponse(json, companyName) {
  const positions = Array.isArray(json) ? json : [];
  return positions
    .map(row => {
      // Coerce each row to a safe object so null / non-object members can't throw.
      const j = (row && typeof row === 'object') ? row : {};
      // Resolve a display-only https URL; drop the position if none is usable.
      let url = '';
      const rawUrl = j.url_active_page || j.url_comeet_hosted_page || '';
      if (typeof rawUrl === 'string' && rawUrl) {
        try {
          const parsed = new URL(rawUrl);
          if (parsed.protocol === 'https:') url = parsed.href;
        } catch {
          // malformed URL → leave url = ''
        }
      }

      const loc = j.location || {};
      const remote = loc.is_remote ? 'Remote' : '';
      const base = (typeof loc.name === 'string' && loc.name.trim()) ? loc.name.trim() : '';
      // Append "Remote" only when the base location doesn't already say so.
      const location = remote && !/remote/i.test(base)
        ? [base, remote].filter(Boolean).join(', ')
        : base;

      return {
        title: (typeof j.name === 'string' ? j.name.trim() : ''),
        url,
        location,
        company: companyName,
        postedAt: toEpochMs(j.time_updated),
      };
    })
    .filter(job => job.title && job.url);
}
