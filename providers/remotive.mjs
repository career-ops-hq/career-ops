// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Remotive provider — board-wide aggregator feed
// (https://remotive.com/api/remote-jobs). Returns { jobs: [...] }. The full
// feed (no ?search=) is fetched so scan.mjs's title_filter can gate on the
// configured AI/ML titles; the feed's own ?search= is too narrow (a substring
// match that misses e.g. "ML Engineer").
//
// Wire in via a `job_boards:` entry with `provider: remotive`.

const FEED_URL = 'https://remotive.com/api/remote-jobs';

/**
 * Epoch ms for `publication_date`, or undefined when absent or unparseable.
 * The feed writes it with no offset (2026-10-27T12:56:13), which Date.parse
 * reads as the machine's local time. Read it as UTC instead, so the same row
 * gets the same age on every machine; a few hours either way doesn't move a
 * max_posting_age_days cut.
 */
export function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const v = value.trim();
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(v);
  const parsed = Date.parse(/T\d/.test(v) && !hasOffset ? `${v}Z` : v);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @type {Provider} */
export default {
  id: 'remotive',

  /**
   * Fetches and normalizes postings from the Remotive public feed.
   * @param {{ name?: string }} entry - The job_boards entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    // redirect:'error' prevents SSRF via server-side redirects
    const json = await ctx.fetchJson(FEED_URL, { redirect: 'error' });
    if (!json || !Array.isArray(json.jobs)) {
      throw new Error(`remotive: unexpected API response — expected { jobs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
    }

    return json.jobs
      .filter(j => j && typeof j === 'object'
        && typeof j.title === 'string' && j.title.trim() !== ''
        && typeof j.url === 'string' && /^https?:\/\//i.test(j.url.trim()))
      .map(j => {
        const job = {
          title: j.title.trim(),
          url: j.url.trim(),
          company: typeof j.company_name === 'string' && j.company_name.trim() ? j.company_name.trim() : (entry.name || 'Remotive'),
          location: typeof j.candidate_required_location === 'string' ? j.candidate_required_location.trim() : '',
        };
        const postedAt = toEpochMs(j.publication_date);
        if (postedAt !== undefined) job.postedAt = postedAt;
        return job;
      });
  },
};
