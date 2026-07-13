// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// LaraJobs provider — the board-wide public RSS feed at
// https://larajobs.com/feed (Laravel / PHP jobs). The feed is public, no-auth,
// and XML, so it is parsed in-process with the same tiny tag extractor as
// providers/nodesk.mjs rather than adding an XML dependency.
//
// Each <item> carries the standard RSS fields plus a `job:` namespace with
// `<job:company>` and `<job:location>`, so company and location come straight
// from the feed (no title-splitting heuristics needed).
//
// Wire in via a `job_boards:` entry with `provider: larajobs`.

const FEED_URL = 'https://larajobs.com/feed';
const TRUSTED_HOST = 'larajobs.com';

/** @param {string} url */
function assertLarajobsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`larajobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`larajobs: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`larajobs: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`);
  }
  return url;
}

// NaN-safe Date.parse - `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function fallbackCompany(entry) {
  return typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'LaraJobs';
}

/** @type {Provider} */
export default {
  id: 'larajobs',

  detect(entry) {
    return entry?.provider === 'larajobs' ? { url: FEED_URL } : null;
  },

  async fetch(entry, ctx) {
    const feedUrl = assertLarajobsUrl(FEED_URL);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertLarajobsUrl above it keeps the request pinned to larajobs.com.
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parseLarajobsFeed(text, fallbackCompany(entry));
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

// Extract the text of the first <tag>...</tag> in a block. Returns '' when
// absent. Tag names may carry a namespace colon (e.g. job:company).
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

// Keep only absolute HTTPS links hosted on the trusted board domain.
function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    const trusted = host === TRUSTED_HOST || host.endsWith(`.${TRUSTED_HOST}`);
    return parsed.protocol === 'https:' && trusted ? parsed.href : '';
  } catch {
    return '';
  }
}

/**
 * Parse LaraJobs' public RSS jobs feed. Exported for unit tests.
 *
 * Shape: `<rss><channel><item>...</item>...</channel></rss>`. Each item exposes
 * `<title>`, `<link>` (larajobs.com/job/<id>), `<pubDate>`, and a `job:`
 * namespace with `<job:company>` and `<job:location>`. Company falls back to
 * `<dc:creator>` then the entry name; location may be empty.
 *
 * @param {string} xml - raw RSS feed body
 * @param {string} [defaultCompany] - fallback company when the feed omits one
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseLarajobsFeed(xml, defaultCompany = 'LaraJobs') {
  if (typeof xml !== 'string') return [];
  const fallback = typeof defaultCompany === 'string' && defaultCompany.trim() ? defaultCompany.trim() : 'LaraJobs';
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;

    const title = tagText(item, 'title');
    if (!title) continue;

    const company = tagText(item, 'job:company') || tagText(item, 'dc:creator') || fallback;
    const postedAt = toEpochMs(tagText(item, 'pubDate'));
    const job = {
      title,
      company,
      location: tagText(item, 'job:location'),
      url,
    };
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  return jobs;
}
