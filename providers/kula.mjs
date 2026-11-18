// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Kula provider — per-tenant public RSS jobs feed (→ tracked_companies:).
//
// Kula career sites live at `https://careers.kula.ai/<slug>`. The board page is
// a Next.js App Router app whose job list only exists inside the RSC flight
// payload, but every tenant also serves a zero-auth RSS 2.0 feed at
//   https://careers.kula.ai/<slug>/feed
// (`application/rss+xml`, with a `job:` extension namespace,
// xmlns:job="https://kula.ai/rss"). That feed is what this provider reads — a
// syndication format is a steadier contract than the React payload. Unknown
// tenant → 404 `{"errors":["err_account_not_found"]}`.
//
// Target list: `tracked_companies:` (one entry per employer; Kula is a
// single-employer-per-board ATS, not an aggregator).
//
// Item shape:
//   <title>, <link>, <guid>, <pubDate> (RFC 822, the job's launch time),
//   <category> (department), <description> (full JD HTML in CDATA),
//   <job:employmentType>, <job:workplace> (OFFICE|HYBRID|REMOTE),
//   <job:location>{ officeName, remote, city?, state?, country?, isHQ }</job:location>*,
//   <job:salary>{ currency, minAmount, maxAmount, interval, type }</job:salary>?
// Two tenant variants were observed live:
//   - one item PER OFFICE: <link> is `/<slug>/<id>/apply` and
//     <job:referencenumber> is `<id>-<officeId>` — items sharing an id are one
//     posting and are merged here;
//   - one item per posting: <link> is `/<slug>/<id>`, one <job:location> per
//     office.
// The description rides in the same feed, so `description` costs no extra
// request and no per-posting detail request is ever made.
//
// Identity: the feed carries no posting id outside the item link / guid (the
// `<job:referencenumber>` of the per-office variant is `<id>-<officeId>`, an
// office-level key, and the other variant has none), so `externalId` is that
// link id and no `listingIdentity` is returned (its posting id may not be
// parsed out of a URL); dedup falls back to Job.url.
//
// Job.url is `https://careers.kula.ai/<slug>/<id>` for both variants: the form
// the second variant's own <link> uses, and the posting page — Kula answers it
// with a 308 to the canonical `/<slug>/<id>-<title-slug>` page. It is kept
// instead of the canonical form because that one changes whenever a recruiter
// edits the title, and Job.url is the dedup key.
//
// SSRF: the only request is to a URL assembled from the fixed literal host
// and a slug validated against SLUG_RE; assertKulaFeedUrl re-checks it before
// the fetch and redirect:'error' refuses any hop. Item links are never
// fetched: they are parsed only for the numeric job id, and one that is not on
// careers.kula.ai under this tenant's slug drops that item.

import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchTextWithRetry } from './_http.mjs';
import { employmentTypeField } from './_employment-type.mjs';
import { normalizeWorkplaceType } from './_workplace-type.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

const KULA_HOST = 'careers.kula.ai';
const KULA_ORIGIN = `https://${KULA_HOST}`;
// Tenant slugs are lowercase [a-z0-9-]. Kula resolves slugs case-insensitively,
// so a config slug is lowercased first.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
// First path segments careers.kula.ai routes itself (`api`; `_next` and
// `robots.txt` serve assets and never pass SLUG_RE); only `api` survives it.
const RESERVED_SEGMENTS = new Set(['api']);
// Item link path: `/<slug>/<id>` or `/<slug>/<id>/apply`.
const JOB_PATH_RE = /^\/([^/]+)\/(\d{1,15})(?:\/apply)?\/?$/;

// The feed is one unpaginated document, so there is no page count to cap. The
// hard ceiling bounds the parse instead — items, not jobs, because the
// per-office variant repeats a posting once per office. A feed cut at the
// ceiling is marked truncated (`jobs.truncated`, reason `item-cap`).
export const MAX_FEED_ITEMS = 20_000;
// A multi-MB feed on a big tenant can take several seconds end to end; the
// shared 10 s default leaves too little room for a slow CDN miss.
const FEED_TIMEOUT_MS = 30_000;

// <job:interval> → annual multiplier. ONE_TIME and anything unknown drop that
// range rather than guess. BI_WEEKLY and SEMI_MONTHLY are left out on purpose:
// on those, the feed's interval is the payroll frequency, not the unit of the
// amounts. In a one-off sweep of tenant boards every non-placeholder range
// filed under them carried annual figures (a BI_WEEKLY 164100–222100 for a
// posting whose JD states the same as a yearly range), so ×26 / ×24 would
// have emitted seven-figure salaries and let salary_filter drop real postings.
// With the unit unknowable, no figure is emitted: an absent salary always
// passes salary_filter, a wrong one silently drops the job.
const INTERVAL_MULTIPLIERS = {
  YEARLY: 1,
  QUARTERLY: 4,
  MONTHLY: 12,
  WEEKLY: 52,
  DAILY: 260,
  HOURLY: 2080,
};
// The same mix-up turns up, more rarely, under the intervals that are read
// (an HOURLY 80000–100000 range, which ×2080 is $166M). A
// sub-annual range is annualized only when its figures look like per-period
// pay: an upper bound under ANNUAL_SIZED_AMOUNT and an annualized upper bound
// of at most MAX_ANNUALIZED. Both are currency-blind, so they also drop some
// genuine per-period ranges in high-denomination currencies (a ₹1,00,000
// monthly salary). That is the safe direction, for the reason above.
const ANNUAL_SIZED_AMOUNT = 20_000;
const MAX_ANNUALIZED = 2_000_000;
// Base units of the intervals above, for Job.salary.period / .posted.
const INTERVAL_PERIODS = {
  YEARLY: 'year',
  MONTHLY: 'month',
  WEEKLY: 'week',
  DAILY: 'day',
  HOURLY: 'hour',
};

/**
 * Tenant slug from `entry.api` (a feed URL) or `entry.careers_url` (the board
 * or any page under it): the first path segment of an https careers.kula.ai
 * URL, lowercased. Null for any other host, a non-https or malformed URL, a
 * reserved segment, or a slug outside SLUG_RE. Never throws.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string|null}
 */
function resolveSlug(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== KULA_HOST) continue;
    const segment = (parsed.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
    if (!SLUG_RE.test(segment) || RESERVED_SEGMENTS.has(segment)) continue;
    return segment;
  }
  return null;
}

/** Feed URL for a slug already validated by resolveSlug(). */
function feedUrlForSlug(slug) {
  return `${KULA_ORIGIN}/${slug}/feed`;
}

/** @param {string} url */
function assertKulaFeedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`kula: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`kula: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== KULA_HOST) {
    throw new Error(`kula: untrusted hostname "${parsed.hostname}" — must be ${KULA_HOST}`);
  }
  return url;
}

/** @param {import('./_types.js').PortalEntry} entry */
function entryName(entry) {
  return typeof entry?.name === 'string' ? entry.name.trim() : '';
}

/** @type {Provider} */
export default {
  id: 'kula',

  detect(entry) {
    const slug = resolveSlug(entry);
    return slug ? { url: feedUrlForSlug(slug) } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveSlug(entry);
    if (!slug) throw new Error(`kula: cannot derive a ${KULA_HOST}/<slug> feed for ${entryName(entry) || 'entry'}`);
    const feedUrl = assertKulaFeedUrl(feedUrlForSlug(slug));
    // One request whatever ctx.maxPages says: the feed is the whole board and
    // there is no enrichment to skip while probing. No catch — a rejection
    // (a 404 for an unknown tenant, a probe sentinel) propagates unwrapped.
    const xml = await fetchTextWithRetry(ctx, feedUrl, { redirect: 'error', timeoutMs: FEED_TIMEOUT_MS });
    return parseKulaFeed(xml, slug, entryName(entry));
  },
};

// Inner markup of the first <tag>…</tag> in a block, or null when absent.
// Tag names may carry a namespace prefix (job:city).
function tagInner(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : null;
}

// Every <tag>…</tag> inner in a block, in document order.
function tagInners(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  return [...block.matchAll(re)].map((m) => m[1]);
}

// Text of the first <tag>: a CDATA section is unwrapped as-is, anything else
// is entity-decoded (`Research &amp; Development` → `Research & Development`).
// '' when absent.
function tagText(block, tag) {
  const inner = tagInner(block, tag);
  if (inner === null) return '';
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return (cdata ? cdata[1] : decodeEntities(inner)).trim();
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Numeric job id from an item's <link> (falling back to <guid>), or null when
 * neither is an https careers.kula.ai URL under `slug`.
 * @param {string} meta - item markup with <description> removed
 * @param {string} slug
 */
function jobIdFromItem(meta, slug) {
  for (const tag of ['link', 'guid']) {
    const raw = tagText(meta, tag);
    if (!raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== KULA_HOST) continue;
    const m = parsed.pathname.match(JOB_PATH_RE);
    if (m && m[1].toLowerCase() === slug) return m[2];
  }
  return null;
}

/**
 * One office as a plain place. Kula geocodes offices into city / state /
 * country, which reads better for location_filter than the free-text office
 * name ("Headquarters", "Bengaluru Main"), so those win when present, with
 * repeats dropped ("Jakarta, Jakarta, Indonesia" → "Jakarta, Indonesia"); the
 * office name is the fallback.
 * @param {string} block - inner of one <job:location>
 */
function officePlace(block) {
  /** @type {string[]} */
  const parts = [];
  for (const tag of ['job:city', 'job:state', 'job:country']) {
    const v = tagText(block, tag);
    if (v && !parts.some((p) => p.toLowerCase() === v.toLowerCase())) parts.push(v);
  }
  const place = parts.length ? parts.join(', ') : tagText(block, 'job:officeName');
  // An office literally named "Remote" is a work model, not a place.
  return /^remote$/i.test(place) ? '' : place;
}

/**
 * One office as a location label: officePlace(), with " (Remote)" appended for
 * a remote office or a REMOTE posting — the same "United Kingdom (Remote)"
 * Kula's board prints.
 * @param {string} block - inner of one <job:location>
 * @param {boolean} postingIsRemote
 */
function officeLabel(block, postingIsRemote) {
  const place = officePlace(block);
  const remote = postingIsRemote || tagText(block, 'job:remote').toLowerCase() === 'true';
  if (!remote) return place;
  if (!place) return 'Remote';
  return /\bremote\b/i.test(place) ? place : `${place} (Remote)`;
}

/**
 * Annualized ranges from an item's <job:salary> blocks. Skipped, never
 * guessed: non-BASE pay; an interval not in INTERVAL_MULTIPLIERS; non-positive
 * bounds (a 0 would read as the floor in scan.mjs's salary_filter); the
 * "0.0–1.0" placeholder tenants file to hide the pay (an upper bound ≤ 1,
 * which ×2080 would read as a $2,080 job); and a sub-annual range whose
 * figures are annual-sized (see ANNUAL_SIZED_AMOUNT). `raw` is the range as
 * posted, `period` its base unit, `bothBounds` whether the feed gave both.
 * @param {string} meta
 * @returns {Array<{lo: number, hi: number, currency: string, period: string, raw: {min: number, max: number}, bothBounds: boolean}>}
 */
function salaryRanges(meta) {
  /** @param {string} v */
  const positive = (v) => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const out = [];
  for (const block of tagInners(meta, 'job:salary')) {
    const type = tagText(block, 'job:type').toUpperCase();
    if (type && type !== 'BASE') continue;
    const interval = tagText(block, 'job:interval').toUpperCase();
    if (!Object.hasOwn(INTERVAL_MULTIPLIERS, interval)) continue;
    const multiplier = INTERVAL_MULTIPLIERS[/** @type {keyof typeof INTERVAL_MULTIPLIERS} */ (interval)];
    const period = INTERVAL_PERIODS[/** @type {keyof typeof INTERVAL_PERIODS} */ (interval)];
    const min = positive(tagText(block, 'job:minAmount'));
    const max = positive(tagText(block, 'job:maxAmount'));
    if (min === null && max === null) continue;
    const a = /** @type {number} */ (min ?? max);
    const b = /** @type {number} */ (max ?? min);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi <= 1) continue;
    if (multiplier !== 1 && (hi >= ANNUAL_SIZED_AMOUNT || hi * multiplier > MAX_ANNUALIZED)) continue;
    out.push({
      lo: lo * multiplier,
      hi: hi * multiplier,
      currency: tagText(block, 'job:currency').toUpperCase(),
      period,
      raw: { min: lo, max: hi },
      bothBounds: min !== null && max !== null,
    });
  }
  return out;
}

/**
 * Parse a Kula `/<slug>/feed` RSS document. Exported for unit tests.
 *
 *   - title:          <title>, entity-decoded; an item without one is skipped.
 *   - url:            `https://careers.kula.ai/<slug>/<id>`, the id taken from
 *                     <link> (else <guid>), which must be an https
 *                     careers.kula.ai URL under this slug; any other item is
 *                     skipped.
 *   - externalId:     that `<id>`.
 *   - company:        `companyName` (the portals.yml name), else the channel
 *                     <title>.
 *   - location:       every office of the posting (all its items, in feed
 *                     order), de-duplicated and joined with "; " — see
 *                     officeLabel(). `locations` lists the same places without
 *                     the "(Remote)" suffix (omitted when none).
 *   - postedAt:       <pubDate> (NaN-safe); omitted when unusable.
 *   - description:    <description> HTML as plain text, kept whole.
 *   - employmentType: <job:employmentType> through the shared normalizer.
 *   - workplaceType:  <job:workplace> (OFFICE → onsite, HYBRID, REMOTE) when a
 *                     posting's items agree; omitted otherwise.
 *   - salary:         annualized min/max envelope of the <job:salary> ranges
 *                     salaryRanges() keeps, when they share one currency;
 *                     `period` / `posted` only when they also share one base
 *                     interval and every range gave both bounds.
 *
 * Items sharing a job id (the per-office variant) merge into one posting.
 * A body that is empty, not a string, or not RSS, or a feed whose items all
 * lack a recognisable job link (a format change), or whose envelope is
 * incomplete (no closing </channel> / </rss>, or an <item> never closed: a
 * body cut off mid-transfer), throws — so the board fails loud instead of
 * reading 0 forever. A complete RSS channel with no items is an honest empty
 * board and returns []. An item with no title is skipped. A feed cut at the item
 * ceiling returns the postings read with `jobs.truncated` set.
 *
 * @param {unknown} xml - raw feed body
 * @param {string} slug - validated tenant slug
 * @param {string} [companyName]
 * @param {{maxItems?: number}} [opts] - test hook; clamped to MAX_FEED_ITEMS
 * @returns {Array<{title: string, url: string, company: string, location: string, externalId: string, postedAt?: number, description?: string, employmentType?: string, workplaceType?: string, locations?: string[], salary?: {min: number, max: number, currency: string, period?: string, posted?: {min: number, max: number}}}>}
 */
export function parseKulaFeed(xml, slug, companyName = '', opts = {}) {
  const label = companyName || slug;
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new Error(`kula: ${label}: empty or non-text feed body (got ${xml === null ? 'null' : typeof xml})`);
  }
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) {
    throw new Error(`kula: ${label}: feed is not RSS (body starts ${JSON.stringify(xml.trim().slice(0, 80))})`);
  }
  // A body cut off mid-transfer keeps its opening tags but loses the closing
  // ones, and would otherwise match no item and read as an empty board. The
  // envelope must be complete, and every <item> opened must be closed. CDATA
  // is blanked first so a JD that mentions `<item>` cannot unbalance the
  // count.
  const outside = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const opened = (outside.match(/<item\b/gi) || []).length;
  const closed = (outside.match(/<\/item\s*>/gi) || []).length;
  if (!/<\/channel\s*>/i.test(outside) || !/<\/rss\s*>\s*$/i.test(outside) || opened !== closed) {
    throw new Error(`kula: ${label}: feed is incomplete or truncated (${opened} <item> opened, ${closed} closed; ends ${JSON.stringify(xml.trim().slice(-60))})`);
  }
  // The channel header runs up to the first <item>; its first <title> is the
  // tenant's display name (the <image> block repeats it further down).
  const firstItem = xml.search(/<item\b/i);
  const company = companyName || tagText(firstItem === -1 ? xml : xml.slice(0, firstItem), 'title');

  const allItems = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  const cap = Number.isInteger(opts?.maxItems) && /** @type {number} */ (opts.maxItems) > 0
    ? Math.min(/** @type {number} */ (opts.maxItems), MAX_FEED_ITEMS)
    : MAX_FEED_ITEMS;
  const items = allItems.slice(0, cap);
  const itemsCut = allItems.length > items.length;
  if (itemsCut) {
    console.error(`⚠️  kula: ${label}: feed has ${allItems.length} items; parsed the first ${items.length} (MAX_FEED_ITEMS)`);
  }

  /** @type {Map<string, {title: string, postedAt?: number, description: string, employmentType: string, workplaces: Set<string>, locations: string[], places: string[], salaries: ReturnType<typeof salaryRanges>}>} */
  const byId = new Map();
  let linked = 0;
  for (const item of items) {
    // Read the metadata with the (large, free-form) description cut out, so
    // markup inside the JD can never shadow an item-level tag.
    const desc = item.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);
    const meta = desc ? item.slice(0, desc.index) + item.slice(/** @type {number} */ (desc.index) + desc[0].length) : item;

    const id = jobIdFromItem(meta, slug);
    if (!id) continue;
    linked++;
    // An untitled item is malformed: it is dropped before it can create the
    // per-id aggregate, so its description, offices and salary never reach a
    // later valid item for the same job id.
    const title = tagText(meta, 'title');
    if (!title) continue;

    let agg = byId.get(id);
    if (!agg) {
      agg = { title: '', description: '', employmentType: '', workplaces: new Set(), locations: [], places: [], salaries: [] };
      byId.set(id, agg);
    }
    if (!agg.title) agg.title = title;
    const postedAt = toEpochMs(tagText(meta, 'pubDate'));
    if (postedAt !== undefined && (agg.postedAt === undefined || postedAt < agg.postedAt)) agg.postedAt = postedAt;
    if (!agg.description && desc) {
      // CDATA unwrapped in place (a body split into several sections to escape
      // `]]>` rejoins), then the shared two-pass decode + strip. Kept whole:
      // the description filters read the end of a JD too.
      agg.description = htmlToText(desc[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'), { cap: Infinity });
    }
    if (!agg.employmentType) agg.employmentType = tagText(meta, 'job:employmentType');
    const workplace = tagText(meta, 'job:workplace').toUpperCase();
    if (workplace) agg.workplaces.add(workplace);
    const postingIsRemote = workplace === 'REMOTE';
    const offices = tagInners(meta, 'job:location');
    const labels = offices.length ? offices.map((o) => officeLabel(o, postingIsRemote)) : [postingIsRemote ? 'Remote' : ''];
    for (const l of labels) {
      if (l && !agg.locations.some((x) => x.toLowerCase() === l.toLowerCase())) agg.locations.push(l);
    }
    for (const o of offices) {
      const place = officePlace(o);
      if (place && !agg.places.some((x) => x.toLowerCase() === place.toLowerCase())) agg.places.push(place);
    }
    agg.salaries.push(...salaryRanges(meta));
  }

  if (items.length > 0 && linked === 0) {
    const sample = tagText(items[0], 'link') || tagText(items[0], 'guid');
    throw new Error(`kula: ${label}: ${items.length} feed item(s) but none links to ${KULA_HOST}/${slug}/<id> (first link: ${JSON.stringify(sample)}) — feed format changed?`);
  }

  const jobs = [];
  for (const [id, agg] of byId) {
    /** @type {any} */
    const job = {
      title: agg.title,
      url: `${KULA_ORIGIN}/${slug}/${id}`,
      company,
      location: agg.locations.join('; '),
      externalId: id,
    };
    if (agg.places.length) job.locations = agg.places;
    if (agg.postedAt !== undefined) job.postedAt = agg.postedAt;
    if (agg.description) job.description = agg.description;
    Object.assign(job, employmentTypeField(agg.employmentType));
    if (agg.workplaces.size === 1) {
      const raw = [...agg.workplaces][0];
      const workplaceType = normalizeWorkplaceType(raw === 'OFFICE' ? 'onsite' : raw);
      if (workplaceType) job.workplaceType = workplaceType;
    }
    const currencies = new Set(agg.salaries.map((s) => s.currency));
    if (agg.salaries.length && currencies.size === 1) {
      job.salary = {
        min: Math.min(...agg.salaries.map((s) => s.lo)),
        max: Math.max(...agg.salaries.map((s) => s.hi)),
        currency: [...currencies][0],
      };
      const periods = new Set(agg.salaries.map((s) => s.period));
      if (periods.size === 1) {
        job.salary.period = [...periods][0];
        if (agg.salaries.every((s) => s.bothBounds)) {
          job.salary.posted = {
            min: Math.min(...agg.salaries.map((s) => s.raw.min)),
            max: Math.max(...agg.salaries.map((s) => s.raw.max)),
          };
        }
      }
    }
    jobs.push(job);
  }
  if (itemsCut) markTruncated(jobs, 'item-cap', { fetched: items.length, total: allItems.length });
  return jobs;
}
