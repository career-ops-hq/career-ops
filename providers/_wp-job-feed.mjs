// @ts-check
// Shared item parser for the RSS feed WP Job Manager (a WordPress jobs plugin)
// serves at `/?feed=job_feed`. Used by `jobspresso.mjs` (one fixed board) and
// `wp-job-manager.mjs` (any board on the plugin). The `_` prefix keeps
// `_registry.mjs` from loading this file as a provider.
//
// Each <item> carries <title>, <link>, <pubDate> and the plugin's own
// <job_listing:company> / <job_listing:location>, plus WordPress's
// <description> (an excerpt) and <content:encoded> (the full post). The feed
// is flat XML, so a tag extractor is enough; no XML dependency.
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';

/** @typedef {{title: string, url: string, company: string, location: string, postedAt?: number, description?: string}} WpJobFeedJob */

// NaN-safe Date.parse - `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Resolve a tag's inner text: unwrap a CDATA section, else decode entities.
function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeEntities(inner).trim();
}

// Extract the text of the first <tag>...</tag> in a block. Returns '' when absent.
function tagText(block, tag) {
  const m = block.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"),
  );
  return m ? extractText(m[1]) : "";
}

/** @param {string} xml @returns {string[]} the raw `<item>` blocks */
export function wpJobFeedItems(xml) {
  return xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
}

/**
 * Map the feed's `<item>` blocks to jobs. An item whose link `resolveUrl`
 * rejects (returns '') or that has no title is skipped.
 * @param {string[]} blocks - from wpJobFeedItems()
 * @param {(raw: string) => string} resolveUrl - validated absolute URL, or ''
 * @returns {WpJobFeedJob[]}
 */
export function parseWpJobFeedItems(blocks, resolveUrl) {
  const jobs = [];
  for (const item of blocks) {
    const url = resolveUrl(tagText(item, "link"));
    if (!url) continue;

    const title = tagText(item, "title");
    if (!title) continue;
    const company = tagText(item, "job_listing:company") || "";
    const location = tagText(item, "job_listing:location");

    /** @type {WpJobFeedJob} */
    const job = {
      title,
      company,
      location,
      url,
      postedAt: toEpochMs(tagText(item, "pubDate")),
    };
    // The full post is in this same feed, so it costs no request.
    // content_filter, country_eligibility_filter and visa_filter read it, and
    // formatScanHistoryRow() fingerprints it. <description> is not a fallback:
    // WordPress fills it with an excerpt (the post's first 55 words by
    // default), and content_filter drops a posting whose text lacks a required
    // keyword while it passes one with no text, so an excerpt would drop
    // postings that name the keyword further down. Omitted when no text
    // remains, the "no signal" path each of those filters handles.
    const description = htmlToText(tagText(item, "content:encoded"));
    if (description) job.description = description;
    jobs.push(job);
  }
  return jobs;
}
