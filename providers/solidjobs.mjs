// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// SolidJobs provider — hits the public offers API.
// Auto-detects from careers_url pattern `https://solid.jobs/public-api/offers/<division>`.
//
// Available divisions: it, engineering, marketing, sales, hr, logistics, finances, other
// API docs: https://solid.jobs/public-api/offers/{division}?campaign={campaign}

const ALLOWED_HOSTS = new Set(['solid.jobs']);

/**
 * Validates that the provided URL is a trusted SolidJobs API endpoint.
 * Enforces HTTPS protocol, strict hostname matching, and required path prefix.
 * 
 * @param {string} url - The URL string to validate.
 * @returns {string} The validated URL string.
 * @throws {Error} If the URL is malformed, uses non-HTTPS, has an untrusted host, or wrong path.
 */
function assertUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`solidjobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`solidjobs: URL must use HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname))
    throw new Error(`solidjobs: untrusted hostname "${parsed.hostname}" — must be solid.jobs`);
  if (!parsed.pathname.startsWith('/public-api/offers/'))
    throw new Error(`solidjobs: URL path must start with /public-api/offers/: ${url}`);
  return url;
}

/** @type {Provider} */
export default {
  id: 'solidjobs',

  /**
   * Attempts to detect if the provider can handle the given entry by checking the careers_url.
   * * @param {{ careers_url?: string, name?: string }} entry - The configuration entry.
   * @returns {{url: string} | null} An object with the matched URL, or null if not matched.
   */
  detect(entry) {
    const url = entry.careers_url || '';
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'solid.jobs' && parsed.pathname.startsWith('/public-api/offers/'))
        return { url };
    } catch {}
    return null;
  },
  
  /**
   * Fetches and normalizes job offers from the SolidJobs public API.
   * * @param {{ careers_url?: string, name: string }} entry - The configuration entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string}>>} Array of parsed job offers.
   */
  async fetch(entry, ctx) {
    const url = entry.careers_url;
    if (!url) throw new Error('solidjobs: careers_url required');
    assertUrl(url);
    // redirect:'error' prevents SSRF via server-side redirects
    const json = await ctx.fetchJson(url, { redirect: 'error' });
    if (!json || !Array.isArray(json.jobs)) {
      throw new Error(`solidjobs: unexpected API response — expected { jobs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
    }

    /** @type {Array<{ title?: string, url?: string, company?: string, locations?: string | string[] }>} */
    const jobs = json.jobs;

    return jobs
      .filter(j => j && typeof j === 'object' && typeof j.url === 'string' && j.url.trim() !== '')
      .map(j => ({
        title: j.title || '',
        url: /** @type {string} */ (j.url || '').trim(),
        company: j.company || entry.name,
        location: Array.isArray(j.locations) ? j.locations.join(', ') : (typeof j.locations === 'string' ? j.locations : ''),
      }));
  },
};
