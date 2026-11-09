// @ts-check
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';

/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

// Python.org provider — the board-wide public RSS jobs feed at
// https://www.python.org/jobs/feed/rss/ (official Python Software Foundation job board).
// The feed is public, no-auth, and RSS 2.0 XML.
//
// Each <item> exposes <title> (typically "{Role}, {Company}"), <link>,
// and <description> (the first line typically contains the location).
//
// Wire in via a `job_boards:` entry with `provider: pythonorg`.

const FEED_URL = 'https://www.python.org/jobs/feed/rss/';
const TRUSTED_HOST = 'python.org';

/** @param {string} url */
export function assertPythonOrgUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`pythonorg: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`pythonorg: URL must use HTTPS: ${url}`);
  const host = parsed.hostname.toLowerCase();
  const trusted = host === TRUSTED_HOST || host.endsWith(`.${TRUSTED_HOST}`);
  if (!trusted) {
    throw new Error(`pythonorg: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function fallbackCompany(entry) {
  return typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Python.org';
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

// Keep only absolute HTTPS links hosted on the trusted domain.
export function cleanUrl(value) {
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
 * Parse Python.org's public RSS jobs feed. Exported for unit tests.
 *
 * Shape: `<rss><channel><item>...</item>...</channel></rss>`.
 * Items have `<title>` (typically "{Role}, {Company}"), `<link>` / `<guid>`,
 * and `<description>` (first line holds the location string).
 *
 * @param {string} xml - raw RSS feed body
 * @param {string} [defaultCompany] - fallback company when parsing cannot isolate one
 * @returns {Job[]}
 */
export function parsePythonOrgFeed(xml, defaultCompany = 'Python.org') {
  if (typeof xml !== 'string') return [];
  const fallback = typeof defaultCompany === 'string' && defaultCompany.trim() ? defaultCompany.trim() : 'Python.org';
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link') || tagText(item, 'guid'));
    if (!url) continue;

    const rawTitle = tagText(item, 'title');
    if (!rawTitle) continue;

    // Split title and company from format: "{Role}, {Company}".
    // Per Source Indexing Policy, listings must be employer-attributed.
    // Skip items where an identifiable employer cannot be parsed.
    const lastComma = rawTitle.lastIndexOf(',');
    if (lastComma <= 0) continue;

    const candidateRole = rawTitle.slice(0, lastComma).trim();
    const candidateCompany = rawTitle.slice(lastComma + 1).trim();
    if (!candidateRole || !candidateCompany) continue;

    const title = candidateRole;
    const company = candidateCompany;

    // Extract location: Python.org RSS items prepend location before the HTML body,
    // either separated by a newline or immediately preceding the opening HTML tag (< or &lt;).
    let location = '';
    const rawDesc = tagText(item, 'description');
    if (rawDesc) {
      const firstChunk = rawDesc.split(/\r?\n|(?=<[a-z/!])|(?=&lt;[a-z/!])/i)[0];
      if (!/^\s*(?:<|&lt;)/i.test(firstChunk)) {
        location = htmlToText(firstChunk);
      }
    }

    const postedAt = toEpochMs(tagText(item, 'pubDate') || tagText(item, 'dc:date'));

    /** @type {Job} */
    const job = {
      title,
      company,
      location,
      url,
    };

    if (postedAt !== undefined) {
      job.postedAt = postedAt;
    }
    if (rawDesc) {
      const descText = htmlToText(rawDesc);
      if (descText) {
        job.description = descText;
      }
    }

    jobs.push(job);
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'pythonorg',

  detect(entry) {
    if (entry?.provider === 'pythonorg') return { url: FEED_URL };
    if (typeof entry?.careers_url === 'string') {
      try {
        const parsed = new URL(entry.careers_url);
        if (parsed.protocol !== 'https:') return null;
        const host = parsed.hostname.toLowerCase();
        if ((host === 'python.org' || host === 'www.python.org') && /^\/jobs(?:\/|$)/.test(parsed.pathname)) {
          return { url: FEED_URL };
        }
      } catch {
        return null;
      }
    }
    return null;
  },

  async fetch(entry, ctx) {
    const feedUrl = assertPythonOrgUrl(FEED_URL);
    // redirect:'error' prevents SSRF via server-side redirects
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parsePythonOrgFeed(text, fallbackCompany(entry));
  },
};
