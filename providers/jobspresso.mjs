// @ts-check
import { parseWpJobFeedItems, wpJobFeedItems } from './_wp-job-feed.mjs';
/** @typedef {import('./_types.js').Provider} Provider */

// Jobspresso provider — RETIRED (#5774, 2026-11-05). The feed this provider
// read (https://jobspresso.co/?feed=job_feed) is disallowed by jobspresso.co's
// own robots.txt: `Disallow: /*?` under `User-agent: *` covers every URL with
// a query string. Under rule 6 of the Source Indexing Policy (CONTRIBUTING.md)
// a Disallow that covers the path a provider fetches is a stop, the same case
// as Lagou. This is not a provider to repair
// unless the operator grants permission, which would go in
// docs/SOURCE_INDEXING_LOG.md.
//
// fetch() below throws immediately with that explanation and makes no
// request. detect() still matches `provider: jobspresso` on purpose, so the
// message reaches anyone who still has an entry instead of a silent "no
// provider matched" — remove it from portals.yml once seen. See
// docs/SUPPORTED_JOB_BOARDS.md.
//
// parseJobspressoFeed() is kept (and still unit-tested, including by
// tests/providers/rss-entity-decoding.test.mjs) as a record of the feed's
// shape; it is dead code today since fetch() never reaches it. The item
// parsing it wraps lives on in providers/_wp-job-feed.mjs, which
// providers/wp-job-manager.mjs uses for other boards on the same plugin.

const FEED_URL = 'https://jobspresso.co/?feed=job_feed';
const TRUSTED_HOST = 'jobspresso.co';

// The retirement message thrown by fetch() below — also asserted in
// tests/providers/jobspresso.test.mjs, so update both together.
const RETIRED_MESSAGE =
  'jobspresso: jobspresso.co\'s robots.txt disallows the feed this provider read — ' +
  '`Disallow: /*?` under `User-agent: *` covers /?feed=job_feed (#5774). ' +
  'This provider is retired, not broken-and-fixable: remove `provider: jobspresso` from ' +
  'portals.yml. See docs/SUPPORTED_JOB_BOARDS.md.';

/** @type {Provider} */
export default {
  id: "jobspresso",

  detect(entry) {
    return entry?.provider === "jobspresso" ? { url: FEED_URL } : null;
  },

  async fetch() {
    // Deliberately no network call: the site's robots.txt disallows the feed
    // (see the file header), and career-ops honours it. Throwing immediately,
    // with a message naming the cause, tells a user what to do with the entry.
    throw new Error(RETIRED_MESSAGE);
  },
};

/** Validate a feed URL: https + jobspresso.co (or subdomain) only, else ''. */
function cleanUrl(value) {
  if (!value) return "";
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const trusted = host === TRUSTED_HOST || host.endsWith(`.${TRUSTED_HOST}`);
    return parsed.protocol === "https:" && trusted ? parsed.href : "";
  } catch {
    return "";
  }
}

/**
 * Parse Jobspresso's public WordPress jobs feed.
 *
 * Shape:
 * <rss><channel><item>...</item></channel></rss>
 *
 * Each item contains:
 * - title
 * - link
 * - pubDate
 * - job_listing:company
 * - job_listing:location
 *
 * The RSS link is used as the dedup key.
 * @param {string} xml - raw RSS feed body
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseJobspressoFeed(xml) {
  if (typeof xml !== "string") return [];
  return parseWpJobFeedItems(wpJobFeedItems(xml), cleanUrl);
}
