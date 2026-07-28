// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// NoDesk provider - board-wide RSS feed
// (https://nodesk.co/remote-jobs/index.xml). The feed is public, no-auth,
// and XML, so it is parsed in-process with the same tiny tag extractor
// approach as providers/personio.mjs rather than adding an XML dependency.
//
// Wire in via a `job_boards:` entry with `provider: nodesk`.

const FEED_URL = 'https://nodesk.co/remote-jobs/index.xml';
const TRUSTED_HOST = 'nodesk.co';

/** @param {string} url */
function assertNodeskUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`nodesk: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`nodesk: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`nodesk: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`);
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
  return typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'NoDesk';
}

/** @type {Provider} */
export default {
  id: 'nodesk',

  detect(entry) {
    return entry?.provider === 'nodesk' ? { url: FEED_URL } : null;
  },

  async fetch(entry, ctx) {
    const feedUrl = assertNodeskUrl(FEED_URL);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertNodeskUrl above it keeps the request pinned to nodesk.co.
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parseNodeskFeed(text, fallbackCompany(entry));
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

// Keep only absolute HTTPS links hosted on the trusted board domain.
function cleanUrl(value) {
  if (!value) return '';
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const trusted = host === TRUSTED_HOST || host.endsWith(`.${TRUSTED_HOST}`);
    return parsed.protocol === 'https:' && trusted ? parsed.href : '';
  } catch {
    return '';
  }
}

// NoDesk encodes the company in the RSS title as "Role at Company".
function splitTitle(rawTitle, defaultCompany) {
  const text = rawTitle.trim();
  const lower = text.toLowerCase();
  const idx = lower.lastIndexOf(' at ');
  if (idx > 0) {
    const title = text.slice(0, idx).trim();
    const company = text.slice(idx + 4).trim();
    if (title && company) return { title, company };
  }
  return { title: text, company: defaultCompany };
}

/**
 * Parse NoDesk's public RSS jobs feed. Exported for unit tests.
 *
 * Shape: `<rss><channel><item>...</item>...</channel></rss>`. Each item
 * exposes `<title>`, `<link>`, and `<pubDate>`. NoDesk currently encodes the
 * company inside the title as `Role at Company`; there is no dedicated
  * location tag in the feed, so location stays empty unless the feed evolves.
 *
 * @param {string} xml - raw RSS feed body
 * @param {string} [defaultCompany] - fallback company for unsplittable titles
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseNodeskFeed(xml, defaultCompany = 'NoDesk') {
  if (typeof xml !== 'string') return [];
  const fallback = typeof defaultCompany === 'string' && defaultCompany.trim() ? defaultCompany.trim() : 'NoDesk';
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;

    const rawTitle = tagText(item, 'title');
    if (!rawTitle) continue;

    const { title, company } = splitTitle(rawTitle, fallback);
    const postedAt = toEpochMs(tagText(item, 'pubDate'));
    const job = {
      title,
      company,
      location: '',
      url,
    };
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  return jobs;
}
