// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jobspresso provider - public WordPress jobs feed
// (https://jobspresso.co/?feed=job_feed). The feed is public, no-auth,
// and XML, so it is parsed in-process with the same tiny tag extractor
// approach as providers/personio.mjs rather than adding an XML dependency.
//
// Wire in via a `job_boards:` entry with `provider: jobspresso`.

const FEED_URL = 'https://jobspresso.co/?feed=job_feed';
const TRUSTED_HOST = 'jobspresso.co';

/** @param {string} url */
function assertJobspressoUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobspresso: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:")
    throw new Error(`jobspresso: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(
      `jobspresso: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`,
    );
  }
  return url;
}

// NaN-safe Date.parse - `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @type {Provider} */
export default {
  id: "jobspresso",

  detect(entry) {
    return entry?.provider === "jobspresso" ? { url: FEED_URL } : null;
  },

  async fetch(_entry, ctx) {
    const feedUrl = assertJobspressoUrl(FEED_URL);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertJobspressoUrl above it keeps the request pinned to jobspresso.co.
    const text = await ctx.fetchText(feedUrl, { redirect: "error" });
    return parseJobspressoFeed(text);
  },
};

function fromCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

// Decode the XML entities that appear in RSS text: numeric (&#38; / &#x27;)
// and the named five. Numeric forms are decoded first; &amp; is decoded LAST
// so a literal "&amp;lt;" yields "&lt;" rather than over-decoding to "<".
function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Resolve a tag's inner text: unwrap a CDATA section, else decode entities.
function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeXmlEntities(inner).trim();
}

// Extract the text of the first <tag>...</tag> in a block. Returns '' when absent.
function tagText(block, tag) {
  const m = block.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"),
  );
  return m ? extractText(m[1]) : "";
}

function cleanUrl(value) {
  if (!value) return "";
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const trusted = host === TRUSTED_HOST || host.endsWith(`.${TRUSTED_HOST}`);
    return parsed.protocol === "https:" && trusted ? parsed.href : "";
  } catch {
    return "";
  }
}

/**
 * Parse Jobspresso's public WordPress jobs feed.
 *
 * Shape:
 * <rss><channel><item>...</item></channel></rss>
 *
 * Each item contains:
 * - title
 * - link
 * - pubDate
 * - job_listing:company
 * - job_listing:location
 *
 * The RSS link is used as the dedup key.
 * @param {string} xml - raw RSS feed body
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseJobspressoFeed(xml) {
  if (typeof xml !== "string") return [];
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, "link"));
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
