// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ITJobs provider: itjobs.pt, the Portuguese IT job board. A `job_boards:`
// feed, wired in with an explicit provider:
//
//   - name: ITJobs
//     provider: itjobs
//     enabled: true
//
// PUBLIC FEED, NO AUTH. `https://feeds.itjobs.pt/feed/emprego` is the board's
// public RSS feed (linked from the site's home page). It serves the newest
// 30 offers by default; `limit=N` raises that, and measured on 2026-11-23
// `limit=1000` returned 714 items, the same "714 ofertas" the site shows, newest
// first, one request of about 400 KB. The feed also takes the site's search
// filters (`q`, `location`, `company`), but the whole board fits in that one
// request, so the provider reads all of it and leaves filtering to scan.mjs
// (`page` is ignored). ITJobs also has a keyed JSON API; the feed
// needs no key, so it is what this provider reads.
//
// ITEM SHAPE. `<title>` is the role. `<description>` is a short CDATA block of
// "Label: value" lines separated by <br />, the same on every item:
//
//   Função: SAS Guide Developer<br />
//   Empresa: Acme<br />
//   Tipo: Full-time<br />
//   Contrato: Contrato sem termo<br />
//   Localidade: Lisboa<br />
//   Modelo de trabalho: Híbrido<br />
//   Salário anual: n/d
//
// "n/d" means not stated. Empresa (the employer) was present on all 714 items;
// a row without it is dropped rather than attributed to the board. Localidade
// can list several places ("Lisboa, Porto"). Modelo de trabalho is a dedicated
// work-model field (Remoto / Híbrido / Presencial), so it sets `workplaceType`.
// Tipo is the hours (Full-time / Part-time) and goes through the shared
// employment-type normalizer. The block is a summary, not the job ad, so it is
// not returned as `description`. Salary is stated on few offers (22 of 714)
// and is not read.
//
// robots.txt: www.itjobs.pt states `Crawl-delay: 1` and disallows search and
// filter query strings on the site; feeds.itjobs.pt serves no robots.txt (404).
// The provider makes one request per scan.

import { decodeEntities } from './_html-entities.mjs';
import { employmentTypeField } from './_employment-type.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

/** Above the whole board (714 on 2026-11-23); reaching it means the board outgrew it. */
const FEED_LIMIT = 5000;
const FEED_URL = `https://feeds.itjobs.pt/feed/emprego?limit=${FEED_LIMIT}`;
const POSTING_HOSTS = new Set(['www.itjobs.pt', 'itjobs.pt']);

/** Modelo de trabalho → workplaceType. */
const WORK_MODELS = { remoto: 'remote', 'híbrido': 'hybrid', hibrido: 'hybrid', presencial: 'onsite' };

// Resolve a tag's inner text: unwrap a CDATA section, else decode entities.
function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeEntities(inner).trim();
}

// Same-length filler keeps positions aligned with the original string.
function maskCdataAndComments(str) {
  return str.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, (m) => '#'.repeat(m.length));
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

/** Collapse whitespace (including no-break spaces) after decoding entities. */
function clean(value) {
  return decodeEntities(String(value)).replace(/\s+/g, ' ').trim();
}

// NaN-safe Date.parse.
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : undefined;
}

// Only https: links to an ITJobs offer page are accepted; the query is dropped.
function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || !POSTING_HOSTS.has(parsed.hostname.toLowerCase())) return '';
    return `https://${parsed.hostname}${parsed.pathname}`;
  } catch {
    return '';
  }
}

/**
 * Read the "Label: value" lines of an item's description. "n/d" counts as absent.
 * @param {string} html
 * @returns {Map<string, string>} lower-cased label → value
 */
export function parseFields(html) {
  const fields = new Map();
  for (const line of String(html).split(/<br\s*\/?>/i)) {
    // Linear tag strip: an unclosed "<" is kept as text rather than scanned again.
    const text = clean(line.replace(/<[^>]*(>?)/g, (tag, close) => (close ? ' ' : tag)));
    const colon = text.indexOf(':');
    if (colon <= 0) continue;
    const label = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (value && value.toLowerCase() !== 'n/d' && !fields.has(label)) fields.set(label, value);
  }
  return fields;
}

/**
 * Parse the ITJobs RSS feed. Exported for unit tests.
 * @param {string} xml
 * @returns {{ jobs: Array<Record<string, any>>, rawCount: number }}
 */
export function parseItjobsFeed(xml) {
  const body = typeof xml === 'string' ? xml : '';
  if (!/<rss\b[\s\S]*<channel\b[\s\S]*<\/channel>/i.test(body)) {
    const got = typeof xml === 'string' ? `${xml.length}-char body` : typeof xml;
    throw new Error(`itjobs: unexpected feed response — expected an <rss><channel> envelope, got: ${got}`);
  }
  // Item tags are found in a copy with CDATA and comments masked (as in
  // germantechjobs), so a title like "XML <item> Developer" is not structure;
  // each block is then sliced from the real body to keep its CDATA text.
  const masked = maskCdataAndComments(body);
  const items = [...masked.matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)].map((m) => body.slice(m.index, m.index + m[0].length));
  // An <item> that never closes would otherwise drop out silently (or turn a
  // whole board into an empty one), so the item tags must pair up.
  const opened = (masked.match(/<item\b/gi) || []).length;
  if (opened !== items.length) {
    throw new Error(`itjobs: ${opened} <item> tag(s) but ${items.length} complete item(s) — the feed is malformed or cut short`);
  }
  const jobs = [];
  for (const item of items) {
    const url = cleanUrl(tagText(item, 'link') || tagText(item, 'guid'));
    if (!url) continue;
    const title = clean(tagText(item, 'title'));
    if (!title) continue;
    const fields = parseFields(tagText(item, 'description'));
    const company = fields.get('empresa') || '';
    if (!company) continue; // no identifiable employer
    const places = (fields.get('localidade') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const workplaceType = WORK_MODELS[(fields.get('modelo de trabalho') || '').toLowerCase()];
    // scan.mjs's location_filter reads only `location` and matches the English
    // word, so a remote row says "Remote" there too (as Ashby does), even when a
    // place already reads "Remoto"; `locations` keeps the places as listed.
    const shown = [...places];
    if (workplaceType === 'remote' && !shown.some((p) => /remote/i.test(p))) shown.push('Remote');
    const job = {
      title,
      company,
      location: shown.join(', '),
      url,
      ...(places.length > 0 ? { locations: places } : {}),
      ...(workplaceType ? { workplaceType } : {}),
      ...employmentTypeField(fields.get('tipo')),
    };
    const postedAt = toEpochMs(tagText(item, 'pubDate'));
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  if (items.length && !jobs.length) {
    throw new Error(`itjobs: ${items.length} feed item(s) but none parsed — the feed format may have changed`);
  }
  return { jobs, rawCount: items.length };
}

/** @type {Provider} */
export default {
  id: 'itjobs',

  // Explicit-only: one board-wide feed, no per-entry URL.
  detect(entry) {
    return entry?.provider === 'itjobs' ? { url: FEED_URL } : null;
  },

  async fetch(entry, ctx) {
    // Fixed literal host; redirect:'error' keeps the request on it.
    const xml = await ctx.fetchText(FEED_URL, { redirect: 'error' });
    const { jobs, rawCount } = parseItjobsFeed(xml);
    if (rawCount >= FEED_LIMIT) {
      console.error(`⚠️  itjobs: ${entry?.name || 'entry'} read ${rawCount} items, the feed limit; the board may have more`);
      markTruncated(jobs, 'page-cap', { fetched: jobs.length });
    }
    return jobs;
  },
};
