// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { htmlToText } from './_html-to-text.mjs';

// RemoteOK provider — board-wide aggregator feed (https://remoteok.com/api).
// Returns the latest ~100 remote postings as a JSON array; index 0 is a
// {last_updated, legal} metadata object and is skipped. scan.mjs applies the
// configured title_filter / location_filter to the returned rows.
//
// Wire in via a `job_boards:` entry with `provider: remoteok`.
// RemoteOK API ToS asks for a follow link-back when republishing — N/A for
// private scanning, but don't redistribute this feed publicly without it.

const FEED_URL = 'https://remoteok.com/api';
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Repair UTF-8 bytes that the feed exposed as Latin-1 code points. */
function repairFeedText(value) {
  if (!/[\u00c2-\u00f4][\u0080-\u00bf]/u.test(value) || /[^\u0000-\u00ff]/u.test(value)) return value;
  try {
    return utf8Decoder.decode(Buffer.from(value, 'latin1'));
  } catch {
    // A genuine Latin-1 character elsewhere in the value can make the bytes
    // invalid UTF-8. Leave the entire value intact in that case.
    return value;
  }
}

/** Epoch ms for a feed date string, or undefined when absent or unparseable. */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value.trim());
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * A salary bound, or undefined. Only a number or a numeric string counts; a
 * boolean, array or object gives no value. The feed gives 0 when a posting has no salary,
 * and 0 is no value.
 * @param {unknown} value
 */
function salaryBound(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** @type {Provider} */
export default {
  id: 'remoteok',

  /**
   * Fetches and normalizes postings from the RemoteOK public feed.
   * @param {{ name?: string }} entry - The job_boards entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number}>>}
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
      .map(j => {
        const company = typeof j.company === 'string' ? repairFeedText(j.company).trim() : '';
        const job = {
          title: repairFeedText(j.position).trim(),
          url: j.url.trim(),
          company: company || entry.name || 'RemoteOK',
          location: typeof j.location === 'string' ? repairFeedText(j.location).trim() : '',
        };
        // `date` is ISO 8601 with an offset; without it max_posting_age_days
        // can't judge the row.
        const postedAt = toEpochMs(j.date);
        if (postedAt !== undefined) job.postedAt = postedAt;
        // `salary_min` / `salary_max` are USD per year, and 0 when the poster
        // gave none. A one-sided range fills the other bound, as ashby.mjs does.
        const lo = salaryBound(j.salary_min);
        const hi = salaryBound(j.salary_max);
        if (lo !== undefined || hi !== undefined) {
          job.salary = {
            min: Math.min(lo ?? hi, hi ?? lo),
            max: Math.max(lo ?? hi, hi ?? lo),
            currency: 'USD',
            period: 'year',
            posted: { ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}) },
          };
        }
        // Every row carries the posting's HTML in `description`, so it costs no
        // request. content_filter, country_eligibility_filter and visa_filter
        // read it, and formatScanHistoryRow() fingerprints it. Omitted when the
        // text is empty, the "no signal" path each of those filters handles.
        if (typeof j.description === 'string') {
          const description = htmlToText(repairFeedText(j.description));
          if (description) job.description = description;
        }
        return job;
      })
      .filter(job => job.title !== '');
  },
};
