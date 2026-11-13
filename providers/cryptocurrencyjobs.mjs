// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
//
// CryptocurrencyJobs — curated Web3/crypto job board. RSS 2.0, no auth.
// Feed: https://cryptocurrencyjobs.co/index.xml. Most listings are remote with
// no restriction; others are limited to a region or based in a city, as the
// <description> teaser states (see locationFromClause).
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

// "the United States, or Canada" → ['United States', 'Canada'];
// "APAC, Asia, EMEA or the United Kingdom" → four entries.
const splitPlaces = (s) => s
  .split(/\s*,\s*(?:or\s+)?|\s+or\s+/i)
  .map(p => p.trim().replace(/^the\s+/i, ''))
  .filter(Boolean);

// The teaser writes a US state or Canadian province without a comma ("New
// York NY", "Montreal QC"). location_filter reads the US state code in its
// comma form (", NY"), so add the comma.
const cityRegion = (place) => place.replace(/^(.*\S)\s+([A-Z]{2})$/, '$1, $2');

/**
 * Map a teaser location clause (from teaserLocationClause) to a `location`
 * in the shapes scan.mjs's location_filter and workplace_policy read:
 *
 *   is 100% remote with no geographical restrictions  → "Remote (worldwide)"
 *   is based in New York NY                            → "New York, NY"
 *   can be based in London, or New York NY             → "London; New York, NY"
 *   is remote or can be based in Palo Alto CA          → "Remote; Palo Alto, CA"
 *   can be done remotely anywhere in the United States, or Canada
 *                                                      → "Remote (United States, Canada)"
 *   can be done remotely anywhere in North America or on-site in Chicago
 *                                                      → "Remote (North America); Chicago"
 *
 * "Remote (worldwide)" is one of the labels a country-only allow-list
 * accepts as worldwide, and Himalayas uses it too. "Remote ({region})" is
 * the form clearcompany, dover, join and trakstar use. Places are joined
 * with "; ", the separator location_filter's US state check splits on, so
 * "London; New York, NY" still reads as New York. The output never contains
 * "on-site": workplace_policy reads that word as an office role, which
 * would hide the remote option of a mixed listing.
 *
 * Returns '' for an empty or unrecognised clause. Job.location may be
 * empty, and location_filter passes an empty location unless `strict` is
 * set. 'Remote' would be a guess: one clause-less live item (2026-11-09) is
 * titled "Product Designer (New York only)".
 * @param {string} clause
 * @returns {string}
 */
export function locationFromClause(clause) {
  const c = String(clause ?? '').replace(/\.\s*Work remotely from anywhere\.?$/i, '').trim();
  if (/^is 100% remote with no geographical restrictions$/i.test(c)) return 'Remote (worldwide)';

  // "is remote or can be based in Palo Alto CA" (2026-11-12): remote with no
  // region named, or one of the cities.
  const based = c.match(/^(is remote or )?(?:is |can be )?based in (.+)$/i);
  if (based) {
    const places = splitPlaces(based[2]).map(cityRegion);
    return (based[1] ? ['Remote', ...places] : places).join('; ');
  }

  const remote = c.match(/^can be done remotely anywhere in (.+?)(?: or on-site in (.+))?$/i);
  if (remote) {
    const regions = splitPlaces(remote[1]);
    if (regions.length === 0) return '';
    const onsite = remote[2] ? splitPlaces(remote[2]).map(cityRegion) : [];
    return [`Remote (${regions.join(', ')})`, ...onsite].join('; ');
  }
  return '';
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
      // The same clause also gives `location`, through locationFromClause.
      const eligibilityText = teaserLocationClause(decodeFeedText(extractTag(block, 'description')));
      results.push({
        title,
        url: link,
        company,
        location: locationFromClause(eligibilityText),
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
