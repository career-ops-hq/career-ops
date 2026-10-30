// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// WP Job Manager provider: any job board running the WP Job Manager WordPress
// plugin. Target list: `job_boards:` (one board, many employers, per entry).
//
// The plugin serves a public, no-auth RSS feed at `{origin}/?feed=job_feed`.
// It is the reliable surface on these sites: the plugin's REST route is often
// disabled, and the HTML listing is usually filled in by JavaScript. The feed
// returns 10 items by default; `posts_per_page` raises that and `paged` walks
// the rest, so this provider asks for 100 per page and stops on a short page.
// Item parsing is shared with providers/jobspresso.mjs (providers/_wp-job-feed.mjs).
//
// No detect(): a WordPress site has no host pattern to recognize, so a board
// is wired explicitly, the same way as providers/eploy.mjs:
//
//   - name: Example Board
//     provider: wp-job-manager
//     careers_url: https://jobs.example.com/
//
// Only the host of `careers_url` is used; the feed path is fixed. A WordPress
// install under a subdirectory is not supported.
//
// Each item's <link> is the board's own posting page. The feed carries no
// employer application URL, so that page is the job URL (Source Indexing
// Policy rule 2 fallback). Links off the board's host are dropped.
//
// robots.txt (Source Indexing Policy rule 6) is per site, and this provider can
// point at any site: check the board's own robots.txt before adding an entry.
// The feed URL always carries a query string, so a `Disallow: /*?` under
// `User-agent: *` rules a board out.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { parseWpJobFeedItems, wpJobFeedItems } from './_wp-job-feed.mjs';

/** The most the provider asks for per request; the plugin honours it. */
const PAGE_SIZE = 100;

/** 20 pages of 100 covers a large board; raise with `max_pages`. */
const DEFAULT_MAX_PAGES = 20;

/** Hard ceiling on a configured `max_pages`. */
const MAX_PAGES_CAP = 100;

/**
 * A page of 100 items with full post bodies is close to 1 MB, and these are
 * often single WordPress hosts, not CDN-fronted APIs. Polite spacing, not a
 * measured rate limit.
 */
const INTER_PAGE_DELAY_MS = 1000;

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * The board's hostname from `careers_url` (or `api`), or null. https only, no
 * credentials or port; the path is ignored. SSRF to internal addresses is
 * stopped by the central IP guard around ctx.fetch*.
 * @param {any} entry
 * @returns {string | null}
 */
export function resolveHost(entry) {
  const raw = typeof entry?.careers_url === 'string' && entry.careers_url.trim()
    ? entry.careers_url
    : entry?.api;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.')) return null;
  return host;
}

/** @param {string} host @param {number} page 1-based */
export function buildFeedUrl(host, page) {
  const url = `https://${host}/?feed=job_feed&posts_per_page=${PAGE_SIZE}`;
  return page > 1 ? `${url}&paged=${page}` : url;
}

/** `www.example.com` and `example.com` are the same board. */
const bareHost = (/** @type {string} */ h) => h.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

/**
 * An item link is kept only when it is https on the board's own host.
 * @param {string} host
 * @returns {(raw: string) => string}
 */
function linkResolver(host) {
  const want = bareHost(host);
  return (raw) => {
    if (!raw) return '';
    try {
      const u = new URL(raw.trim());
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
      return bareHost(u.hostname) === want ? u.href : '';
    } catch {
      return '';
    }
  };
}

/**
 * Parse one page of the feed. A well-formed RSS channel with no items is an
 * empty page (`[]`, `rawCount: 0`). A body that is not an RSS channel (an HTML
 * page, an error, nothing) throws, so a broken board does not read as empty.
 * Items present but none usable also throws: the links are not where the entry
 * says the board is.
 * @param {unknown} xml
 * @param {string} host
 * @returns {{ jobs: ReturnType<typeof parseWpJobFeedItems>, rawCount: number }}
 */
export function parseWpJobManagerFeed(xml, host) {
  if (typeof xml !== 'string' || !/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) {
    let got = typeof xml;
    if (typeof xml === 'string') got = !xml.trim() ? 'an empty body' : /<html\b/i.test(xml) ? 'an HTML page' : 'a non-RSS body';
    throw new Error(`wp-job-manager: expected an RSS job_feed from ${host}, got ${got}`);
  }
  const blocks = wpJobFeedItems(xml);
  const jobs = parseWpJobFeedItems(blocks, linkResolver(host));
  if (blocks.length > 0 && jobs.length === 0) {
    throw new Error(
      `wp-job-manager: ${blocks.length} feed items from ${host} but none parsed (item links not https on ${host}?)`,
    );
  }
  return { jobs, rawCount: blocks.length };
}

/** @type {Provider} */
export default {
  id: 'wp-job-manager',

  async fetch(entry, ctx) {
    const host = resolveHost(entry);
    if (!host) {
      throw new Error(`wp-job-manager: ${entry?.name ?? 'entry'} needs an https careers_url (the board's address)`);
    }

    const maxPages = resolveMaxPages(entry);
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pagesToFetch = probing ? Math.min(maxPages, ctx.maxPages) : maxPages;

    /** @type {any[]} */
    const jobs = [];
    const seen = new Set();
    // complete | cap | fetch-error | no-progress — drives the warning and the
    // marker below.
    let stopReason = 'complete';
    let lastRawCount = 0;
    let page = 1;
    for (; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let pageJobs;
      let rawCount;
      try {
        const xml = await fetchTextWithRetry(ctx, buildFeedUrl(host, page), { redirect: 'error', timeoutMs: 20_000 });
        ({ jobs: pageJobs, rawCount } = parseWpJobManagerFeed(xml, host));
      } catch (err) {
        // The first page failing is a broken board, and a probe needs the
        // error unwrapped (ProbePageBudgetReached). A later page that fails
        // to fetch or parse keeps what was already collected.
        if (page === 1 || probing) throw err;
        console.error(`⚠️  wp-job-manager: ${entry.name} stopped at page ${page} (${jobs.length} jobs kept): ${/** @type {Error} */ (err).message}`);
        stopReason = 'fetch-error';
        break;
      }
      lastRawCount = rawCount;
      // New posts shift WordPress paging, so a posting can repeat on the
      // next page; keep the first.
      const before = jobs.length;
      for (const job of pageJobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      // A full later page with nothing new means the board (or a cache in
      // front of it) ignores `paged` and serves page 1 again. Walking on would
      // repeat it up to max_pages and then blame the cap.
      if (page > 1 && rawCount >= PAGE_SIZE && jobs.length === before) {
        console.error(`⚠️  wp-job-manager: ${entry.name} page ${page} repeated earlier pages, so the board may ignore paged= (${jobs.length} jobs kept)`);
        stopReason = 'no-progress';
        break;
      }
      // Stop on the feed's own item count, not on what survived parsing.
      if (rawCount < PAGE_SIZE) break;
    }
    // Ran out of page budget on a full page: the entry's cap truncated a
    // healthy board. A probe's cap is not worth a warning.
    if (stopReason === 'complete' && page > pagesToFetch && lastRawCount >= PAGE_SIZE && !probing) {
      stopReason = 'cap';
      console.error(`⚠️  wp-job-manager: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length} jobs) — raise max_pages on this entry for more`);
    }
    if (stopReason !== 'complete') /** @type {any} */ (jobs).wpJobManagerTruncated = true;

    return jobs;
  },
};
