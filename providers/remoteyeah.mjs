// @ts-check
import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry } from './_http.mjs';
/** @typedef {import('./_types.js').Provider} Provider */

// RemoteYeah provider — https://remoteyeah.com, a remote-only jobs board.
// Target list: `job_boards:` (one board, many employers). Wire it in with an
// explicit entry:
//
//   job_boards:
//     - name: RemoteYeah
//       provider: remoteyeah
//
// Reads the board-wide public RSS feed at https://remoteyeah.com/rss.xml (no
// auth; the newest postings, about three days' worth — 285 items on
// 2026-10-28 — so a scan every couple of days sees every new posting). Parsed
// in-process with the same tiny tag extractor as providers/larajobs.mjs.
//
// Each <item> carries dedicated <company>, <location> and ISO <pubDate>
// fields, so company and location are never derived from the title. The
// title is "Remote {Role} at {Company}": the board prefixes "Remote " to every
// title and appends the company. Both are removed only when provably added —
// the " at {Company}" suffix when it names exactly the <company> field, and
// the "Remote " prefix when the posting slug is "remote-" + <guid> (the guid
// is the slug of the role's own title, so a genuine "Remote Sensing Engineer"
// keeps its first word).
//
// The <link> carries `utm_source` / `ref` tracking params; they are dropped so
// the URL — the dedup key — is stable. The board aggregates postings that
// also live on the employer's ATS, but the feed carries no employer URL, so
// the board page is `Job.url` (Source Indexing Policy rule 2 fallback).
//
// robots.txt (rule 6): `User-agent: *` with an empty `Disallow:` — nothing
// is disallowed.

const FEED_URL = 'https://remoteyeah.com/rss.xml';
const HOST = 'remoteyeah.com';

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

/**
 * Keep only an absolute HTTPS posting link on the board's host, without its
 * query string or fragment. Returns the URL and the posting slug.
 * @param {string} value
 * @returns {{ url: string, slug: string } | null}
 */
function cleanUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname.toLowerCase() !== HOST) return null;
    const m = /^\/jobs\/([^/]+)\/?$/.exec(parsed.pathname);
    if (!m) return null;
    parsed.search = '';
    parsed.hash = '';
    return { url: parsed.href, slug: m[1] };
  } catch {
    return null;
  }
}

/**
 * Undo the board's own title decoration (see the header comment).
 * @param {string} rawTitle
 * @param {string} company
 * @param {string} slug - posting slug from the link
 * @param {string} guid - the item's <guid>
 */
export function cleanRemoteYeahTitle(rawTitle, company, slug, guid) {
  let title = rawTitle.replace(/\s+/g, ' ').trim();
  if (company) {
    const suffix = ` at ${company}`;
    if (title.length > suffix.length && title.toLowerCase().endsWith(suffix.toLowerCase())) {
      title = title.slice(0, -suffix.length).trim();
    }
  }
  if (guid && slug === `remote-${guid}` && /^remote\s+/i.test(title)) {
    const rest = title.replace(/^remote\s+/i, '');
    if (rest) title = rest;
  }
  return title;
}

/**
 * Parse RemoteYeah's RSS feed. Exported for unit tests.
 *
 * A body with no `<rss>`/`<channel>` element is not the feed (an error or
 * challenge page) and throws; a well-formed channel with no `<item>` is an
 * empty board and returns `[]`. Items without a usable link or title are
 * dropped.
 *
 * @param {string} xml - raw RSS feed body
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseRemoteYeahFeed(xml) {
  if (typeof xml !== 'string' || !/<rss\b[\s\S]*<channel\b/i.test(xml)) {
    const got = typeof xml === 'string' ? `${xml.length} chars without <rss><channel>` : typeof xml;
    throw new Error(`remoteyeah: unexpected response — expected an RSS feed, got: ${got}`);
  }
  const jobs = [];
  const seen = new Set();
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const link = cleanUrl(tagText(item, 'link'));
    if (!link || seen.has(link.url)) continue;

    const company = tagText(item, 'company');
    const title = cleanRemoteYeahTitle(tagText(item, 'title'), company, link.slug, tagText(item, 'guid'));
    if (!title) continue;
    seen.add(link.url);

    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = { title, url: link.url, company, location: tagText(item, 'location') };
    const postedAt = toEpochMs(tagText(item, 'pubDate'));
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'remoteyeah',

  detect(entry) {
    return entry?.provider === 'remoteyeah' ? { url: FEED_URL } : null;
  },

  async fetch(_entry, ctx) {
    // Fixed literal host, HTTPS; redirect:'error' keeps the request pinned to it.
    const text = await fetchTextWithRetry(ctx, FEED_URL, { redirect: 'error', timeoutMs: 30_000 });
    return parseRemoteYeahFeed(text);
  },
};
