// @ts-check
import { parseWpJobFeedItems, wpJobFeedItems } from './_wp-job-feed.mjs';
/** @typedef {import('./_types.js').Provider} Provider */

// Jobspresso provider - public WordPress jobs feed
// (https://jobspresso.co/?feed=job_feed). The feed is public, no-auth,
// and XML, so it is parsed in-process with the same tiny tag extractor
// approach as providers/personio.mjs rather than adding an XML dependency.
// The item parsing is shared with providers/wp-job-manager.mjs, the generic
// provider for any board on the same plugin (providers/_wp-job-feed.mjs).
//
// Wire in via a `job_boards:` entry with `provider: jobspresso`.

const FEED_URL = 'https://jobspresso.co/?feed=job_feed';
const TRUSTED_HOST = 'jobspresso.co';

/** @param {string} url */
function assertJobspressoUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobspresso: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:")
    throw new Error(`jobspresso: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(
      `jobspresso: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`,
    );
  }
  return url;
}

/** @type {Provider} */
export default {
  id: "jobspresso",

  detect(entry) {
    return entry?.provider === "jobspresso" ? { url: FEED_URL } : null;
  },

  async fetch(_entry, ctx) {
    const feedUrl = assertJobspressoUrl(FEED_URL);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertJobspressoUrl above it keeps the request pinned to jobspresso.co.
    const text = await ctx.fetchText(feedUrl, { redirect: "error" });
    return parseJobspressoFeed(text);
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
