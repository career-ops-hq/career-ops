// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { visibleText } from './_html-to-text.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

// rexx systems provider — the server-rendered job portal ("Jobportal") that
// rexx systems' recruiting suite hosts for each customer. Single-company:
// one entry per employer, under `tracked_companies:`.
//
// A rexx portal runs on the employer's own branded host (jobs.<employer>.com,
// karriere.<employer>.de, sometimes under a path such as /stellenmarkt/) that
// is a CNAME onto rexx's cloud; the vendor tenant host behind it does not
// serve the portal itself. So there is no URL pattern to auto-detect and this
// provider has no detect(): wire a portal with an explicit `provider: rexx`
// and `careers_url` pointed at its job list page. Nothing else is required.
//
//   - name: ExampleCo
//     careers_url: https://jobs.exampleco.com/stellenangebote.html
//     provider: rexx
//
// A bare host, or a path ending in "/", reads `stellenangebote.html` there
// (the list page every portal probed serves). Query string, fragment, port
// and credentials on the configured URL are discarded.
//
// The list page renders one card per posting, server-side:
//
//   <div id="joboffers">
//     <article class="joboffer_container" ...>        (older skins: <div>)
//       <div class="joboffer_title_text joboffer_box">
//         <a href="https://jobs.exampleco.com/{Slug}-de-j{ID}.html">{Title}</a>
//       ...
//       <span class="job_standort">{City}</span>      (newer skins)
//       <div class="joboffer_informations joboffer_box">{City, City}</div>
//                                                      (older skins: plain-text
//                                                       columns, location last)
//
// and pages with `?start={offset}`. The page size is the portal's own setting
// (10, 42 and 100 observed), so the walk advances by the number of cards the
// page actually carried and ends on an empty or short page. Newer skins also
// state the total (`data-all-count` on #joboffer_table_container). It is
// reported in warnings and truncation markers, but never ends the walk and
// never proves a board complete; a "load more" button on those skins is a
// script over the same `?start=` list, which answers without it.
//
// Dates: the cards carry none. Most portals advertise an Atom feed in the
// page head (<link rel="alternate" type="application/atom+xml">, served by
// rss_generator-rss0.php) whose <entry><updated> equals the posting's
// JSON-LD datePosted on the detail page (checked live). When the list page
// links one on the portal's own host, it is read once per scan, after the
// walk, and its dates are joined onto the cards by job id. The feed carries
// no location, which is why the list page and not the feed is the inventory.
// A portal without a feed, or a failed feed read, yields undated postings.
// The health probe (`ctx.maxPages`) skips the feed.
//
// Not supported: an employer site that renders rexx postings client-side in
// its own CMS (observed: a TYPO3 site loading a rexx.js widget) has no
// server-rendered list; point careers_url at the rexx portal host instead,
// if the employer runs one.
//
// SSRF: the host is the customer's own branded domain, so no vendor host
// allowlist can be built (same shape as providers/phenom.mjs). The central
// DNS/IP guard (_ip-guard.mjs) wraps every ctx.fetch*, every request passes
// `redirect: 'error'`, the configured URL must be https, and the feed URL —
// read out of the fetched page — must be on the same host as the list before
// it is ever requested.

const DEFAULT_LIST_PAGE = 'stellenangebote.html';

// Smallest page size observed is 10, so 30 pages covers 300+ postings on the
// most finely paged portal; the largest probed portal (278 postings, 100 per
// page) needs 3.
const DEFAULT_MAX_PAGES = 30;
const MAX_PAGES_CAP = 200;
const INTER_PAGE_DELAY_MS = 250;

const CARD_START_RE = /<(?:article|div)\b[^>]*\bclass=["'][^"']*\bjoboffer_container\b[^"']*["'][^>]*>/gi;
const ANCHOR_RE = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
// A rexx posting page path: "...-j{ID}.html" (tested on the URL's pathname,
// so a query string such as ?agid=7 does not get in the way).
const DETAIL_PATH_RE = /-j(\d+)\.html$/i;
// Listing signal for the empty-vs-broken split: posting-shaped hrefs.
const DETAIL_HREF_SIGNAL_RE = /href=["'][^"']*-j\d+\.html/i;
const JOBOFFERS_CONTAINER_RE = /\bid=["']joboffers["']/i;
const STANDORT_RE = /<span\b[^>]*\bclass=["'][^"']*\bjob_standort\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;
const INFO_BOX_RE = /<div\b[^>]*\bclass=["'][^"']*\bjoboffer_informations\b[^"']*["'][^>]*>([^<]*)<\/div>/gi;
const ALL_COUNT_RE = /\bdata-all-count=["'](\d+)["']/i;
const LINK_TAG_RE = /<link\b[^>]*>/gi;

/**
 * Resolve the job list URL from the entry. Only the hostname and the path are
 * kept; the origin is rebuilt as https://{hostname}, so a port, credentials,
 * query string or fragment on the configured URL never reach a request.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{ host: string, listUrl: string } | null}
 */
export function resolveListUrl(entry) {
  const raw = entry?.api || entry?.careers_url;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!isPublicNamedHost(host)) return null;
  let path = u.pathname || '/';
  if (path.endsWith('/')) path += DEFAULT_LIST_PAGE;
  return { host, listUrl: `https://${host}${path}` };
}

/**
 * A rexx portal is a public https site on the employer's named domain. Branded
 * hosts cannot be allowlisted, so the check is the one providers/successfactors.mjs
 * applies to branded RMK domains: no single-label name, no IP literal in any
 * spelling, no localhost/internal-style suffix. Private resolved addresses are
 * still the shared IP guard's job; this refuses the obvious ones before any
 * request, without DNS.
 * @param {string} host - lowercased, trailing dot removed
 */
export function isPublicNamedHost(host) {
  if (!host || !host.includes('.') || host.startsWith('[')) return false; // single-label or IPv6 literal
  if (/^\d+(?:\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false; // IPv4 in any spelling
  if (/(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan)$/.test(host)) return false;
  return true;
}

/** Page URL for a 0-based posting offset. */
function pageUrl(listUrl, start) {
  return start > 0 ? `${listUrl}?start=${start}` : listUrl;
}

/** Positive integer `max_pages` on the entry, capped; else the default. */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

// NaN-safe: `Date.parse(s) || undefined` would also drop a valid epoch 0.
/** @param {string | undefined} value */
export function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Resolve a scraped href against the page and keep it only when it is an
 * https posting page on the portal's own host. Returns { id, url } or null.
 * @param {string} rawHref @param {string} baseUrl @param {string} host
 */
function postingLink(rawHref, baseUrl, host) {
  let u;
  try {
    u = new URL(decodeEntities(rawHref).trim(), baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== host) return null;
  const m = u.pathname.match(DETAIL_PATH_RE);
  if (!m) return null;
  u.hash = '';
  return { id: m[1], url: u.href };
}

/**
 * Parse one list page.
 *
 * `rawCount` is the number of cards the SOURCE rendered (the pagination step
 * and short-page test read it), `rows` the cards that parsed into a posting.
 * `hasContainer` / `hasDetailLinks` feed the empty-vs-broken decision.
 *
 * @param {string} html @param {string} baseUrl @param {string} host
 */
export function parseListPage(html, baseUrl, host) {
  const text = typeof html === 'string' ? html : '';
  const starts = [...text.matchAll(CARD_START_RE)].map((m) => /** @type {number} */ (m.index));
  const rows = [];
  for (let i = 0; i < starts.length; i++) {
    const card = text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined);
    let link = null;
    let title = '';
    for (const a of card.matchAll(ANCHOR_RE)) {
      link = postingLink(a[1], baseUrl, host);
      if (link) {
        title = visibleText(a[2]);
        break;
      }
    }
    if (!link || !title) continue;

    let location = '';
    const standort = card.match(STANDORT_RE);
    if (standort) location = visibleText(standort[1]);
    if (!location) {
      // Older skins: plain-text information columns, the location last.
      const boxes = [...card.matchAll(INFO_BOX_RE)].map((m) => visibleText(m[1])).filter(Boolean);
      if (boxes.length) location = boxes[boxes.length - 1];
    }
    rows.push({ id: link.id, url: link.url, title, location });
  }
  const allCount = text.match(ALL_COUNT_RE);
  return {
    rows,
    rawCount: starts.length,
    total: allCount ? Number(allCount[1]) : null,
    hasContainer: JOBOFFERS_CONTAINER_RE.test(text),
    hasDetailLinks: DETAIL_HREF_SIGNAL_RE.test(text),
  };
}

/**
 * First-page sanity: a page that carries postings but parsed to none is a
 * markup change, and a page with neither cards nor the #joboffers container
 * is not a rexx list page at all. Both throw; a container with no cards and
 * no posting links is an empty board.
 * @param {ReturnType<typeof parseListPage>} page @param {string} url
 */
export function assertListPage(page, url) {
  if (page.rows.length > 0) return;
  if (page.hasDetailLinks || page.rawCount > 0) {
    throw new Error(`rexx: ${url} contains job postings but none could be parsed — the list markup changed`);
  }
  if (!page.hasContainer) {
    throw new Error(`rexx: ${url} is not a rexx job list (no #joboffers container) — check careers_url`);
  }
}

/**
 * The Atom/RSS feed the list page advertises, when it is an https URL on the
 * portal's own host and default port (the list URL is rebuilt without a port,
 * so the feed must match that origin). Anything else is ignored and never
 * fetched.
 * @param {string} html @param {string} baseUrl @param {string} host
 * @returns {string | null}
 */
export function findFeedUrl(html, baseUrl, host) {
  for (const m of String(html ?? '').matchAll(LINK_TAG_RE)) {
    const tag = m[0];
    if (!/\brel=["']alternate["']/i.test(tag)) continue;
    if (!/\btype=["']application\/(?:atom|rss)\+xml["']/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i);
    if (!href) continue;
    let u;
    try {
      u = new URL(decodeEntities(href[1]).trim(), baseUrl);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== host || u.port !== '') continue;
    u.hash = '';
    return u.href;
  }
  return null;
}

/**
 * Map rexx job id → posting date from the portal's Atom feed (<entry> with
 * <link href> and <updated>/<published>); RSS 2.0 <item> with <link> and
 * <pubDate> is read the same way. The first of an entry's links that is a
 * posting link counts (an Atom rel="self" link before it is skipped), and
 * <updated> wins over <published> whatever their order, because <updated> is
 * the value that matches the detail page's datePosted. Entries without a
 * posting link or a parseable date are skipped.
 * @param {string} xml @param {string} baseUrl @param {string} host
 * @returns {Map<string, number>}
 */
export function parseFeedDates(xml, baseUrl, host) {
  const dates = new Map();
  const text = typeof xml === 'string' ? xml : '';
  const blocks = text.match(/<(entry|item)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const candidates = [
      ...[...block.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi)].map((m) => m[1]),
      ...[...block.matchAll(/<link\b[^>]*>([^<]+)<\/link>/gi)].map((m) => m[1]),
    ];
    let link = null;
    for (const href of candidates) {
      link = postingLink(href, baseUrl, host);
      if (link) break;
    }
    if (!link) continue;
    const dateText = (tag) => block.match(new RegExp(`<${tag}\\b[^>]*>([^<]+)</${tag}>`, 'i'))?.[1].trim();
    const postedAt = toEpochMs(dateText('updated') ?? dateText('published') ?? dateText('pubDate'));
    if (postedAt === undefined || dates.has(link.id)) continue;
    dates.set(link.id, postedAt);
  }
  return dates;
}

/** @type {Provider} */
export default {
  id: 'rexx',

  async fetch(entry, ctx) {
    const cfg = resolveListUrl(entry);
    if (!cfg) {
      throw new Error(`rexx: ${entry?.name ?? 'entry'} needs an https careers_url pointing at the rexx job list page`);
    }

    const entryMaxPages = resolveMaxPages(entry);
    // verify-portals' health probe sets ctx.maxPages (1): one list request,
    // no feed read, and a fetch rejection propagates unwrapped.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pagesToFetch = probing ? Math.min(entryMaxPages, ctx.maxPages) : entryMaxPages;

    /** @type {import('./_types.js').Job[]} */
    const jobs = [];
    /** rexx job id per entry of `jobs`, for the feed-date join. */
    const ids = [];
    const seen = new Set();
    let feedUrl = null;
    let pageSize = 0;
    let total = null;
    let offset = 0;
    // Why the walk stopped; drives both the warning and the truncation marker.
    /** @type {'complete' | 'cap' | 'probe-cap' | 'fetch-error' | 'repeat-page'} */
    let stopReason = 'complete';
    let walkEnded = false;

    for (let page = 0; page < pagesToFetch; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = pageUrl(cfg.listUrl, offset);
      let html;
      try {
        html = await fetchTextWithRetry(ctx, url, { redirect: 'error', headers: { accept: 'text/html' } });
      } catch (err) {
        // The first page, or any page while probing, propagates unwrapped. A
        // later page in a real scan keeps what was read and says so.
        if (page === 0 || probing) throw err;
        console.error(`⚠️  rexx: ${entry.name} stopped at page ${page + 1} (${jobs.length} jobs kept): ${err.message}`);
        stopReason = 'fetch-error';
        walkEnded = true;
        break;
      }

      const parsed = parseListPage(html, url, cfg.host);
      if (page === 0) {
        assertListPage(parsed, url);
        feedUrl = findFeedUrl(html, url, cfg.host);
        pageSize = parsed.rawCount;
      }
      if (total === null) total = parsed.total;

      let fresh = 0;
      for (const row of parsed.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        fresh++;
        jobs.push({ title: row.title, url: row.url, company: entry.name, location: row.location });
        ids.push(row.id);
      }
      offset += parsed.rawCount;

      // Natural end, judged on the cards the SOURCE rendered: an empty or
      // short page. The stated total never ends the walk on its own.
      if (parsed.rawCount === 0 || parsed.rawCount < pageSize) {
        walkEnded = true;
        break;
      }
      // A full page that brought nothing new: the portal ignored ?start=.
      // Stop, since another request would repeat it, but this is not a
      // natural end. When the portal states more postings than were read,
      // the board is marked incomplete.
      if (fresh === 0) {
        walkEnded = true;
        if (total !== null && total > jobs.length) stopReason = 'repeat-page';
        break;
      }
    }

    // Out of page budget with the last page full: truncated. Only an empty
    // or short page proves the end; a stated total that the boundary page
    // reaches is not proof, because the count can be wrong.
    if (!walkEnded) {
      stopReason = probing && pagesToFetch < entryMaxPages ? 'probe-cap' : 'cap';
    }
    if (stopReason === 'cap') {
      console.error(`⚠️  rexx: ${entry.name} truncated at max_pages=${entryMaxPages} (${jobs.length}${total !== null ? ` of ${total}` : ''} jobs) — raise max_pages on this entry for more`);
    } else if (stopReason === 'repeat-page') {
      console.error(`⚠️  rexx: ${entry.name} repeated a page at ?start=${offset - pageSize} (${jobs.length} of ${total} jobs read) — the portal may not page this list`);
    }

    // Posting dates from the advertised feed: one request, real scans only.
    if (feedUrl && !probing && jobs.length > 0) {
      try {
        await sleep(INTER_PAGE_DELAY_MS, ctx);
        const xml = await fetchTextWithRetry(ctx, feedUrl, {
          redirect: 'error',
          headers: { accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9' },
        });
        const dates = parseFeedDates(xml, feedUrl, cfg.host);
        jobs.forEach((job, i) => {
          const postedAt = dates.get(ids[i]);
          if (postedAt !== undefined) job.postedAt = postedAt;
        });
      } catch (err) {
        console.error(`⚠️  rexx: ${entry.name} feed unreadable, postings kept without dates: ${err.message}`);
      }
    }

    if (stopReason === 'cap') {
      markTruncated(jobs, 'page-cap', total !== null ? { fetched: jobs.length, total } : { fetched: jobs.length });
    } else if (stopReason === 'fetch-error') {
      markTruncated(jobs, 'fetch-error', { fetched: jobs.length });
    } else if (stopReason === 'repeat-page') {
      markTruncated(jobs, 'repeat-page', { fetched: jobs.length, total: /** @type {number} */ (total) });
    }
    return jobs;
  },
};
