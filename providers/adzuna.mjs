// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Adzuna provider — job search aggregator API (api.adzuna.com)
// Wire in via a `job_boards:` entry with `provider: adzuna` or explicit parameters.

/** @type {Provider} */
export default {
  id: 'adzuna',

  detect(entry) {
    return entry?.provider === 'adzuna' ? { url: 'https://api.adzuna.com' } : null;
  },

  /**
   * Fetches and normalizes postings from the Adzuna API.
   * @param {{ name?: string, country?: string, query?: string, page?: number }} entry - The entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;

    if (!appId || !appKey) {
      console.warn(`[adzuna] ADZUNA_APP_ID or ADZUNA_APP_KEY not set. Skipping Adzuna fetch.`);
      return [];
    }

    const country = (entry.country || 'us').toLowerCase();
    const page = entry.page || 1;
    const query = entry.query ? encodeURIComponent(entry.query) : 'software engineer';
    
    const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?app_id=${appId}&app_key=${appKey}&results_per_page=50&what=${query}`;

    const json = await ctx.fetchJson(url, { redirect: 'error' });
    return parseAdzunaResponse(json, entry.name || 'Adzuna');
  },
};

/**
 * Parse an Adzuna API response. Exported for unit tests.
 *
 * @param {any} json - Raw response payload.
 * @param {string} defaultCompany - Fallback company name.
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function parseAdzunaResponse(json, defaultCompany = 'Adzuna') {
  if (!json || !Array.isArray(json.results)) return [];

  const toEpochMs = (value) => {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return json.results
    .map(j => {
      if (!j || typeof j !== 'object') return null;

      const title = typeof j.title === 'string' ? j.title.trim() : '';
      if (!title) return null;

      const rawUrl = typeof j.redirect_url === 'string' ? j.redirect_url.trim() : '';
      let url = null;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          url = parsed.href;
        }
      } catch {
        // Invalid URL
      }
      if (!url) return null;

      const companyName = j.company && typeof j.company.display_name === 'string' ? j.company.display_name.trim() : '';
      const company = companyName || defaultCompany;

      const locationName = j.location && typeof j.location.display_name === 'string' ? j.location.display_name.trim() : '';
      const location = locationName || '';

      const description = typeof j.description === 'string' ? j.description.trim() : undefined;
      const postedAt = toEpochMs(j.created);

      return {
        title,
        url,
        company,
        location,
        description,
        postedAt
      };
    })
    .filter(j => j !== null);
}
