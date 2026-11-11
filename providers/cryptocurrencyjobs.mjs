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
 * Return the location clause of a feed teaser: the text after "This is a
 * {full-time|part-time|contract} position that", without its final period.
 * Live shapes (2026-11-09): "is 100% remote with no geographical
 * restrictions. Work remotely from anywhere", "is based in New York NY",
 * "can be done remotely anywhere in the United States, or Canada". Returns
 * '' when the teaser has no such clause (8 of 54 live items end at
 * "This is a full-time position").
 * @param {string} teaser
 * @returns {string}
 */
export function teaserLocationClause(teaser) {
  const m = String(teaser ?? '').match(/\bThis is an? [\w-]+(?: [\w-]+)? position that\s+([\s\S]+?)\s*\.?\s*$/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
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

      // No `description`: the feed's <description> is not the job description.
      // Every item carries the same one-sentence template ("{Company} is
      // looking to hire a {Role} to join their team. This is a full-time
      // position that ...", verified 2026-11-09: 54 of 54 live items, 96-253
      // characters) and never names a stack. scan.mjs's content_filter passes
      // a posting with no description but treats any text as the JD, so the
      // teaser would drop every posting from this board for a user with
      // `content_filter.positive` set. Same decision as _wp-job-feed.mjs,
      // which refuses WordPress's excerpt.
      //
      // What the other description readers lose:
      // - visa_filter with `require_mention: true` rejects these postings with
      //   or without the teaser: the template never mentions sponsorship (0 of
      //   54), and a missing description fails require_mention by design.
      // - country_eligibility_filter keeps the teaser's location clause ("can
      //   be done remotely anywhere in the United States, or Canada"), the
      //   feed's only country signal, through `eligibilityText` below, which
      //   no other filter reads. Only the clause goes there: the rest of the
      //   teaser names the company, and a company called "Canada Crypto"
      //   would pass the filter's candidate-country check.
      // - content_filter.rescue_title_misses can't rescue a title miss from
      //   this board. The teaser only repeats the title the title filter
      //   already rejected and adds the company name and location, so a
      //   rescue it allowed would be an accident (a `protocol` keyword
      //   matching the company "Acme Protocol").
      //
      // Location stays 'Remote' as before, although some teasers name an
      // on-site city ("is based in New York NY").
      const eligibilityText = teaserLocationClause(decodeFeedText(extractTag(block, 'description')));
      results.push({
        title,
        url: link,
        company,
        location: 'Remote',
        ...(postedAt && Number.isFinite(postedAt) ? { postedAt } : {}),
        ...(eligibilityText ? { eligibilityText } : {}),
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
    // redirect:'error' — refuse server-side redirects (SSRF hardening, matches
    // the other HTTP providers); the feed host is fixed so a redirect is a flag.
    // A failed fetch must THROW, not return []: swallowing it makes a dead
    // board read as "live but empty", so portal-health never escalates and
    // coverage decays silently (same contract as meituan/tencent).
    const xml = await ctx.fetchText(FEED, { redirect: 'error' });
    return parseCryptocurrencyJobsRss(xml);
  },
};
