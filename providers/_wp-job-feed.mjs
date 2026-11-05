// @ts-check
// Shared item parser for the RSS feed WP Job Manager (a WordPress jobs plugin)
// serves at `/?feed=job_feed`. Used by `jobspresso.mjs` (one fixed board) and
// `wp-job-manager.mjs` (any board on the plugin). The `_` prefix keeps
// `_registry.mjs` from loading this file as a provider.
//
// Each <item> carries <title>, <link>, <pubDate> and the plugin's own
// <job_listing:company> / <job_listing:location>. The feed is small, flat XML,
// so a tag extractor is enough; no XML dependency.
import { decodeEntities } from './_html-entities.mjs';

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
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
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

    jobs.push({
      title,
      company,
      location,
      url,
      postedAt: toEpochMs(tagText(item, "pubDate")),
    });
  }
  return jobs;
}
