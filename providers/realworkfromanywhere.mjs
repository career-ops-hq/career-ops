// @ts-check
import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry } from './_http.mjs';
/** @typedef {import('./_types.js').Provider} Provider */

// Real Work From Anywhere provider — https://www.realworkfromanywhere.com, a
// board that lists only roles a candidate can do from any country. Target
// list: `job_boards:` (one board, many employers). Wire it in with an
// explicit entry:
//
//   job_boards:
//     - name: Real Work From Anywhere
//       provider: realworkfromanywhere
//
// Reads the board-wide public RSS feed at
// https://www.realworkfromanywhere.com/rss.xml (no auth, rolling window of
// roughly the last 30 days — 127 items on 2026-10-28), parsed in-process with
// the same tiny tag extractor as providers/larajobs.mjs.
//
// Each <item> carries <title> ("{Role} at {Company}"), <link> (the board's
// own posting page), <pubDate>, and <author> holding the company name, so the
// company comes from a dedicated field and the " at {Company}" suffix is
// stripped from the title only when it matches that field exactly. The feed
// has no location field: the board's premise is "work from anywhere", but
// that is not written per posting, so `location` stays empty rather than
// being invented.
//
// Many postings mirror the employer's own ATS posting (the board page links
// out to it), but the feed carries no employer URL, so the board page is
// `Job.url` (Source Indexing Policy rule 2 fallback).
//
// robots.txt (rule 6): `User-agent: *` allows everything except `/go/` (the
// outbound-click redirect), which this provider never requests.

const FEED_URL = 'https://www.realworkfromanywhere.com/rss.xml';
const HOST = 'www.realworkfromanywhere.com';

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
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

// Keep only absolute HTTPS posting links on the board's own host.
function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') return '';
    if (parsed.hostname.toLowerCase() !== HOST) return '';
    if (!parsed.pathname.startsWith('/jobs/')) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Drop a trailing " at {company}" from the title when it names exactly the
 * company the feed's <author> field carries.
 * @param {string} rawTitle
 * @param {string} company
 */
function stripCompanySuffix(rawTitle, company) {
  if (!company) return rawTitle;
  const suffix = ` at ${company}`;
  if (rawTitle.length > suffix.length && rawTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
    return rawTitle.slice(0, -suffix.length).trim();
  }
  return rawTitle;
}

/**
 * Parse Real Work From Anywhere's RSS feed. Exported for unit tests.
 *
 * A body with no `<rss>`/`<channel>` element is not the feed (an error or
 * challenge page) and throws; a well-formed channel with no `<item>` is an
 * empty board and returns `[]`. Items without a usable link or title are
 * dropped.
 *
 * @param {string} xml - raw RSS feed body
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseRwfaFeed(xml) {
  if (typeof xml !== 'string' || !/<rss\b[\s\S]*<channel\b/i.test(xml)) {
    const got = typeof xml === 'string' ? `${xml.length} chars without <rss><channel>` : typeof xml;
    throw new Error(`realworkfromanywhere: unexpected response — expected an RSS feed, got: ${got}`);
  }
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;

    const company = tagText(item, 'author');
    const title = stripCompanySuffix(tagText(item, 'title'), company);
    if (!title) continue;

    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = { title, url, company, location: '' };
    const postedAt = toEpochMs(tagText(item, 'pubDate'));
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'realworkfromanywhere',

  detect(entry) {
    return entry?.provider === 'realworkfromanywhere' ? { url: FEED_URL } : null;
  },

  async fetch(_entry, ctx) {
    // Fixed literal host, HTTPS; redirect:'error' keeps the request pinned to it.
    const text = await fetchTextWithRetry(ctx, FEED_URL, { redirect: 'error', timeoutMs: 30_000 });
    return parseRwfaFeed(text);
  },
};
