// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JSearch provider — RapidAPI job search engine (jsearch.p.rapidapi.com)
// Wire in via a `job_boards:` entry with `provider: jsearch`.

const API_HOST = 'jsearch.p.rapidapi.com';
const API_URL = `https://${API_HOST}/search`;

/** @type {Provider} */
export default {
  id: 'jsearch',

  detect(entry) {
    return entry?.provider === 'jsearch' ? { url: API_URL } : null;
  },

  /**
   * Fetches and normalizes postings from the JSearch API.
   * @param {{ name?: string, query?: string, page?: number, num_pages?: number }} entry - The entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { headers?: Record<string, string>, redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const apiKey = process.env.JSEARCH_API_KEY || process.env.RAPIDAPI_KEY;

    if (!apiKey) {
      console.warn(`[jsearch] JSEARCH_API_KEY or RAPIDAPI_KEY not set. Skipping JSearch fetch.`);
      return [];
    }

    const query = entry.query || 'software engineer';
    const page = entry.page || 1;
    const numPages = entry.num_pages || 1;

    const url = `${API_URL}?query=${encodeURIComponent(query)}&page=${page}&num_pages=${numPages}`;

    const json = await ctx.fetchJson(url, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': API_HOST,
      },
      redirect: 'error',
    });

    return parseJSearchResponse(json, entry.name || 'JSearch');
  },
};

/**
 * Parse a JSearch API response. Exported for unit tests.
 *
 * @param {any} json - Raw response payload.
 * @param {string} defaultCompany - Fallback company name.
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>}
 */
export function parseJSearchResponse(json, defaultCompany = 'JSearch') {
  if (!json || !Array.isArray(json.data)) return [];

  const toEpochMs = (value) => {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return json.data
    .map(j => {
      if (!j || typeof j !== 'object') return null;

      const title = typeof j.job_title === 'string' ? j.job_title.trim() : '';
      if (!title) return null;

      const rawUrl = typeof j.job_apply_link === 'string' && j.job_apply_link.trim()
        ? j.job_apply_link.trim()
        : (typeof j.job_google_link === 'string' ? j.job_google_link.trim() : '');

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

      const company = typeof j.employer_name === 'string' && j.employer_name.trim()
        ? j.employer_name.trim()
        : defaultCompany;

      const locParts = [j.job_city, j.job_state, j.job_country].filter(p => typeof p === 'string' && p.trim());
      let location = locParts.join(', ');
      if (j.job_is_remote) {
        location = location ? `Remote (${location})` : 'Remote';
      }

      const description = typeof j.job_description === 'string' ? j.job_description.trim() : undefined;
      const postedAt = toEpochMs(j.job_posted_at_datetime_utc) || (j.job_posted_at_timestamp ? j.job_posted_at_timestamp * 1000 : undefined);

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
