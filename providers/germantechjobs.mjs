// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';

// GermanTechJobs provider — the board-wide public RSS feed at
// https://germantechjobs.de/rss (German IT jobs, salary + tech stack
// mandatory on every posting). The feed is public, no-auth, and XML, so it is
// parsed in-process with the same tiny tag extractor as
// providers/startup-jobs.mjs rather than adding an XML dependency.
//
// The board is one of the swissdevjobs.ch / devitjobs family (same stack, same
// feed shape). By default this provider reads GermanTechJobs; `feed_url` points
// it at another board of the family instead (`FAMILY_HOSTS` below: SwissDevJobs,
// DEVITjobs UK, DEVITjobs NL). Measured 2026-11-23: each board
// serves its whole inventory at `https://<host>/rss` in the same item shape, and
// rows link only to their own board. The legacy JSON API at /api/jobs is
// deprecated upstream ("ENDPOINT Deprecated - contact hello@swissdevjobs.ch"), so
// RSS is the stable public surface.
//
// Two properties of the feed shape the parser:
//
//   - `<title>` carries the employer: "{Role} @ {Company} [{salary range}]".
//     Company comes from that last " @ " segment, and the trailing salary
//     bracket is stripped from the role. The bracket is in the board's
//     currency (€, CHF, £), and reads "[CHF ? - ?]" when no figure is given.
//     A title with no " @ " has no identifiable employer, so the row is
//     skipped rather than attributed to the board.
//   - There is no location tag, and the `<description>` does not carry one
//     either (sampled 2026-10-30: 20 of 626 items mention a location line,
//     the rest pack salary/requirements/tech only). Location is therefore ''
//     on every row — see the comment on the mapping below for what that costs.
//
// Wire in via a `job_boards:` entry with `provider: germantechjobs`; add
// `feed_url: https://swissdevjobs.ch/rss` (or another family board) to read
// that board instead.

const FEED_URL = 'https://germantechjobs.de/rss';
const TRUSTED_HOST = 'germantechjobs.de';
/** The boards of the family, each serving its own `/rss`. */
const FAMILY_HOSTS = ['germantechjobs.de', 'swissdevjobs.ch', 'devitjobs.uk', 'devitjobs.nl'];

/**
 * The family host a hostname belongs to (itself or a subdomain), or ''.
 * @param {string} hostname
 */
function familyHost(hostname) {
  const host = String(hostname).toLowerCase();
  return FAMILY_HOSTS.find((h) => host === h || host.endsWith(`.${h}`)) || '';
}

/** @param {string} url */
function assertFeedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`germantechjobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`germantechjobs: URL must use HTTPS: ${url}`);
  if (!familyHost(parsed.hostname)) {
    throw new Error(`germantechjobs: untrusted hostname "${parsed.hostname}" - must be one of ${FAMILY_HOSTS.join(', ')}`);
  }
  return url;
}

// NaN-safe Date.parse - `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : undefined;
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

// Canonical posting URL — Source Indexing Policy rule 2. The feed appends its
// own attribution to every link (`?utm_source=our_rss_feed&utm_medium=…`), so
// the query is dropped and the stable /jobs/<slug> path is kept. Only https:
// links on the board being read are accepted (another family board's link
// drops the row too); anything else drops the row.
function cleanUrl(value, boardHost) {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    const trusted = familyHost(parsed.hostname) === boardHost;
    if (parsed.protocol !== 'https:' || !trusted) return '';
    return `https://${parsed.hostname}${parsed.pathname}`;
  } catch {
    return '';
  }
}

/**
 * Titles on GermanTechJobs look like:
 *   "Data Architect (all Genders) @ BORA Gruppe Deutschland [48.000 - 70.000 €]"
 *   "CIAM Platform Engineer (w/m/d) @ SEW-EURODRIVE GmbH & Co KG [50.000 - 80.000 €]"
 *   "Technischer Systemberater (w/m/div.) @ Buderus [49.000 - 89.000 €]"
 * The company is after the last " @ ", the role before it, and a trailing
 * salary bracket (" [... €]", " [CHF ... - ...]", " [£... - ...]") is
 * stripped. When no " @ " is present there is no identifiable employer, so
 * the caller drops the row rather than attributing
 * it to the board or the portal entry name (phase 1 of the
 * [source policy](https://github.com/career-ops-hq/career-ops/blob/main/CONTRIBUTING.md#source-indexing-policy)
 * asks for listings attributed to an identifiable employer).
 *
 * @param {string} rawTitle
 * @returns {{title: string, company: string}} company is '' when unattributable
 */
function splitTitle(rawTitle) {
  let text = rawTitle.trim();
  text = text.replace(/\s*\[[^\]]*(?:€|£|CHF)[^\]]*\]\s*$/, '').trim();

  const at = text.lastIndexOf(' @ ');
  if (at > 0) {
    const title = text.slice(0, at).trim();
    const company = text.slice(at + 3).trim();
    if (title && company) return { title, company };
  }
  return { title: text, company: '' };
}

// CDATA sections (a job <description>'s raw, unescaped text) and XML comments
// can both carry the literal substrings "<item>" / "</item>" / "</channel>" /
// "</rss>" without being real structure — a posting that mentions XML/RSS
// tooling, or a feed-generator comment. Matching item boundaries directly
// against the raw XML would mistake that text for real structure and silently
// truncate that item. Replace both with same-length filler first: positions
// stay aligned with the original string, so a matched item block's
// start/length can be used to slice the REAL xml (preserving the actual CDATA
// content), while the filler itself never matches a tag.
function maskCdataAndComments(str) {
  return str.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, (m) => '#'.repeat(m.length));
}

const ENVELOPE_RE = /<rss\b[^>]*>[\s\S]*<channel\b[^>]*>[\s\S]*<\/channel>[\s\S]*<\/rss>/i;

/**
 * Parse the public RSS feed of GermanTechJobs, or of another family board when
 * `boardHost` names it. Exported for unit tests.
 *
 * Shape: `<rss><channel><item>...</item>...</channel></rss>`, each item
 * carrying `<title>`, `<link>`, `<guid>`, `<pubDate>`, `<description>` (HTML
 * CDATA) and `<content:encoded>`. No location tag.
 *
 * @param {string} xml - raw RSS feed body
 * @param {string} [boardHost] - the family host the feed came from (default germantechjobs.de)
 * @returns {Array<{title: string, url: string, company: string, location: string, description: string, postedAt?: number}>}
 */
export function parseGermantechjobsFeed(xml, boardHost = TRUSTED_HOST) {
  if (typeof xml !== 'string') {
    throw new Error(`germantechjobs: unexpected feed response — expected an <rss><channel> envelope, got: ${typeof xml}`);
  }

  const maskedXml = maskCdataAndComments(xml);

  if (!ENVELOPE_RE.test(maskedXml)) {
    throw new Error(`germantechjobs: unexpected feed response — expected an <rss><channel> envelope, got: ${xml.length}-char body`);
  }

  // A valid outer envelope can still wrap a body truncated mid-item — e.g. a
  // response cut off after an opening <item> but before its closing tag, with
  // a stray </channel></rss> tail from buffering/retry behavior. The non-greedy
  // item regex below would simply not match that dangling <item>, so an
  // otherwise-truncated feed would read as "zero items" — a genuinely empty
  // board — instead of the broken fetch it actually is. Count open vs close
  // tags within the (masked) channel body first: a mismatch is unambiguous
  // truncation evidence and throws, rather than silently dropping the
  // incomplete item and returning whatever did parse.
  const maskedChannelBody = (maskedXml.match(/<channel\b[^>]*>([\s\S]*)<\/channel>/i) || [, ''])[1];
  const openItems = (maskedChannelBody.match(/<item\b/gi) || []).length;
  const closedItems = (maskedChannelBody.match(/<\/item>/gi) || []).length;
  if (openItems !== closedItems) {
    throw new Error(`germantechjobs: malformed feed — ${openItems} <item> open tag(s) but ${closedItems} </item> close tag(s) (truncated response?)`);
  }

  // Item boundaries are matched against the masked xml (so CDATA text cannot
  // end a block early), but each block is sliced from the REAL xml at that same
  // position/length, preserving the actual CDATA content for field parsing.
  const jobs = [];
  for (const m of maskedXml.matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)) {
    const item = xml.slice(m.index, m.index + m[0].length);

    const url = cleanUrl(tagText(item, 'link') || tagText(item, 'guid'), boardHost);
    if (!url) continue;

    const rawTitle = tagText(item, 'title');
    if (!rawTitle) continue;

    // No identifiable employer after " @ " means the row cannot be attributed
    // to anyone: drop it rather than filing it under the board or the portal
    // entry name, which would let the scanner's company+role dedup merge two
    // different employers' same-titled postings into one opening.
    const { title, company } = splitTitle(rawTitle);
    if (!company) continue;

    // Description ships in the list payload, so it is free — the scanner's
    // content_filter and visa_filter read it. `description` is the posting
    // body; `content:encoded` repeats it with more markup on some rows.
    const rawDesc = tagText(item, 'description') || tagText(item, 'content:encoded') || '';
    const description = rawDesc ? htmlToText(rawDesc) : '';

    const job = {
      title,
      company,
      // The feed carries no location for any item (see the header comment), so
      // this is '' on every row. scan.mjs's location_filter passes an empty
      // location unless `strict: true` is set — a location-restricted sweep
      // against this board therefore needs `location_filter.strict: false`
      // (the default). Recovering city would mean one detail-page request per
      // posting (`window.__detailedJob` carries cityCategory/actualCity), which
      // is not free and so is not done here.
      location: '',
      url,
    };
    if (description) job.description = description;
    const postedAt = toEpochMs(tagText(item, 'pubDate'));
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'germantechjobs',

  // Explicit-only, shape 2: the board serves one board-wide feed with no
  // per-entry URL, so the provider claims an entry only when it names it.
  detect(entry) {
    return entry?.provider === 'germantechjobs' ? { url: FEED_URL } : null;
  },

  async fetch(entry, ctx) {
    const feedUrl = entry?.feed_url ? assertFeedUrl(entry.feed_url) : assertFeedUrl(FEED_URL);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertFeedUrl above it keeps the request pinned to a family board.
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parseGermantechjobsFeed(text, familyHost(new URL(feedUrl).hostname));
  },
};
