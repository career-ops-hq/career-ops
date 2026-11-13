// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Workable provider — public, no-auth account widget API:
//   GET https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true
//   → { name, description, jobs: [{ title, shortcode, shortlink, url, department,
//        city, state, country, telecommuting, published_on, description, … }] }
//
// The widget API returns the account's FULL posting list in one request (verified
// live against a 259-posting account) and ships `description` + `published_on`
// for free, so scan.mjs's content_filter and the recency logic in
// scan-ats-full.mjs both work for Workable companies.
//
// The older markdown feed at /<slug>/jobs.md is kept as a fallback only. It
// cannot be the primary path:
//   · on a large account the bare feed returns a department *summary* instead of
//     the job table, so there are no rows to parse — a 259-posting account
//     silently yielded ZERO jobs;
//   · it is hard-capped at 30 rows and honours no pagination parameter
//     (page/offset/limit/startrow all return the same first 30);
//   · segmenting by `?department=` is incomplete (departments listed in the
//     summary sum to less than the account total, and a department over 30 roles
//     is itself truncated).
//
// Auto-detects from careers_url pattern `https://apply.workable.com/<slug>`. A
// tracked_companies entry can also set `provider: workable` to bypass detection.
//
// Requests to both the widget API and the markdown fallback carry browser-like
// headers and go through retry-with-backoff, and are serialized process-wide
// against apply.workable.com — Cloudflare fronts every tenant on that single
// host and can rate-limit or (for a specific account) block the widget API
// path for hours at a time while the markdown feed on that same account keeps
// returning 200. An hours-long `Retry-After` is not worth honouring; giving up
// fast and falling through to the markdown feed serves the scan better than
// stalling on it.
//
// The end of this file also reads Workable's public XML job feed, which
// carries every tenant's postings at once (loadWorkableFeed). scan.mjs never
// uses it; scan-ats-full.mjs does, as its Workable source.

import { decodeEntities } from './_html-entities.mjs';
import { BROWSER_LIKE_USER_AGENT, fetchTextStream, isRetryableError, parseRetryAfterMs, sleep } from './_http.mjs';

const ALLOWED_WORKABLE_HOSTS = new Set(['apply.workable.com']);

// Workable account slugs are alphanumerics plus - and _ . Anything else is
// rejected rather than interpolated, so a crafted careers_url cannot escape the
// path (e.g. `..%2f..%2f`) when we build the API URL.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const WORKABLE_HEADERS = {
  'user-agent': BROWSER_LIKE_USER_AGENT,
  'accept-language': 'en-US,en;q=0.9',
  origin: 'https://apply.workable.com',
};

// Retry policy for a single request (429 with a short Retry-After, 5xx,
// timeouts/aborts — classified by _http.mjs's isRetryableError/parseRetryAfterMs,
// shared with workday.mjs / oraclecloud.mjs). The loop itself stays local
// rather than routing through _http.mjs's fetchJsonWithRetry: this provider
// needs to give up before exhausting its retries when the server declares a
// long Retry-After (see GIVE_UP_RETRY_AFTER_MS below), which the shared
// helper's clamp-and-keep-retrying policy doesn't support, and it retries
// both a JSON call (widget API) and a text call (markdown feed), where the
// shared helper only wraps fetchJson.
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;

// A server-declared Retry-After beyond this isn't worth waiting out — give up
// on the widget API immediately and fall through to the markdown feed instead
// of stalling the scan for it.
const GIVE_UP_RETRY_AFTER_MS = 30_000;

/**
 * Runs `fn`, retrying transient failures with backoff + jitter. Gives up
 * immediately (no more retries) on a Retry-After longer than
 * GIVE_UP_RETRY_AFTER_MS, or on a non-retryable error.
 */
async function fetchWithRetry(ctx, fn) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryableError(err)) throw err;
      const retryAfterMs = parseRetryAfterMs(err?.retryAfter);
      if (retryAfterMs !== null && retryAfterMs > GIVE_UP_RETRY_AFTER_MS) throw err;
      const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
      const delayMs = retryAfterMs !== null ? retryAfterMs : (backoff + Math.random() * 250);
      await sleep(delayMs, ctx);
    }
  }
  throw lastErr;
}

// Process-wide serialization: apply.workable.com fronts every tenant on the
// same host, so this process never needs more than one in-flight request to
// it at a time.
let workableQueue = Promise.resolve();
function serialized(fn) {
  const result = workableQueue.then(fn, fn);
  workableQueue = result.then(() => undefined, () => undefined);
  return result;
}

function assertWorkableUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`workable: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`workable: URL must use HTTPS: ${url}`);
  if (!ALLOWED_WORKABLE_HOSTS.has(parsed.hostname)) {
    throw new Error(`workable: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_WORKABLE_HOSTS].join(', ')}`);
  }
  return url;
}

/**
 * Extract the account slug from a tracked_companies entry's careers_url.
 * @returns {string|null}
 */
export function resolveWorkableSlug(entry) {
  const raw = entry && typeof entry.careers_url === 'string' ? entry.careers_url : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'apply.workable.com') return null;
  const slug = parsed.pathname.split('/').filter(Boolean)[0];
  if (!slug || !SLUG_RE.test(slug)) return null;
  return slug;
}

const widgetUrlFor = (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`;
const feedUrlFor = (slug) => `https://apply.workable.com/${slug}/jobs.md`;

/** @type {Provider} */
export default {
  id: 'workable',

  detect(entry) {
    const slug = resolveWorkableSlug(entry);
    return slug ? { url: widgetUrlFor(slug) } : null;
  },

  async fetch(entry, ctx) {
    const slug = resolveWorkableSlug(entry);
    if (!slug) throw new Error(`workable: cannot derive feed URL for ${entry.name}`);

    const referer = `https://apply.workable.com/${slug}/`;

    return serialized(async () => {
      // Primary: widget API. assertWorkableUrl + redirect:'error' together
      // guarantee the final hostname stays in the allowlist (no SSRF via
      // redirect). Retries transient failures; gives up early on a
      // long-lived Retry-After so a Cloudflare-level block on this path
      // falls through to the markdown feed instead of stalling the scan.
      const apiUrl = assertWorkableUrl(widgetUrlFor(slug));
      let payload = null;
      try {
        payload = await fetchWithRetry(ctx, () => ctx.fetchJson(apiUrl, {
          redirect: 'error',
          headers: { ...WORKABLE_HEADERS, referer },
        }));
      } catch {
        payload = null; // fall through to the markdown feed
      }
      if (payload && Array.isArray(payload.jobs)) {
        return parseWorkableWidget(payload, entry.name, slug);
      }

      // Fallback: legacy markdown feed (small accounts only — see header note).
      const feedUrl = assertWorkableUrl(feedUrlFor(slug));
      const text = await fetchWithRetry(ctx, () => ctx.fetchText(feedUrl, {
        redirect: 'error',
        headers: { ...WORKABLE_HEADERS, referer },
      }));
      return parseWorkableMarkdown(text, entry.name);
    });
  },
};

/**
 * Validate a job URL against the Workable allowlist.
 * @returns {string|null} normalized href, or null when it must be dropped
 */
function safeJobUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_WORKABLE_HOSTS.has(parsed.hostname)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// Joins the locations of a multi-country posting into one cell. This is the
// shape location_filter already expects — see buildLocationFilter in scan.mjs,
// whose always_allow tier exists precisely so "Stockholm · London · Madrid"
// survives one blocked city — and the shape the Ashby provider already emits.
const LOCATION_SEPARATOR = ' · ';

/**
 * Build the location string for ONE widget entry. The markdown feed rendered
 * "<city>, <country>"; we match that shape so location_filter behaves
 * identically across both paths.
 *
 * State is the place only when the city is blank. A state with no city
 * (Queensland, New South Wales) otherwise collapses to the country. When a
 * city is set, state stays off the string: adding it would rewrite history
 * keys that already stored "city, country".
 *
 * telecommuting with a place is applied once by the fold below. Here it is
 * only the fallback for a row that has no place at all.
 */
function formatLocation(job) {
  const city = typeof job?.city === 'string' ? job.city.trim() : '';
  const state = typeof job?.state === 'string' ? job.state.trim() : '';
  const country = typeof job?.country === 'string' ? job.country.trim() : '';
  const parts = [];
  if (city) parts.push(city);
  else if (state) parts.push(state);
  if (country) parts.push(country);
  if (parts.length) return parts.join(', ');
  return job?.telecommuting ? 'Remote' : '';
}

/** Strip HTML tags/entities from the widget's rich-text description. */
function toPlainText(html) {
  if (typeof html !== 'string' || !html) return '';
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Opaque board and posting ids, per docs/listing-fingerprint.md: a nonempty
// string with no surrounding whitespace and no ASCII controls. Anything else
// is not an id. Numbers are not coerced, and nothing is trimmed or case-folded.
function opaqueListingId(value) {
  if (typeof value !== 'string' || value === '' || value !== value.trim()) return undefined;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return undefined;
  return value;
}

/**
 * The posting's ATS-native identity: the account slug the board was already
 * resolved at, and the widget payload's `shortcode`, never a token parsed out
 * of a URL. Returns undefined unless the shortcode is a clean opaque string
 * and the slug is an account slug this provider would resolve, so an unusable
 * shortcode or slug leaves that row on URL dedup.
 * Exported for unit tests.
 *
 * @param {string | null | undefined} slug
 * @param {unknown} shortcode
 * @returns {{ats_provider: 'workable', board_slug: string, posting_id: string} | undefined}
 */
export function workableListingIdentity(slug, shortcode) {
  const board = opaqueListingId(slug);
  const postingId = opaqueListingId(shortcode);
  // The slug is the account namespace resolveWorkableSlug already accepted.
  // A string that could not be that namespace is not a board_slug.
  if (!board || !SLUG_RE.test(board) || !postingId) return undefined;
  return { ats_provider: 'workable', board_slug: board, posting_id: postingId };
}

/**
 * Parse the widget API payload. Exported for unit tests.
 *
 * A multi-country posting is FANNED OUT by this endpoint into one entry per
 * location, every one carrying the same shortlink, title, description and
 * published_on and differing only in city/state/country. Verified live
 * 2026-10-06 against DigitalGenius: "Implementation Engineer" (801183DB79)
 * comes back as four entries — London/United Kingdom, Romania, Poland,
 * Croatia — and "Solutions Engineer" (7C59A413E4) as three more.
 *
 * The siblings are therefore folded together here: the first entry supplies
 * every field, the rest contribute only their location, and the accumulated
 * set is joined with LOCATION_SEPARATOR. Discarding them (first-wins on URL,
 * which is what this did before) recorded that role as "London, United
 * Kingdom" alone, so a UK block rule rejected a posting that had three viable
 * EU alternatives.
 *
 * Two dead ends, both measured rather than assumed:
 *   · each entry's own `locations[]` array holds ONLY that entry's single
 *     location, so it is not a shortcut to the full set;
 *   · the per-job detail endpoint (/api/v1/accounts/<slug>/jobs/<shortcode>)
 *     does carry a complete array, but costs one extra request per posting.
 * The markdown fallback in parseWorkableMarkdown cannot be fixed the same way:
 * it does not fan out, it just prints the primary location and drops the rest
 * at the source, so nothing is left in its rows to accumulate.
 *
 * listingIdentity belongs to the folded posting, not to each location row.
 * It is attached once, after the fold, from the first entry's `shortcode`
 * (the same entry that supplies every non-location field) and the account
 * slug the caller already resolved. A sibling does not get its own identity,
 * and a shortcode is never read out of the URL. No slug, or a shortcode that
 * is missing, padded, numeric or carrying a control character, leaves
 * listingIdentity off so the scan keeps URL dedup.
 *
 * @param {any} payload — parsed JSON body of the widget endpoint
 * @param {string} companyName — value to write into job.company
 * @param {string} [boardSlug] Account slug the board was already resolved at.
 *   Callers with no namespace (the public XML feed) omit it and get no identity.
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, postedAt?: number, listingIdentity?: {ats_provider: string, board_slug: string, posting_id: string}}>}
 */
export function parseWorkableWidget(payload, companyName, boardSlug) {
  if (!payload || !Array.isArray(payload.jobs)) return [];
  const jobs = [];
  /** @type {Map<string, {job: any, locations: Set<string>, tele: boolean, shortcode: unknown}>} */
  const byUrl = new Map();
  for (const raw of payload.jobs) {
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    if (!title) continue;

    // shortlink is the canonical public permalink; url is the same host. Either
    // is fine, both are validated. Off-domain or non-https entries are dropped.
    const url = safeJobUrl(raw?.shortlink) || safeJobUrl(raw?.url);
    if (!url) continue;

    const location = formatLocation(raw);
    // Same truthiness as the empty-place fallback above. Any sibling can carry
    // the flag; the folded posting says Remote once.
    const tele = Boolean(raw?.telecommuting);

    const merged = byUrl.get(url);
    if (merged) {
      // Fanned-out sibling of a posting already emitted: it contributes its
      // location and the telecommuting flag. Empty locations add nothing; a
      // repeated one collapses, so the cell never says "Romania · Romania".
      if (location) merged.locations.add(location);
      if (tele) merged.tele = true;
      continue;
    }

    /** @type {any} */
    const job = { title, url, location, company: companyName };

    const description = toPlainText(raw?.description);
    if (description) job.description = description;

    const stamp = Date.parse(raw?.published_on || raw?.created_at || '');
    if (Number.isFinite(stamp)) job.postedAt = stamp;

    jobs.push(job);
    byUrl.set(url, { job, locations: new Set(location ? [location] : []), tele, shortcode: raw?.shortcode });
  }

  // A Set iterates in insertion order, so the joined cell follows payload order
  // and a single-location posting re-joins to the exact string it already had.
  // Remote is appended once, after the join, and only when no place already
  // says it — an empty-place row already contributed the word "Remote".
  // Identity is applied here, on the merged posting, from the first entry's
  // shortcode. Siblings contributed locations only.
  for (const { job, locations, tele, shortcode } of byUrl.values()) {
    let location = [...locations].join(LOCATION_SEPARATOR);
    if (tele && !/remote/i.test(location)) {
      location = location ? `${location}${LOCATION_SEPARATOR}Remote` : 'Remote';
    }
    job.location = location;
    const listingIdentity = workableListingIdentity(boardSlug, shortcode);
    if (listingIdentity) job.listingIdentity = listingIdentity;
  }
  return jobs;
}

/**
 * Parse Workable's public markdown feed. Fallback path — see the header note on
 * why this can't be primary. Exported as a named export for unit tests. The feed
 * exposes a table:
 *   | Title | Department | Location | Type | Salary | Posted | Details |
 * where `Details` holds a markdown link
 *   [View](https://apply.workable.com/<slug>/jobs/view/<id>.md)
 * URLs are validated against `https://apply.workable.com/` — off-domain or
 * non-HTTPS [View] links are skipped (not emitted).
 *
 * @param {string} text — markdown body
 * @param {string} companyName — value to write into job.company
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseWorkableMarkdown(text, companyName) {
  if (typeof text !== 'string') return [];
  const jobs = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || !line.includes('[View]')) continue;
    const cols = line.split('|').map(c => c.trim());
    // Cols: ['', title, dept, location, type, salary, posted, '[View](url.md)', '']
    if (cols.length < 8) continue;
    const title = cols[1];
    if (!title || title === 'Title') continue;
    const location = cols[3] || '';
    const urlMatch = line.match(/\[View\]\(([^)]+)\)/);
    let url = urlMatch ? urlMatch[1] : '';
    if (url.endsWith('.md')) url = url.slice(0, -3);
    if (!url) continue;  // skip rows with no resolvable URL (e.g., malformed [View] link)

    const safe = safeJobUrl(url);
    if (!safe) continue;

    jobs.push({ title, url: safe, location, company: companyName });
  }
  return jobs;
}

// ── Public XML job feed ─────────────────────────────────────────────────
//
// Every posting published on Jobs by Workable, for every Workable ATS
// tenant, in one document:
//
//   GET https://www.workable.com/boards/workable.xml
//   <source><publisher/><publisherurl/>
//     <job><title/><date/><referencenumber/><url/><company/><city/><state/>
//          <country/><remote/><postalcode/><description/><education/>
//          <jobtype/><category/><experience/><website/></job> ...
//   </source>
//
// Workable documents it for job boards it has no integration with, updates it
// every hour, and asks that the posting URLs are not altered, because they
// attribute candidates. Each `<url>` is the tenant's own share link,
// `https://apply.workable.com/j/<shortcode>`, the URL the widget path above
// emits for a tracked company, so a posting from the feed and the same posting
// from a tracked company's careers page are one dedup key.
//
// The document is large (about 870 MB of XML, served as about 140 MB of
// brotli), so it is read with fetchTextStream and parsed one `<job>` at a time;
// only the postings that pass the caller's date window and title filter are
// kept. Every value sits in CDATA; `<country>` is an ISO 3166 code, turned into
// its English name here because location_filter is written in names.
//
// Like the widget, the feed lists a posting once per location, each row with
// the same `<url>`. Rows are handed to parseWorkableWidget, which folds them
// into one posting with every location, oldest row first, so a posting's date
// is the date it was first published. `<date>` follows the widget's
// `published_on`: it moves when a tenant republishes a posting, not when the
// feed is rebuilt.

export const WORKABLE_FEED_URL = 'https://www.workable.com/boards/workable.xml';
// The whole transfer, headers included: the first byte has been seen after
// about 18 s and the body after about 40 s.
export const WORKABLE_FEED_TIMEOUT_MS = 10 * 60_000;
// Decoded size, several times the size the feed has been seen at.
export const WORKABLE_FEED_MAX_BYTES = 4 * 1024 * 1024 * 1024;
// One `<job>` has been seen at up to about 44 KB; anything near this is not a
// posting but a feed whose closing tag never arrives.
const MAX_FEED_JOB_CHARS = 1024 * 1024;
// Rows kept in memory, after the date window and the title filter. A 7-day
// window with no title filter has kept about 19,000 rows in about 430 MB.
export const WORKABLE_FEED_MAX_KEPT_ROWS = 25_000;
const FEED_JOB_OPEN = '<job>';
const FEED_JOB_CLOSE = '</job>';
const FEED_SOURCE_OPEN = '<source>';
const FEED_SOURCE_CLOSE = '</source>';
// Between jobs only a tail this long is kept: enough to finish any of these
// tags when a piece ends inside it.
const FEED_TAIL_CHARS = Math.max(FEED_JOB_OPEN.length, FEED_SOURCE_OPEN.length, FEED_SOURCE_CLOSE.length) - 1;

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * English country name for an ISO 3166-1 alpha-2 code, or the value as given.
 * @param {string} code
 */
export function feedCountryName(code) {
  const c = String(code ?? '').trim();
  if (!/^[A-Za-z]{2}$/.test(c)) return c;
  try {
    return regionNames.of(c.toUpperCase()) ?? c;
  } catch {
    return c;
  }
}

/**
 * The text of one child element of a feed `<job>`: its CDATA sections joined,
 * any text outside them entity-decoded, trimmed. Empty when the element is
 * absent.
 * @param {string} block
 * @param {string} name
 */
export function readFeedField(block, name) {
  const open = `<${name}>`;
  const start = block.indexOf(open);
  if (start === -1) return '';
  let pos = start + open.length;
  let out = '';
  while (pos < block.length) {
    if (block.startsWith('<![CDATA[', pos)) {
      const end = block.indexOf(']]>', pos + 9);
      if (end === -1) break;
      out += block.slice(pos + 9, end);
      pos = end + 3;
      continue;
    }
    const next = block.indexOf('<', pos);
    if (next === -1) break;
    out += decodeEntities(block.slice(pos, next));
    pos = next;
    if (!block.startsWith('<![CDATA[', pos)) break; // the closing tag, or markup the feed does not use
  }
  return out.trim();
}

/**
 * One feed `<job>` in the widget's row shape, so parseWorkableWidget can read
 * it. Null when the block has no title or URL.
 * @param {string} block
 */
export function feedRowToWidgetRow(block) {
  const title = readFeedField(block, 'title');
  const url = readFeedField(block, 'url');
  if (!title || !url) return null;
  const stamp = Date.parse(readFeedField(block, 'date'));
  return {
    title,
    shortlink: url,
    city: readFeedField(block, 'city'),
    state: readFeedField(block, 'state'),
    country: feedCountryName(readFeedField(block, 'country')),
    telecommuting: readFeedField(block, 'remote').toLowerCase() === 'true',
    published_on: Number.isNaN(stamp) ? '' : new Date(stamp).toISOString(),
    description: readFeedField(block, 'description'),
    company: readFeedField(block, 'company'),
    website: readFeedField(block, 'website'),
    _postedMs: Number.isNaN(stamp) ? null : stamp,
  };
}

/**
 * Cut a text stream into `<job>…</job>` blocks.
 * @param {(block: string) => void} onBlock
 */
export function createFeedJobSplitter(onBlock) {
  let buf = '';
  let sawSource = false;
  let sawSourceEnd = false;
  return {
    /** @param {string} text */
    push(text) {
      buf += text;
      for (;;) {
        if (!sawSource && buf.includes(FEED_SOURCE_OPEN)) sawSource = true;
        const start = buf.indexOf(FEED_JOB_OPEN);
        if (start === -1) {
          // Only text between jobs is searched for the root's closing tag, so
          // a `</source>` inside a posting's CDATA never counts.
          if (sawSource && buf.includes(FEED_SOURCE_CLOSE)) sawSourceEnd = true;
          buf = buf.slice(-FEED_TAIL_CHARS);
          return;
        }
        if (sawSource && buf.slice(0, start).includes(FEED_SOURCE_CLOSE)) sawSourceEnd = true;
        const end = buf.indexOf(FEED_JOB_CLOSE, start);
        if (end === -1) {
          if (buf.length - start > MAX_FEED_JOB_CHARS) {
            throw new Error(`workable feed: a <job> element runs past ${MAX_FEED_JOB_CHARS} characters without a closing tag`);
          }
          buf = buf.slice(start);
          return;
        }
        onBlock(buf.slice(start, end + FEED_JOB_CLOSE.length));
        buf = buf.slice(end + FEED_JOB_CLOSE.length);
      }
    },
    get sawSource() {
      return sawSource;
    },
    /** True once the root's closing tag has arrived: the document was not cut short. */
    get sawSourceEnd() {
      return sawSourceEnd;
    },
  };
}

/**
 * Read the feed and keep the postings a reverse scan wants.
 *
 * A posting is kept when its title passes `titleFilter` (called with the
 * employer's name, which stands in for the company slug of other sources) and
 * none of its rows is older than `cutoffMs`: the posting's date is its oldest
 * row. A row with no date counts only with `includeUndated`. Every employer
 * in the feed is returned, with no postings when none was kept.
 *
 * Throws, so the caller keeps nothing from a bad read, when the response is
 * not the feed (no `<source>` root), when it ends before `</source>` (a body
 * cut short would otherwise read as a smaller feed), when a `<job>` never
 * closes, and when more than `maxKeptRows` rows pass the window and the title
 * filter (the kept postings, not the download, are what fills memory).
 *
 * @param {{
 *   cutoffMs: number,
 *   includeUndated?: boolean,
 *   titleFilter: (title: string, companySlug?: string) => boolean,
 *   fetchStream?: typeof fetchTextStream,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 *   maxKeptRows?: number,
 * }} opts
 * @returns {Promise<{ companies: Array<{ company: string, website: string, jobs: any[] }>, stats: { rows: number, keptRows: number, postings: number, staleRows: number, undatedRows: number, bytes: number } }>}
 */
export async function loadWorkableFeed({
  cutoffMs, includeUndated = false, titleFilter,
  fetchStream = fetchTextStream,
  timeoutMs = WORKABLE_FEED_TIMEOUT_MS, maxBytes = WORKABLE_FEED_MAX_BYTES,
  maxKeptRows = WORKABLE_FEED_MAX_KEPT_ROWS,
}) {
  /** @type {Map<string, any[]>} posting URL → its rows */
  const rowsByUrl = new Map();
  /** Postings with a row older than the window: the posting is older than it. */
  const stale = new Set();
  const stats = { rows: 0, keptRows: 0, postings: 0, staleRows: 0, undatedRows: 0, bytes: 0 };
  let held = 0;
  /** @type {Map<string, string>} every employer in the feed → its website */
  const employers = new Map();

  const splitter = createFeedJobSplitter((block) => {
    stats.rows++;
    const row = feedRowToWidgetRow(block);
    if (!row || !row.company) return;
    if (!employers.get(row.company)) employers.set(row.company, row.website);
    if (!titleFilter(row.title, row.company)) return;
    const key = row.shortlink;
    if (row._postedMs === null) {
      stats.undatedRows++;
      if (!includeUndated) return;
    } else if (row._postedMs < cutoffMs) {
      stats.staleRows++;
      stale.add(key);
      held -= rowsByUrl.get(key)?.length ?? 0;
      rowsByUrl.delete(key);
      return;
    }
    if (stale.has(key)) return;
    if (++held > maxKeptRows) {
      throw new Error(`workable feed: more than ${maxKeptRows} feed rows pass the --since window and the title filter; narrow --since or title_filter`);
    }
    const rows = rowsByUrl.get(key) ?? [];
    rows.push(row);
    rowsByUrl.set(key, rows);
  });

  // A fixed literal URL, so there is no host to check before the request;
  // redirect: 'error' keeps the response on that host.
  const { bytes } = await fetchStream(WORKABLE_FEED_URL, { timeoutMs, maxBytes, redirect: 'error' }, (text) => { splitter.push(text); });
  stats.bytes = bytes;
  if (!splitter.sawSource) {
    throw new Error('workable feed: unexpected response — no <source> element');
  }
  if (!splitter.sawSourceEnd) {
    throw new Error(`workable feed: the response ended before </source> after ${stats.rows} <job> rows; the feed was cut short`);
  }

  /** @type {Map<string, any[]>} employer → its kept rows */
  const rowsByCompany = new Map();
  for (const rows of rowsByUrl.values()) {
    stats.keptRows += rows.length;
    const { company } = rows[0];
    const group = rowsByCompany.get(company) ?? [];
    group.push(...rows);
    rowsByCompany.set(company, group);
  }
  // Every employer in the feed is a board, an empty one when none of its
  // postings passed, as every tenant of a directory is for the other sources.
  const companies = [];
  for (const [company, website] of employers) {
    const rows = rowsByCompany.get(company) ?? [];
    // Oldest row first: parseWorkableWidget takes a posting's date from the
    // first row it sees for that URL.
    rows.sort((a, b) => (a._postedMs ?? Infinity) - (b._postedMs ?? Infinity));
    const jobs = parseWorkableWidget({ jobs: rows }, company);
    stats.postings += jobs.length;
    companies.push({ company, website, jobs });
  }
  companies.sort((a, b) => a.company.localeCompare(b.company));
  return { companies, stats };
}
