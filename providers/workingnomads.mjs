// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Working Nomads provider — board-wide aggregator feed
// (https://www.workingnomads.com/api/exposed_jobs/). Returns a JSON array of
// postings; scan.mjs applies the configured title_filter / location_filter.
//
// Wire in via a `job_boards:` entry with `provider: workingnomads`.

const FEED_URL = 'https://www.workingnomads.com/api/exposed_jobs/';

/** @type {Provider} */
export default {
  id: 'workingnomads',

  /**
   * Fetches and normalizes postings from the Working Nomads public feed.
   * @param {{ name?: string }} entry - The job_boards entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string}>>}
   */
  async fetch(entry, ctx) {
    // redirect:'error' prevents SSRF via server-side redirects
    const data = await ctx.fetchJson(FEED_URL, { redirect: 'error' });
    if (!Array.isArray(data)) {
      throw new Error(`workingnomads: unexpected API response — expected a JSON array, got ${data === null ? 'null' : typeof data}`);
    }

    return data
      .filter(j => j && typeof j === 'object'
        && typeof j.title === 'string' && j.title.trim() !== ''
        && typeof j.url === 'string' && /^https?:\/\//i.test(j.url.trim()))
      .map(j => ({
        title: j.title.trim(),
        url: j.url.trim(),
        company: typeof j.company_name === 'string' && j.company_name.trim() ? j.company_name.trim() : (entry.name || 'Working Nomads'),
        location: typeof j.location === 'string' ? j.location.trim() : '',
      }));
  },
};
