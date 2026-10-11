// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// PageUp provider — scrapes the public vendor-hosted careers listing pages.
// Single-company adapter, `tracked_companies:` only: one tenant, one entry.
// Auto-detects from careers_url/api on the vendor host
//   https://careers.pageuppeople.com/{tenant}/{site}/{lang}/...
// where {tenant} is the numeric PageUp tenant id, {site} the careers-site key
// (`cw` on every tenant seen) and {lang} the locale (`en`, `en-us`, `zh-c`). Any path
// under that prefix is claimed — the listing, or a posting link pasted from
// the site — and resolved to the listing.
//
// Tenants also front the same site on a branded domain (jobs.hku.hk is tenant
// 932). Those are deliberately NOT claimed: a hostname can't identify PageUp,
// and a branded host may put a bot challenge in front of pages the vendor host
// serves plainly. Point the entry at the vendor-host URL instead.
//
// Verified live 2026-10 on eleven tenants (universities in the US, Australia
// and Hong Kong, and a bank): the listing answers 200 to a bare request — no
// cookies, no login, default UA. Not every tenant is still there: one
// redirected to a newer front end on its own domain and a retired one
// answered 404; both surface as errors, never as an empty board.
//
// Listing pages are server-rendered tables, and the columns are the tenant's
// own choice (one tenant shows Position + Department, another adds a ref
// number and a closing date). The one constant is the posting anchor
// `<a class="job-link" href="/{tenant}/{site}/{lang}/job/{id}/{slug}">`, so
// that is all the parser relies on. No column is a location and none is a
// posting date (the date column, where present, is the CLOSING date), so jobs
// come back with an empty location and no postedAt.

import { fetchTextWithRetry, isRefusedRedirectError, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';

/** @typedef {{tenant: string, site: string, lang: string}} PageupConfig */

const ORIGIN = 'https://careers.pageuppeople.com';

// The `page-items` the provider asks for. Every tenant checked (2026-10)
// honoured it; a tenant that clamps it lower still paginates correctly,
// see the stop rule in fetch().
const PAGE_SIZE = 100;
// Override with `max_pages` on the portal entry (a positive integer), itself
// clamped to MAX_PAGES_CAP so a config typo can't turn one portals.yml line
// into an unbounded request loop.
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 200;
// Courtesy delay between pages — only multi-page tenants pay it.
const INTER_PAGE_DELAY_MS = 250;

// {tenant}/{site}/{lang} — the prefix every public page of a tenant sits under.
const TENANT_PATH_RE = /^\/(\d+)\/([A-Za-z0-9_-]+)\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})?)(?:\/|$)/;

/**
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {PageupConfig | null}
 */
function resolveConfig(entry) {
  // entry.api takes precedence over careers_url (mirrors greenhouse/icims).
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try { parsed = new URL(raw); } catch { continue; }
    if (parsed.origin !== ORIGIN) continue;
    const m = parsed.pathname.match(TENANT_PATH_RE);
    if (!m) continue;
    return { tenant: m[1], site: m[2], lang: m[3] };
  }
  return null;
}

// TENANT_PATH_RE admits only URL-safe characters, so the segments need no
// further encoding.
/** @param {PageupConfig} cfg @param {number} page */
const listingUrl = (cfg, page) =>
  `${ORIGIN}/${cfg.tenant}/${cfg.site}/${cfg.lang}/listing/?page=${page}&page-items=${PAGE_SIZE}`;

/**
 * Resolve the page cap: a positive integer `max_pages` on the entry, capped.
 * @param {import('./_types.js').PortalEntry} entry
 */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

// The parsing below is deliberately a series of bounded steps (indexOf scans,
// `[^<>]*` tag matches) rather than one regex per row: a pattern that lets
// `[^>]*` or `[\s\S]*?` run to the end of the input from every start position
// goes quadratic or worse on a broken page with unclosed tags or comments.

/** Remove HTML comments; an unterminated one swallows the rest. @param {string} s */
function stripComments(s) {
  let out = '';
  let pos = 0;
  for (;;) {
    const open = s.indexOf('<!--', pos);
    if (open === -1) return out + s.slice(pos);
    out += s.slice(pos, open);
    const close = s.indexOf('-->', open + 4);
    if (close === -1) return out;
    pos = close + 3;
  }
}

/** The value of one attribute on an opening-tag string. @param {string} tag @param {string} name */
function attr(tag, name) {
  // The lookbehind keeps `data-href` from being read as `href`.
  const m = tag.match(new RegExp(`(?<![\\w-])${name}=["']([^"'<>]*)["']`, 'i'));
  return m ? m[1] : null;
}

/** Whether an opening tag's class list contains `token` as a whole token. @param {string} tag @param {string} token */
const hasClass = (tag, token) => (attr(tag, 'class') ?? '').split(/\s+/).includes(token);

/**
 * Parse one PageUp listing page. Exported for unit tests.
 *
 * Only the `<tbody id="search-results-content">` table is read: the same page
 * repeats every posting in a hidden "recent jobs" block, and reading the whole
 * document would return each one twice.
 *
 * `valid: false` is never an empty board. `reason` says which way the page is
 * unrecognised: 'no-table' (the results table is missing — a login, error or
 * challenge page) or 'no-jobs-parsed' (the table links postings but none could
 * be read — the markup moved). An empty, well-formed table is `valid: true`
 * with no jobs.
 *
 * @param {string} html
 * @param {PageupConfig} cfg
 * @param {string} companyName
 * @returns {{valid: boolean, reason?: string, linkCount: number, hasMore: boolean,
 *   jobs: Array<{title: string, url: string, company: string, location: string}>}}
 */
export function parsePageupListing(html, cfg, companyName) {
  const doc = String(html);
  const open = doc.match(/<tbody\b[^<>]*(?<![\w-])id=["']search-results-content["'][^<>]*>/i);
  if (!open) return { valid: false, reason: 'no-table', linkCount: 0, hasMore: false, jobs: [] };
  const start = (open.index ?? 0) + open[0].length;
  const close = doc.slice(start).search(/<\/tbody\s*>/i);
  const end = close === -1 ? doc.length : start + close;
  // A tenant can leave a commented-out duplicate of each row in the table.
  const body = stripComments(doc.slice(start, end));

  const jobs = [];
  // Posting anchors seen, before any is dropped as malformed — the page's own
  // row count, which is what the short-page stop in fetch() has to compare.
  let linkCount = 0;
  // Opening and closing anchor positions are each collected in one pass and
  // walked together, so pairing them stays linear even when no anchor closes.
  const opens = [...body.matchAll(/<a\b[^<>]*>/gi)];
  const closes = [...body.matchAll(/<\/a\s*>/gi)].map(m => m.index ?? 0);
  let nextClose = 0;
  for (let i = 0; i < opens.length; i++) {
    const tag = opens[i];
    // `job-link` is one token in a class list a tenant can theme.
    if (!hasClass(tag[0], 'job-link')) continue;
    linkCount++;
    const href = attr(tag[0], 'href');
    if (!href) continue;
    let parsed;
    try { parsed = new URL(decodeEntities(href), ORIGIN); } catch { continue; }
    // A listing should never link a posting on another host or another tenant.
    if (parsed.origin !== ORIGIN) continue;
    const m = parsed.pathname.match(/^\/(\d+)\/([A-Za-z0-9_-]+)\/[^/]+\/job\/(\d+)(?:\/|$)/);
    if (!m || m[1] !== cfg.tenant || m[2] !== cfg.site) continue;
    const textStart = (tag.index ?? 0) + tag[0].length;
    while (nextClose < closes.length && closes[nextClose] < textStart) nextClose++;
    const textEnd = closes[nextClose];
    // An anchor that never closes would otherwise take its title from the
    // next posting's row: its text has to end before the next anchor opens.
    const nextOpen = opens[i + 1]?.index;
    if (textEnd === undefined || (nextOpen !== undefined && nextOpen < textEnd)) continue;
    const title = htmlToText(body.slice(textStart, textEnd));
    if (!title) continue;
    jobs.push({
      title,
      // Rebuilt from the numeric id alone: the slug after it is derived from
      // the title, so it changes when a posting is retitled and would make the
      // same posting look new to the dedup key. The id-only URL resolves.
      url: `${ORIGIN}/${cfg.tenant}/${cfg.site}/${cfg.lang}/job/${m[3]}`,
      company: companyName,
      location: '',
    });
  }

  // The table has posting anchors, or links a posting path, but nothing was
  // read from it. Keyed on those rather than on row count, so a "no jobs
  // found" message row in an empty table still reads as an empty board.
  if (jobs.length === 0 && (linkCount > 0 || /\/job\/\d/.test(body))) {
    return { valid: false, reason: 'no-jobs-parsed', linkCount, hasMore: false, jobs: [] };
  }

  // The "More Jobs" link sits after the table.
  const tail = doc.slice(end);
  let hasMore = false;
  if (tail.includes('more-link')) {
    for (const tag of stripComments(tail).matchAll(/<a\b[^<>]*>/gi)) {
      if (hasClass(tag[0], 'more-link')) { hasMore = true; break; }
    }
  }
  return { valid: true, linkCount, hasMore, jobs };
}

/** @type {Provider} */
export default {
  id: 'pageup',

  detect(entry) {
    const cfg = resolveConfig(entry);
    return cfg ? { url: listingUrl(cfg, 1) } : null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`pageup: cannot derive a careers.pageuppeople.com tenant URL for ${entry.name}`);

    const maxPages = resolveMaxPages(entry);
    // ctx.maxPages is verify-portals' liveness-probe hint, not a scan cap.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pagesToFetch = probing ? Math.min(maxPages, ctx.maxPages) : maxPages;

    const jobs = [];
    const seen = new Set();
    // Why pagination stopped. Only 'cap' earns the "raise max_pages" warning;
    // a fetch error or an unrecognised page warns on its own terms.
    let stopReason = 'cap';
    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let html;
      try {
        // No retry while probing: a probe-budget rejection has no status, so
        // the retry helper would read it as a transport error and spend the
        // probe's remaining requests on it.
        html = await fetchTextWithRetry(ctx, listingUrl(cfg, page), { redirect: 'error' }, probing ? { retries: 0 } : {});
      } catch (err) {
        // A probe needs the rejection unwrapped (ProbePageBudgetReached identity).
        if (probing) throw err;
        // Some tenants have moved to a newer front end on their own domain and
        // redirect the vendor-host listing there. The bare "fetch failed" that
        // redirect:'error' produces says nothing about why.
        if (page === 1 && isRefusedRedirectError(err)) {
          throw new Error(
            `pageup: ${entry.name} redirects away from ${ORIGIN} — the tenant has likely moved its careers site ` +
              'off the vendor host, which this provider does not read',
            { cause: err },
          );
        }
        // The first page failing means there is no board to report on.
        if (page === 1) throw err;
        const why = isRefusedRedirectError(err) ? `redirected away from ${ORIGIN}` : err?.message;
        console.error(`⚠️  pageup: ${entry.name} stopped at page ${page} (${jobs.length} jobs kept): ${why}`);
        stopReason = 'fetch-error';
        break;
      }
      const parsed = parsePageupListing(html, cfg, entry.name);
      if (!parsed.valid) {
        const what = parsed.reason === 'no-table'
          ? 'no search-results table — likely a login, error or challenge page, not zero postings'
          : 'posting links but none could be read — markup changed';
        // On the first page there is nothing to salvage; later, keep the
        // pages already collected, as for a fetch error.
        if (page === 1) throw new Error(`pageup: ${entry.name} returned a listing page with ${what}`);
        console.error(`⚠️  pageup: ${entry.name} page ${page} had ${what} (${jobs.length} jobs kept)`);
        stopReason = 'unrecognised-page';
        break;
      }

      let fresh = 0;
      for (const job of parsed.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        fresh++;
        jobs.push(job);
      }
      // Nothing new: past the last page, or a tenant repeating its last page
      // for an out-of-range `page`, which would otherwise loop to the ceiling.
      if (fresh === 0) { stopReason = 'complete'; break; }
      // A short page with no "More Jobs" link is the last one. Both signals
      // are required, so a tenant that clamps `page-items` below PAGE_SIZE
      // keeps paginating instead of being cut off after its first page.
      if (!parsed.hasMore && parsed.linkCount < PAGE_SIZE) { stopReason = 'complete'; break; }
    }

    // Still 'cap' here means the loop ran out of page budget on a full page.
    // Under a probe that budget is the probe's, not max_pages — stay quiet.
    if (stopReason === 'cap' && !probing) {
      console.error(`⚠️  pageup: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length} jobs) — raise max_pages on this entry for more`);
    }
    return jobs;
  },
};
