// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
//
// CryptocurrencyJobs — curated Web3/crypto job board. RSS 2.0, no auth.
// Feed: https://cryptocurrencyjobs.co/index.xml (listings are 100% remote).
// Title format: "Role at Company" — split on the last " at " to extract company.
//
// The feed URL is a hardcoded constant (never user-supplied), so there is no
// SSRF surface. Parsing is dependency-free regex over the raw XML, mirroring
// the providers/rwfa.mjs pattern.

import { decodeEntities } from './_html-entities.mjs';

// The feed's generator double-encodes entities at the source (verified
// 2026-07-30: the raw XML carries `Social Media &amp;amp; Growth Lead`), so a
// single canonical pass leaves `&amp;` in 6 of 62 live titles. Exactly two
// passes — not a decode-until-stable loop, which is the js/double-escaping
// bug class — normalizes this feed's shape and stays deterministic.
const decodeFeedText = (s) => decodeEntities(decodeEntities(s));

const FEED = 'https://cryptocurrencyjobs.co/index.xml';

/**
 * Extract the text content of the first matching XML tag within a block.
 * Handles both CDATA (<tag><![CDATA[...]]></tag>) and plain text.
 * @param {string} block
 * @param {string} tag
 * @returns {string}
 */
function extractTag(block, tag) {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`,
    'i'
  );
  const m = block.match(re);
  if (!m) return '';
  return (m[1] !== undefined ? m[1] : m[2] || '').trim();
}

/**
 * Split "Role at Company" on the last " at " occurrence.
 * Falls back to an empty company when the pattern isn't found.
 * @param {string} raw
 * @returns {{ title: string; company: string }}
 */
export function splitTitle(raw) {
  const sep = ' at ';
  const idx = raw.lastIndexOf(sep);
  if (idx <= 0) return { title: raw, company: '' };
  return {
    title: raw.slice(0, idx).trim(),
    company: raw.slice(idx + sep.length).trim(),
  };
}

/**
 * Parse a CryptocurrencyJobs RSS document into normalized Job objects.
 * Exported for unit testing; fetch() wraps it around an HTTP fetch.
 * @param {string} xml
 * @returns {Job[]}
 */
export function parseCryptocurrencyJobsRss(xml) {
  // Split on <item> boundaries; element 0 is the channel header — skip it.
  const parts = String(xml ?? '').split(/<item[\s>]/i);
  const results = [];

  for (let i = 1; i < parts.length; i++) {
    try {
      const block = parts[i];
      const rawTitle = decodeFeedText(extractTag(block, 'title'));
      const link = extractTag(block, 'link') || extractTag(block, 'guid');
      if (!rawTitle || !link) continue;

      const { title, company } = splitTitle(rawTitle);
      if (!title) continue;

      // pubDate → postedAt epoch ms (optional field per the Job contract).
      const pubDateStr = extractTag(block, 'pubDate');
      const postedAt = pubDateStr ? new Date(pubDateStr).getTime() : undefined;

      // The feed carries the job description for free in the same payload;
      // populate it so scan.mjs's content_filter can run (it's a remote-only
      // board, so location stays 'Remote').
      const description = decodeFeedText(extractTag(block, 'description'));

      results.push({
        title,
        url: link,
        company,
        location: 'Remote',
        ...(description ? { description } : {}),
        ...(postedAt && Number.isFinite(postedAt) ? { postedAt } : {}),
      });
    } catch {
      // Malformed item — skip, don't abort the whole feed.
    }
  }

  return results;
}

/** @type {Provider} */
export default {
  id: 'cryptocurrencyjobs',

  async fetch(_entry, ctx) {
    let xml;
    try {
      // redirect:'error' — refuse server-side redirects (SSRF hardening, matches
      // the other HTTP providers); the feed host is fixed so a redirect is a flag.
      xml = await ctx.fetchText(FEED, { redirect: 'error' });
    } catch {
      return [];
    }
    return parseCryptocurrencyJobsRss(xml);
  },
};
