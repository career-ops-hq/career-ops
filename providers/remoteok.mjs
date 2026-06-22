// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// RemoteOK provider — board-wide aggregator feed (https://remoteok.com/api).
// Returns the latest ~100 remote postings as a JSON array; index 0 is a
// {last_updated, legal} metadata object and is skipped. scan.mjs applies the
// configured title_filter / location_filter to the returned rows.
//
// Wire in via a `job_boards:` entry with `provider: remoteok`.
// RemoteOK API ToS asks for a follow link-back when republishing — N/A for
// private scanning, but don't redistribute this feed publicly without it.

const FEED_URL = 'https://remoteok.com/api';

/** @type {Provider} */
export default {
  id: 'remoteok',

  /**
   * Fetches and normalizes postings from the RemoteOK public feed.
   * @param {{ name?: string }} entry - The job_boards entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string}>>}
   */
  async fetch(entry, ctx) {
    // redirect:'error' prevents SSRF via server-side redirects
    const data = await ctx.fetchJson(FEED_URL, { redirect: 'error' });
    if (!Array.isArray(data)) {
      throw new Error(`remoteok: unexpected API response — expected a JSON array, got ${data === null ? 'null' : typeof data}`);
    }

    return data
      .filter(j => j && typeof j === 'object'
        && typeof j.position === 'string' && j.position.trim() !== ''
        && typeof j.url === 'string' && /^https?:\/\//i.test(j.url.trim()))
      .map(j => ({
        title: j.position.trim(),
        url: j.url.trim(),
        company: typeof j.company === 'string' && j.company.trim() ? j.company.trim() : (entry.name || 'RemoteOK'),
        location: typeof j.location === 'string' ? j.location.trim() : '',
      }));
  },
};
