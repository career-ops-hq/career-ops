// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Recruitee provider — hits the public per-tenant offers API.
// Auto-detects from careers_url pattern `https://<slug>.recruitee.com`.
// Per-tenant subdomains are the variable part — SSRF defence uses a
// regex match on `<safe-slug>.recruitee.com` rather than a static
// allowlist.

const RECRUITEE_HOST_RE = /^[a-z0-9][a-z0-9-]*\.recruitee\.com$/;

function assertRecruiteeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`recruitee: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`recruitee: URL must use HTTPS: ${url}`);
  if (!RECRUITEE_HOST_RE.test(parsed.hostname)) {
    throw new Error(`recruitee: untrusted hostname "${parsed.hostname}" — must match <slug>.recruitee.com`);
  }
  return url;
}

function resolveApiUrl(entry) {
  const raw = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!RECRUITEE_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}/api/offers/`;
}

/** @type {Provider} */
export default {
  id: 'recruitee',

  detect(entry) {
    const apiUrl = resolveApiUrl(entry);
    return apiUrl ? { url: apiUrl } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`recruitee: cannot derive API URL for ${entry.name}`);
    assertRecruiteeUrl(apiUrl);
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error' });
    return parseRecruiteeResponse(json, entry.name);
  },
};

/**
 * Parse a Recruitee /api/offers/ response. Exported for unit tests.
 *
 * Recruitee returns:
 *   { offers: [{ title, careers_url?, url?, city?, country?, remote?, location? }] }
 *
 * - url: prefer `careers_url`, fall back to `url`; validated against
 *   `https://<safe-slug>.recruitee.com` — an off-domain or non-HTTPS URL is
 *   dropped (empty string returned per the Job contract).
 * - location: prefer the explicit `location` field; else assemble from
 *   city/country, appending "Remote" when `remote` is true.
 *
 * @param {any} json
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseRecruiteeResponse(json, companyName) {
  const offers = json?.offers;
  if (!Array.isArray(offers)) return [];
  return offers.map(j => {
    const city = j.city || '';
    const country = j.country || '';
    const remote = j.remote ? 'Remote' : '';
    const location = j.location || [city, country, remote].filter(Boolean).join(', ');

    // Validate offer URL: must parse as https://<safe-slug>.recruitee.com/...
    let url = '';
    const rawUrl = j.careers_url || j.url || '';
    if (typeof rawUrl === 'string' && rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:' && RECRUITEE_HOST_RE.test(parsed.hostname)) {
          url = parsed.href;
        }
      } catch {
        // malformed URL → leave url = ''
      }
    }

    return {
      title: j.title || '',
      url,
      location,
      company: companyName,
    };
  });
}
