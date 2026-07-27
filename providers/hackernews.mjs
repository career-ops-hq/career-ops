// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Hacker News "Ask HN: Who is hiring?" provider — no auth required.
//
// Algorithm:
//   1. Find the current monthly hiring thread via the Algolia HN search API
//      (search_by_date, tags=story, query="Ask HN Who is hiring").
//   2. Fetch the thread's item from the Algolia items API; top-level `children`
//      are individual job posts left as top-level comments.
//   3. Parse each comment: the first non-empty line is treated as the title/header
//      (many follow "Company | Role | Location | URL" but this is free-form, so
//      we extract defensively — a URL is pulled out wherever it appears; the
//      first line becomes the title; company/location are left empty when the
//      format doesn't match the pipe-delimited convention).
//
// Wire in via a `job_boards:` entry with `provider: hackernews`.

const SEARCH_URL =
  'https://hn.algolia.com/api/v1/search_by_date?tags=story&query=Ask%20HN%20Who%20is%20hiring&hitsPerPage=5';

/** @param {string} id */
function itemUrl(id) {
  return `https://hn.algolia.com/api/v1/items/${id}`;
}

/**
 * Scan raw text for the first absolute http/https URL. Returns '' if none found.
 * @param {string} text
 */
function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s<>"')]+/);
  return m ? m[0].replace(/[.,;!?)]+$/, '') : '';
}

// Named HTML entities we decode in comment bodies. Kept in single map
/** @type {Record<string, string>} */
const ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};
const ENTITY_RE = /&amp;|&lt;|&gt;|&quot;|&#x27;|&#39;|&nbsp;/g;

/**
 * Parse a single HN comment text into a normalized job object.
 * The canonical format is "Company | Role | Location | URL" on the first line,
 * but posts are free-form — we only guarantee title (first line) and url (first
 * URL found anywhere in the text). company and location are extracted from the
 * pipe-delimited header when present; left empty otherwise.
 *
 * Exported for unit testing.
 *
 * @param {string} text  Raw comment text (may contain HTML; tags are stripped).
 * @param {string} threadUrl  Fallback url (the HN thread) if no URL in comment.
 * @returns {{ title: string, url: string, company: string, location: string } | null}
 *   null when the comment is empty, deleted, or carries no usable title.
 */
export function parseHnComment(text, threadUrl = '') {
  if (!text || typeof text !== 'string') return null;

  // Strip HTML. Anchors: keep the href value in place so URL extraction works.
  // Block-level tags (<p>, <br>, <div>, <li>, headings) become newlines so that
  // body paragraphs never bleed into the first header line after the join.
  const plain = text
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>.*?<\/a>/gi, (_, href) => href)
    .replace(/<\/?(?:p|br|div|li|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(ENTITY_RE, (m) => ENTITY_MAP[m])
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Split into lines; first non-blank line is the header.
  const lines = plain.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const firstLine = lines[0];
  if (!firstLine) return null;

  // Try to parse pipe-delimited header: Company | Role | Location | URL (4+ parts)
  // or Company | Role | Location (3 parts).
  const parts = firstLine.split('|').map(p => p.trim());

  let company = '';
  let location = '';

  if (parts.length >= 3) {
    company = parts[0];
    // Role is parts[1] — used in title construction below, not stored separately.
    // Strip any embedded URL from the location field (e.g. when the URL is run
    // into the same pipe segment rather than given its own 4th segment).
    location = parts[2].replace(/https?:\/\/\S+/g, '').trim();
  } else if (parts.length === 2) {
    company = parts[0];
  }
  // Single-part first line: title only, company/location stay empty.

  // Build a clean title from the first line (strip any embedded URL from it).
  const title = firstLine.replace(/https?:\/\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!title) return null;

  // Find first URL anywhere in the full text.
  const url = extractUrl(plain) || threadUrl;
  if (!url) return null;

  return { title, url, company, location };
}

/**
 * Find the objectID of the latest "Ask HN: Who is hiring?" story.
 * Returns null when the search yields no matching hits.
 * @param {unknown} data  Parsed Algolia search response.
 */
export function resolveLatestThreadId(data) {
  if (!data || typeof data !== 'object') return null;
  const hits = /** @type {any} */ (data).hits;
  if (!Array.isArray(hits) || hits.length === 0) return null;

  // Algolia search_by_date returns newest first; find the first hit whose title
  // matches the monthly thread pattern (case-insensitive).
  const RE = /ask\s+hn[:\s]+who\s+is\s+hiring/i;
  for (const hit of hits) {
    if (hit && typeof hit.objectID === 'string' && typeof hit.title === 'string') {
      if (RE.test(hit.title)) return hit.objectID;
    }
  }
  return null;
}

/** @type {Provider} */
export default {
  id: 'hackernews',

  async fetch(entry, ctx) {
    // Step 1: Find the latest "Who is hiring?" story id.
    const searchData = await ctx.fetchJson(SEARCH_URL, { redirect: 'error' });
    const threadId = resolveLatestThreadId(searchData);
    if (!threadId) {
      throw new Error('hackernews: could not find "Ask HN: Who is hiring?" thread in search results');
    }

    const threadHnUrl = `https://news.ycombinator.com/item?id=${threadId}`;

    // Step 2: Fetch the thread item (children = top-level job comments).
    const item = await ctx.fetchJson(itemUrl(threadId), { redirect: 'error' });
    if (!item || typeof item !== 'object') {
      throw new Error(`hackernews: unexpected item response for thread ${threadId}`);
    }

    const children = /** @type {any} */ (item).children;
    if (!Array.isArray(children)) return [];

    // Step 3: Parse each comment.
    const jobs = [];
    for (const child of children) {
      // Skip deleted / dead / empty comments.
      if (!child || child.deleted || child.dead) continue;
      const text = typeof child.text === 'string' ? child.text : '';
      if (!text.trim()) continue;

      const parsed = parseHnComment(text, threadHnUrl);
      if (!parsed) continue;

      jobs.push({
        title: parsed.title,
        url: parsed.url,
        company: parsed.company || (entry.name || 'HN Hiring'),
        location: parsed.location,
        // Algolia returns created_at as ISO string.
        ...(child.created_at
          ? { postedAt: Date.parse(child.created_at) || undefined }
          : {}),
      });
    }

    return jobs;
  },
};
