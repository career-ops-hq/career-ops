// @ts-check
import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, resolveDefaultTimeoutMs, sleep } from './_http.mjs';
import { isWorkModelOnly } from './greenhouse.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';
/** @typedef {import('./_types.js').Provider} Provider */

// Teamtailor provider — per-tenant public RSS feed.
//
// Every Teamtailor career site exposes a zero-auth XML jobs feed at
// `https://<slug>.teamtailor.com/jobs.rss`. The feed is public and no-auth, so
// it is parsed in-process with the same tiny tag extractor as
// providers/nodesk.mjs / providers/personio.mjs rather than adding an XML
// dependency.
//
// `/jobs.rss` serves only a tenant's first 100 postings, so the feed is walked
// with `?offset=` in steps of that default page size until a page comes back
// short. Observed on a branded-domain tenant with ~151 postings: `?page=2` is
// ignored (the same 100 items), `?offset=100` returns 51, `?offset=150` 1, and
// an offset past the end a well-formed `<channel>` with no `<item>`. A larger
// `?per_page=500` also returned all 151, but how far the server honours
// `per_page` is unknown: a silent clamp would truncate a big board with no
// short page to reveal it. `offset` keeps every request at the size the feed
// serves by default, so a short page is a trustworthy end-of-feed signal. A
// page that is not a whole RSS `<channel>` (an error or maintenance page sent
// with a 200, or a body cut off before `</channel>`) is a failed page, not a
// short one: an error on the first page, a partial board on a later one.
//
// A walk is also bounded by its own wall-clock budget. The sweep in
// scan-ats-full.mjs gives one board 5 minutes and, when that fires, discards
// everything the board had read (the provider only sees an abort at that same
// instant, too late to hand pages back). So the walk stops itself before then
// and returns the pages already read, marked partial. The budget is sized from
// the request timeout, so the page in flight when it runs out, retries
// included, still ends before the watchdog (see WALK_END_MS).
//
// Auto-detects `https://<slug>.teamtailor.com/...` careers URLs. Many tenants
// front the same feed on a branded domain (e.g. careers.acme.com also serves
// /jobs.rss), so an entry with an explicit `provider: teamtailor` may point its
// `careers_url` (or `api:`) at that branded host and it will be used directly.
//
// SSRF stance mirrors the other providers: auto-detection stays pinned to
// `*.teamtailor.com` so untrusted careers URLs can never steer the fetch at an
// arbitrary host; a branded host is honored only when the user opted in with an
// explicit `provider: teamtailor`. Either way the fetch is HTTPS-only with
// `redirect: 'error'`. Job `<link>`s (branded domains) are emitted as-is and
// never fetched.

const TEAMTAILOR_HOST_RE = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.teamtailor\.com$/i;

/**
 * Validate a feed URL before fetching. Always HTTPS-only. The hostname is
 * pinned to `*.teamtailor.com` for auto-detected entries; an explicit
 * `provider: teamtailor` entry may use its configured branded host.
 * @param {string} url
 * @param {{ explicit?: boolean }} [opts]
 */
function assertFeedUrl(url, { explicit = false } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`teamtailor: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`teamtailor: URL must use HTTPS: ${url}`);
  if (!explicit && !TEAMTAILOR_HOST_RE.test(parsed.hostname)) {
    throw new Error(`teamtailor: untrusted hostname "${parsed.hostname}" — must be <slug>.teamtailor.com (or set "provider: teamtailor" to use a branded careers domain)`);
  }
  return url;
}

// Derive the RSS feed URL from a tracked_companies entry by normalizing any
// path on the configured host to /jobs.rss. Auto-detection (explicit=false)
// only claims *.teamtailor.com hosts; an explicit `provider: teamtailor` entry
// (explicit=true) may use a branded careers host. Returns null otherwise.
/**
 * @param {import('./_types.js').PortalEntry} entry
 * @param {{ explicit?: boolean }} [opts]
 */
function resolveFeedUrl(entry, { explicit = false } = {}) {
  const raw = entry?.api || entry?.careers_url || '';
  if (typeof raw !== 'string' || !raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!explicit && !TEAMTAILOR_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}/jobs.rss`;
}

const PAGE_SIZE = 100;           // items `/jobs.rss` serves per request
const DEFAULT_MAX_PAGES = 20;    // 20 * 100 = 2,000 postings, when the entry sets no max_pages
const MAX_PAGES_CAP = 100;       // hard ceiling even for a user override (10,000 postings)
const INTER_PAGE_DELAY_MS = 250;
// The walk is over by this point, 50 s inside the 5-minute per-board watchdog of
// scan-ats-full.mjs (COMPANY_TIMEOUT_MS), which leaves room for processJobs.
const WALK_END_MS = 5 * 60_000 - 50_000;
// The shared retry policy (RETRY_DEFAULTS and withRetry in _http.mjs): two
// retries, each after a Retry-After wait that withRetry clamps at 32 s.
const RETRIES = 2;
const RETRY_WAIT_CAP_MS = 32_000;

/** @param {import('./_types.js').PortalEntry} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

function fallbackCompany(entry) {
  return typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Teamtailor';
}

/** @type {Provider} */
export default {
  id: 'teamtailor',

  detect(entry) {
    // Auto-detection never claims a branded host — only *.teamtailor.com.
    const url = resolveFeedUrl(entry, { explicit: false });
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const explicit = entry?.provider === 'teamtailor';
    const feedUrl = resolveFeedUrl(entry, { explicit });
    if (!feedUrl) throw new Error(`teamtailor: cannot derive jobs.rss URL for ${fallbackCompany(entry)}`);
    assertFeedUrl(feedUrl, { explicit });
    // Every page request carries redirect:'error' (SSRF guard); combined with
    // assertFeedUrl above it keeps the walk pinned to the trusted host
    // (*.teamtailor.com, or the branded host the user explicitly configured).
    const company = fallbackCompany(entry);
    const maxPages = resolveMaxPages(entry);
    // verify-portals' liveness probe sets `ctx.maxPages: 1`; kept apart from
    // maxPages so the "raise max_pages" warning never fires for a probe cap.
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pagesToFetch = Math.min(maxPages, ctxCap);

    const jobs = [];
    const seen = new Set();
    const seenItems = new Set(); // raw item identities, before any row is dropped
    // Each attempt may run for the request timeout (10 s, or
    // CAREER_OPS_HTTP_TIMEOUT_MS when set). A page starts only while one attempt
    // still ends by WALK_END_MS (4 minutes into the walk at 10 s), and retries only
    // while its worst case, three attempts and two waits, does too.
    const attemptMs = resolveDefaultTimeoutMs(process.env.CAREER_OPS_HTTP_TIMEOUT_MS);
    const budgetMs = WALK_END_MS - attemptMs;
    const retryUntilMs = WALK_END_MS - (RETRIES + 1) * attemptMs - RETRIES * RETRY_WAIT_CAP_MS;
    const startedAt = Date.now();
    // Why the walk stopped: 'complete' (short or empty page), 'cap' (page
    // budget ran out on a full page), 'offset-ignored' (a full page made only
    // of postings already read: the server did not honour `?offset=`, so the
    // rest of the board is out of reach), 'time-budget' (the walk's own
    // wall-clock budget ran out) or 'fetch-error'. Drives both the warning and the
    // truncation marker.
    let stopReason = 'complete';
    let page = 0;
    for (; page < pagesToFetch; page++) {
      if (page > 0) {
        if (Date.now() - startedAt >= budgetMs) {
          stopReason = 'time-budget';
          break;
        }
        await sleep(INTER_PAGE_DELAY_MS, ctx);
      }
      const pageUrl = page === 0 ? feedUrl : `${feedUrl}?offset=${page * PAGE_SIZE}`;
      const lastStretch = Date.now() - startedAt >= retryUntilMs;
      let text;
      try {
        text = await fetchTextWithRetry(ctx, pageUrl, { redirect: 'error' }, lastStretch ? { retries: 0 } : {});
        if (!isWholeChannel(text)) {
          throw new Error(`teamtailor: ${pageUrl} is not a complete RSS feed (no closed <channel> in the response)`);
        }
      } catch (err) {
        // The first page failing (or any page during a probe) is a broken
        // board: throw, unwrapped. A later page failing keeps what was read
        // so far, says so, and marks the board partial.
        if (page === 0 || Number.isFinite(ctxCap)) throw err;
        console.error(`⚠️  teamtailor: ${company} truncated at page ${page + 1} of ${maxPages} (${jobs.length} jobs): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }
      // Raw item count, before malformed rows are dropped: a short page is the
      // feed's own end, whatever the parser kept.
      const items = rawItems(text);
      for (const job of parseTeamtailorFeed(text, company)) {
        // The feed can shift while it is walked: skip a posting seen on an earlier page.
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      if (items.length < PAGE_SIZE) break;
      // A full page made only of items already read means the server ignored
      // `?offset=`. Judged on the raw items, so a page whose rows the parser
      // drops (no link, no title) is not mistaken for a repeat.
      const repeated = items.every((item) => seenItems.has(item));
      for (const item of items) seenItems.add(item);
      if (repeated) {
        stopReason = 'offset-ignored';
        break;
      }
    }
    // Budget ran out on a full page that still added postings. A probe cap
    // (ctx.maxPages, at or below the entry's own ceiling) is not a truncation.
    if (page === pagesToFetch && maxPages < ctxCap) stopReason = 'cap';

    if (stopReason === 'cap') {
      const advice = maxPages < MAX_PAGES_CAP
        ? 'raise max_pages on this entry for more'
        : `the hard ceiling of ${MAX_PAGES_CAP} pages was reached`;
      console.error(`⚠️  teamtailor: ${company} truncated at max_pages=${maxPages} (${jobs.length} jobs) — ${advice}`);
      markTruncated(jobs, 'page-cap', { fetched: jobs.length });
    } else if (stopReason === 'time-budget') {
      console.error(`⚠️  teamtailor: ${company} stopped at page ${page} of ${maxPages} after its ${Math.round(budgetMs / 1000)} s time budget (${jobs.length} jobs read, the rest of the board was not reached)`);
      markTruncated(jobs, 'time-budget', { fetched: jobs.length });
    } else if (stopReason === 'fetch-error') {
      markTruncated(jobs, 'fetch-error', { fetched: jobs.length });
    } else if (stopReason === 'offset-ignored') {
      console.error(`⚠️  teamtailor: ${company} ignored ?offset= (page ${page + 1} repeated earlier postings), so only the first ${jobs.length} jobs were read`);
      markTruncated(jobs, 'offset-ignored', { fetched: jobs.length });
    }
    return jobs;
  },
};

// Whether a feed page is a whole RSS channel: `<channel>…</channel>`, or a
// self-closing `<channel/>`. The opening and closing tags are tested apart,
// not with one regex spanning the body, so the check stays linear on a large page.
function isWholeChannel(xml) {
  if (typeof xml !== 'string') return false;
  return /<channel\b[^>]*\/>/i.test(xml) || (/<channel\b/i.test(xml) && /<\/channel\s*>/i.test(xml));
}

// The raw items of a feed page, one identity string each: the link text, or the
// whole block when the item has none. Counted before the parser drops anything,
// so an empty or malformed `<item/>` still counts toward a full page.
function rawItems(xml) {
  if (typeof xml !== 'string') return [];
  const out = [];
  for (const m of xml.matchAll(/<item\b[^>]*?(?:\/>|>[\s\S]*?<\/item>)/gi)) {
    out.push(tagText(m[0], 'link') || m[0]);
  }
  return out;
}

// Resolve a tag's inner text: unwrap a CDATA section, else decode entities.
function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeEntities(inner).trim();
}

// Extract the text of the first <tag>...</tag> in a block. Returns '' when
// absent. Tag names may contain a namespace colon (e.g. tt:city).
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Keep only absolute HTTPS links. Teamtailor job URLs frequently live on a
// branded custom domain, so — unlike the feed host — the link host is not
// pinned; we only require a well-formed https URL.
function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

// Every place a posting is open in, each once, in the feed's order: the
// <tt:city> and <tt:country> of each <tt:location> in its <tt:locations> block
// (one block per place on the feeds read on 2026-11-23). Each block is read on
// its own, so a city or country always comes from its own place: the feed
// writes an empty tag self-closing (`<tt:name/>`), and over the whole item a
// `<tt:city/>` would read on to the next place's `</tt:city>`.
function resolvePlaces(item) {
  const places = [];
  for (const [, block] of item.matchAll(/<tt:location\b[^>]*>([\s\S]*?)<\/tt:location>/gi)) {
    const place = [tagText(block, 'tt:city'), tagText(block, 'tt:country')].filter(Boolean).join(', ');
    if (place && !places.includes(place)) places.push(place);
  }
  return places;
}

// The posting's places joined with " · ", the separator the providers share for
// a multi-place posting, then "Remote" when its remoteStatus is remote (`fully`
// or `temporary`) and no place already says so, whether or not it names a
// place: on the feeds read on 2026-11-23, fully remote postings named an
// office city.
function resolveLocation(item, places) {
  const status = tagText(item, 'remoteStatus').toLowerCase();
  const remote = (status === 'fully' || status === 'temporary') && !places.some((p) => /\bremote\b/i.test(p));
  return [...places, remote ? 'Remote' : ''].filter(Boolean).join(' · ');
}

/**
 * Parse a Teamtailor public RSS jobs feed. Exported for unit tests.
 *
 * Shape: `<rss><channel><item>...</item>...</channel></rss>`. Each item
 * exposes `<title>`, `<link>`, `<pubDate>`, an optional `<remoteStatus>`, and
 * a `tt:` locations block with one `<tt:location>` (`<tt:city>`,
 * `<tt:country>`) per place the posting is open in. The company is not in
 * the item, so the tracked_companies `name` is used.
 *
 * @param {string} xml - raw RSS feed body
 * @param {string} [defaultCompany] - company label for every posting
 * @returns {Array<{title: string, url: string, company: string, location: string, locations?: string[], postedAt?: number}>}
 */
export function parseTeamtailorFeed(xml, defaultCompany = 'Teamtailor') {
  if (typeof xml !== 'string') return [];
  const company = typeof defaultCompany === 'string' && defaultCompany.trim() ? defaultCompany.trim() : 'Teamtailor';
  const jobs = [];
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const item of blocks) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;

    const title = tagText(item, 'title');
    if (!title) continue;

    const postedAt = toEpochMs(tagText(item, 'pubDate'));
    const places = resolvePlaces(item);
    // Job.locations holds places only, so a work-model name ("Remote") stays
    // in the location string but not in the list, as ashby and lever do.
    const locations = places.filter((p) => !isWorkModelOnly(p));
    const job = {
      title,
      company,
      location: resolveLocation(item, places),
      url,
      ...(locations.length > 0 ? { locations } : {}),
    };
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  return jobs;
}
