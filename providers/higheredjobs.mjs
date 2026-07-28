// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HigherEdJobs.com RSS category feed provider.
// (https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=68). The feed is
// public, no-auth, and XML, so it is parsed in-process with the same tiny tag
// extractor approach as providers/weworkremotely.mjs rather than adding an
// XML dependency.
//
// Wire in via a `job_boards:` entry with `provider: higheredjobs`.

const DEFAULT_CAT_ID = 68; // Higher Education category
const TRUSTED_HOST = 'www.higheredjobs.com';

function feedUrlFor(catId) {
  const catID = typeof catId === 'number' && Number.isFinite(catId) ? catId : DEFAULT_CAT_ID;
  return `https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=${catID}`;
}

// NaN-safe Date.parse - `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function fallbackCompany(entry) {
  return typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'HigherEdJobs';
}

/** @type {Provider} */
export default {
  id: 'higheredjobs',

  detect(entry) {
    if (entry?.provider !== 'higheredjobs') return null;
    return { url: feedUrlFor(entry.cat_id) };
  },

  async fetch(entry, ctx) {
    const feedUrl = feedUrlFor(entry?.cat_id);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // cleanUrl below it keeps the request pinned to www.higheredjobs.com.
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parseHigherEdJobsFeed(text, fallbackCompany(entry));
  },
};

function fromCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

// Decode the XML entities that appear in RSS text: numeric (&#38; / &#x27;)
// and the named five. Numeric forms are decoded first; &amp; is decoded LAST
// so a literal "&amp;lt;" yields "&lt;" rather than over-decoding to "<".
function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Resolve a tag's inner text: unwrap a CDATA section, else decode entities.
function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeXmlEntities(inner).trim();
}

// Extract the text of the first <tag>...</tag> in a block. Returns '' when absent.
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

function cleanUrl(value) {
  if (!value) return '';
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    // Exact-match host (no subdomain wildcard): higheredjobs serves only
    // www.higheredjobs.com for posting URLs.
    const trusted = host === TRUSTED_HOST;
    return parsed.protocol === 'https:' && trusted ? parsed.href : '';
  } catch {
    return '';
  }
}

// HigherEdJobs <description> is "Institution Name (City, ST)". Split on the
// last " (" to separate company from location. When no parens are present the
// whole description is treated as the company and location is empty.
function splitDescription(rawDescription, defaultCompany) {
  const text = rawDescription.trim();
  const open = text.lastIndexOf(' (');
  if (open > 0) {
    const close = text.lastIndexOf(')');
    const company = text.slice(0, open).trim();
    const location = close > open ? text.slice(open + 2, close).trim() : text.slice(open + 2).trim();
    if (company) return { company, location };
  }
  return { company: text || defaultCompany, location: '' };
}

/**
 * Parse HigherEdJobs' public RSS category feed. Exported for unit tests.
 *
 * Shape: `<rss><channel><item>...</item>...</channel></rss>`, each item
 * carrying `<title>` (plain job title), `<description>` ("Institution (City,
 * ST)"), `<link>`, `<pubDate>`, and `<guid>`. Company and location are
 * derived from <description>. The RSS <link> is the dedup key; items without
 * a usable absolute URL on www.higheredjobs.com are dropped.
 *
 * @param {string} xml - raw RSS feed body
 * @param {string} [defaultCompany] - fallback company for empty descriptions
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseHigherEdJobsFeed(xml, defaultCompany = 'HigherEdJobs') {
  if (typeof xml !== 'string') return [];
  const fallback = typeof defaultCompany === 'string' && defaultCompany.trim() ? defaultCompany.trim() : 'HigherEdJobs';
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;

    const title = tagText(item, 'title');
    if (!title) continue;

    const { company, location } = splitDescription(tagText(item, 'description'), fallback);

    jobs.push({
      title,
      company,
      location,
      url,
      postedAt: toEpochMs(tagText(item, 'pubDate')),
    });
  }

  return jobs;
}