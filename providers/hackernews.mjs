// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Hacker News "Ask HN: Who is hiring?" provider — no auth required.
//
// Algorithm:
//   1. Find the current monthly hiring thread via the Algolia HN search API,
//      filtered to stories posted by the "whoishiring" account
//      (tags=story,author_whoishiring) rather than a free-text query.
//   2. Fetch the thread's item from the Algolia items API; top-level `children`
//      are individual job posts left as top-level comments.
//   3. Parse each comment: the first non-empty line is treated as the title/header
//      (many follow "Company | Role | Location | URL" but this is free-form, so
//      we extract defensively — see parseHnComment for how the posting URL is
//      chosen; the first line becomes the title; company/location are left
//      empty when the format doesn't match the pipe-delimited convention).
//
// Wire in via a `job_boards:` entry with `provider: hackernews`.
//
// NOTE: a free-text query ("Ask HN Who is hiring") against search_by_date used
// to be the lookup here, but Algolia's free-text ranking can surface an
// unrelated recent story that merely contains those words in its body — once
// enough time passes since the monthly thread posted, a newer "Tell HN: ..."
// post can outrank it in the top 5 date-sorted hits, and every one of them
// fails the title regex below, so the provider throws "thread not found" even
// though the actual thread is sitting a few pages back. Filtering by the
// `whoishiring` account's own tag returns only its threads, so ordering by
// date always surfaces the latest real one first.
const SEARCH_URL =
  'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5';

/** @param {string} id */
function itemUrl(id) {
  return `https://hn.algolia.com/api/v1/items/${id}`;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/g;

/**
 * Every absolute http/https URL in raw text, in order, trailing punctuation trimmed.
 * @param {string} text
 */
function extractUrls(text) {
  return (text.match(URL_RE) || []).map(u => {
    let trimmed = u.replace(/[.,;!?)]+$/, '');
    // A trailing `]` with no matching `[` is text around the link
    // (`[https://…/jobs/123]`); an IPv6 host's balanced brackets stay.
    const count = (ch) => trimmed.split(ch).length - 1;
    while (trimmed.endsWith(']') && count(']') > count('[')) trimmed = trimmed.slice(0, -1);
    return trimmed;
  });
}

// A path segment that names a job listing: /careers, /career, /jobs.
const JOBS_PATH_RE = /\/(?:careers?|jobs)(?:\/|$)/i;

/**
 * True for a URL that points at a job posting or listing rather than at the
 * company at large: a known ATS host (the same list ats-vendor.mjs uses to
 * label tracker rows) or a /careers or /jobs path.
 * @param {string} raw
 */
function looksLikeJobUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (ATS_HOST_PATTERNS.some(({ test }) => test(host))) return true;
  return JOBS_PATH_RE.test(u.pathname);
}

// Header first fields that are a template left unfilled, not a company name.
const COMPANY_PLACEHOLDER_RE = /^[[<({]?\s*(?:company(?:\s+name)?|name)\s*[\]>)}]?$/i;

/**
 * The company from a header's first field: URLs removed, and '' when what is
 * left is empty or a placeholder such as "name" — fetch() then falls back to
 * the entry name instead of storing junk.
 * @param {string} field
 */
function cleanCompany(field) {
  const name = field
    .replace(URL_RE, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return COMPANY_PLACEHOLDER_RE.test(name) ? '' : name;
}

// Shared decoder instead of a local map (#2487, #2921). The local ENTITY_RE
// was a literal alternation of seven forms, so it decoded &#39; but left every
// OTHER numeric entity (&#8211;, &#232;, &#x2013;) and every other named one
// (&uuml;, &eacute;) sitting in the title — where an undecoded entity does not
// just look wrong, it fails the user's title_filter and the posting is dropped.
import { decodeEntities } from './_html-entities.mjs';
import { ATS_HOST_PATTERNS } from '../ats-vendor.mjs';

/**
 * Parse a single HN comment text into a normalized job object.
 * The canonical format is "Company | Role | Location | URL" on the first line,
 * but posts are free-form — we only guarantee title (first line) and url.
 * company and location are extracted from the pipe-delimited header when
 * present; left empty otherwise.
 *
 * url is chosen in this order:
 *   1. a URL in the header's URL field (the 4th pipe-delimited field or later);
 *   2. the first URL anywhere in the comment that looks like a job link — a
 *      known ATS host or a /careers or /jobs path;
 *   3. fallbackUrl.
 * Taking the first URL anywhere instead picked up company homepages, links to
 * other HN comments, videos, press coverage and referral links, none of which
 * is the posting.
 *
 * Exported for unit testing.
 *
 * @param {string} text  Raw comment text (may contain HTML; tags are stripped).
 * @param {string} fallbackUrl  Used when no job link is found (fetch() passes the comment's own permalink).
 * @returns {{ title: string, url: string, company: string, location: string } | null}
 *   null when the comment is empty, deleted, or carries no usable title.
 */
export function parseHnComment(text, fallbackUrl = '') {
  if (!text || typeof text !== 'string') return null;

  // Strip HTML. Anchors: keep the href value in place so URL extraction works.
  // Block-level tags (<p>, <br>, <div>, <li>, headings) become newlines so that
  // body paragraphs never bleed into the first header line after the join.
  const plain = decodeEntities(text
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>.*?<\/a>/gi, (_, href) => href)
    .replace(/<\/?(?:p|br|div|li|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
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
    company = cleanCompany(parts[0]);
    // Role is parts[1] — used in title construction below, not stored separately.
    // Strip any embedded URL from the location field (e.g. when the URL is run
    // into the same pipe segment rather than given its own 4th segment).
    location = parts[2].replace(/https?:\/\/\S+/g, '').trim();
  } else if (parts.length === 2) {
    company = cleanCompany(parts[0]);
  }
  // Single-part first line: title only, company/location stay empty.

  // Build a clean title from the first line (strip any embedded URL from it).
  const title = firstLine.replace(/https?:\/\/[^\s]+/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!title) return null;

  const url = extractUrls(parts.slice(3).join(' '))[0]
    || extractUrls(plain).find(looksLikeJobUrl)
    || fallbackUrl;
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

      // A post with no link of its own falls back to its own permalink, not the
      // thread's. With the thread URL every such post shared one dedup key, so
      // only the first was ever considered, and its pipeline row opened the
      // whole thread (#5478). The thread URL stays the last resort for a
      // comment that carries no id.
      const commentId = child.id ?? child.objectID;
      const fallbackUrl = commentId != null && String(commentId) !== ''
        ? `https://news.ycombinator.com/item?id=${encodeURIComponent(String(commentId))}`
        : threadHnUrl;
      const parsed = parseHnComment(text, fallbackUrl);
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
