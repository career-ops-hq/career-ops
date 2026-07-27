// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// We Work Remotely provider - board-wide RSS feed
// (https://weworkremotely.com/remote-jobs.rss). The feed is public, no-auth,
// and XML, so it is parsed in-process with the same tiny tag extractor approach
// as providers/personio.mjs rather than adding an XML dependency.
//
// Wire in via a `job_boards:` entry with `provider: weworkremotely`.

const FEED_URL = 'https://weworkremotely.com/remote-jobs.rss';
const TRUSTED_HOST = 'weworkremotely.com';

/** @param {string} url */
function assertWwrUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`weworkremotely: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`weworkremotely: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`weworkremotely: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`);
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
  return typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'We Work Remotely';
}

/** @type {Provider} */
export default {
  id: 'weworkremotely',

  detect(entry) {
    return entry?.provider === 'weworkremotely' ? { url: FEED_URL } : null;
  },

  async fetch(entry, ctx) {
    const feedUrl = assertWwrUrl(FEED_URL);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertWwrUrl above it keeps the request pinned to weworkremotely.com.
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parseWwrFeed(text, fallbackCompany(entry));
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
    const trusted = host === TRUSTED_HOST || host.endsWith(`.${TRUSTED_HOST}`);
    return parsed.protocol === 'https:' && trusted ? parsed.href : '';
  } catch {
    return '';
  }
}

function splitTitle(rawTitle, defaultCompany) {
  const text = rawTitle.trim();
  const colon = text.indexOf(':');
  if (colon > 0) {
    const company = text.slice(0, colon).trim();
    const title = text.slice(colon + 1).trim();
    if (company && title) return { company, title };
  }
  return { company: defaultCompany, title: text };
}

/**
 * Parse We Work Remotely's public RSS jobs feed. Exported for unit tests.
 *
 * Shape: `<rss><channel><item>...</item>...</channel></rss>`, each item
 * carrying `<title>`, `<link>`, `<pubDate>`, and often `<region>` plus
 * `<category>`. The title is usually "Company: Role"; when that split is
 * present, company and title are normalized separately. The RSS `<link>` is
 * the dedup key; items without a usable absolute URL are dropped.
 *
 * @param {string} xml - raw RSS feed body
 * @param {string} [defaultCompany] - fallback company for unsplittable titles
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseWwrFeed(xml, defaultCompany = 'We Work Remotely') {
  if (typeof xml !== 'string') return [];
  const fallback = typeof defaultCompany === 'string' && defaultCompany.trim() ? defaultCompany.trim() : 'We Work Remotely';
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;

    const rawTitle = tagText(item, 'title');
    if (!rawTitle) continue;

    const { company, title } = splitTitle(rawTitle, fallback);
    const location = tagText(item, 'region') || tagText(item, 'category');

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
