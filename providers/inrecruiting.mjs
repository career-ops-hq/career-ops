// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// InRecruiting provider — Zucchetti's InRecruiting ATS (formerly Intervieweb),
// widely used by Italian employers. A single-company ATS adapter for
// `tracked_companies:` entries: auto-detects `https://<tenant>.intervieweb.it`
// careers URLs (the `/it/career` landing page, a `/jobs/...` posting link, or
// the bare host) and reads that tenant's public career page.
//
// Measured live on 2026-10-26 against four tenants (maggioli, lutech,
// zucchetti, florim): `/{lang}/career` is fully server-rendered, no auth, no
// cookie, 15 cards per page. Further pages come from the same POST the page's
// own `researchAnnounces()` issues — to the URL in the page's hidden
// `#url-for-announces` input (`/app.php?opmode=guest&module=newcareer&ajax=1&
// IdAzienda=…&CSRFToken=…&CSRFHash=…`, a guest token minted into the page) with
// a form body carrying `act1=vacancyListCareer`, the page's `section` token and
// `page=N`. It answers `{"success":true,"data":"<html>"}` with the same card
// markup. Tenant hosts serve no robots.txt (404); the shared
// inrecruiting.intervieweb.it robots.txt disallows only paths containing
// "access", "recoveryForm" or "LAC", none of which this provider requests.
//
// PARSING CONTRACT. Anchors chosen to survive a restyle:
//
//   1. the posting link shape `https://<tenant>.intervieweb.it/jobs/<slug>-<id>/<lang>/`
//      wrapping the card's `<h3>` title — one card per such anchor;
//   2. the `mi-location_on` icon that precedes the location text (the span's
//      `title` attribute is localized, the icon class is not);
//   3. the `researchAnnounces(N, '<order>')` call on the `pagination_next`
//      control, which names the next page in any UI language.
//
// The cards carry no publish date, so `postedAt` is omitted (an absent date
// reads as "unknown", never "stale"). A card's "Azienda" span can name a group
// subsidiary; `company` stays the portals.yml entry name, as for every other
// single-company adapter.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const INRECRUITING_HOST_RE = /^[a-z0-9][a-z0-9-]*\.intervieweb\.it$/;

/**
 * Hosts on the vendor domain that are not a tenant career site: the shared
 * login/app host (path-based, redirects unknown paths to its root) and www.
 */
const NON_TENANT_HOSTS = new Set(['inrecruiting.intervieweb.it', 'www.intervieweb.it']);

const DEFAULT_LANG = 'it';

/** 15 cards per page; 40 pages covers the largest tenant measured (7 pages) many times over. */
const DEFAULT_MAX_PAGES = 40;

/** Hard ceiling on a configured `max_pages`, independent of what the page links to. */
const MAX_PAGES_CAP = 200;

/** No throttling observed; the shared norm for pages of one board. */
const INTER_PAGE_DELAY_MS = 200;

/** One card: the posting link wrapping the title heading. */
const CARD_RE =
  /<a[^>]+href=["'](https:\/\/[a-z0-9-]+\.intervieweb\.it\/jobs\/[^"'#?]+)["'][^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/gi;

/** Any posting-shaped link — the "this is still a listing page" signal. */
const POSTING_LINK_RE = /href=["']https:\/\/[a-z0-9-]+\.intervieweb\.it\/jobs\/[^"']+-\d+\/[a-z]{2}\/?["']/i;

/** Location text after the location icon, skipping the screen-reader label. */
const LOCATION_RE =
  /mi-location_on[\s\S]*?<\/i>\s*(?:<span[^>]*sr-only[^>]*>[\s\S]*?<\/span>)?([\s\S]*?)<\/span>/i;

const ANNOUNCES_URL_RE = /id=["']url-for-announces["'][^>]*value=["']([^"']+)["']/i;
const SECTION_RE = /['"]section['"]\s*:\s*['"]([A-Za-z0-9_-]+)['"]/;
const NEXT_PAGE_RE = /pagination_next["'][^>]*onclick=["']researchAnnounces\(\s*(\d+)\s*,\s*'([a-z_]+)'/i;

/**
 * Collapse a markup fragment to its visible text.
 * @param {string} fragment
 */
function visibleText(fragment) {
  return decodeEntities(String(fragment ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve the tenant from an entry: `https://<tenant>.intervieweb.it` plus the
 * UI language of its career page (`/en/career` → `en`, default `it`). Only the
 * hostname is trusted; the rest of the input path is read for the language
 * code alone and otherwise discarded.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{ host: string, origin: string, lang: string } | null}
 */
export function resolveTenant(entry) {
  const rawApi = typeof entry?.api === 'string' ? entry.api : '';
  const rawCareers = typeof entry?.careers_url === 'string' ? entry.careers_url : '';
  const raw = (rawApi || rawCareers).trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!INRECRUITING_HOST_RE.test(host) || NON_TENANT_HOSTS.has(host)) return null;
  // `/it/career` → it; a posting link `/jobs/<slug>/en/` → en.
  const langMatch = /^\/([a-z]{2})\/career\b/.exec(parsed.pathname)
    ?? /^\/jobs\/[^/]+\/([a-z]{2})\/?$/.exec(parsed.pathname);
  const lang = langMatch ? langMatch[1] : DEFAULT_LANG;
  return { host, origin: `https://${host}`, lang };
}

/**
 * Parse the cards of one listing fragment (the full career page or the HTML
 * inside a pagination response). Postings linking to another host are dropped.
 * @param {string} html
 * @param {string} host - The tenant hostname every posting URL must carry.
 * @returns {{ title: string, url: string, location: string }[]}
 */
export function parseCards(html, host) {
  const source = String(html ?? '');
  /** @type {{ url: string, title: string, start: number, end: number }[]} */
  const cards = [];
  CARD_RE.lastIndex = 0;
  let m;
  while ((m = CARD_RE.exec(source)) !== null) {
    if (cards.length > 0) cards[cards.length - 1].end = m.index;
    cards.push({ url: decodeEntities(m[1]), title: visibleText(m[2]), start: m.index, end: source.length });
  }

  /** @type {{ title: string, url: string, location: string }[]} */
  const rows = [];
  for (const card of cards) {
    let url;
    try {
      url = new URL(card.url);
    } catch {
      continue;
    }
    if (url.hostname !== host) continue;
    if (!card.title) continue;
    const loc = LOCATION_RE.exec(source.slice(card.start, card.end));
    rows.push({ title: card.title, url: url.href, location: loc ? visibleText(loc[1]) : '' });
  }
  return rows;
}

/**
 * The page links postings but none parsed: the card markup changed. Returning
 * [] would read as a quiet board, which is the failure this guards against.
 * @param {string} html
 * @param {string} url
 */
export function assertParsedSomething(html, url) {
  if (!POSTING_LINK_RE.test(String(html ?? ''))) return;
  throw new Error(`inrecruiting: ${url} still links postings but none could be parsed — the career page markup changed`);
}

/**
 * Read what page 2+ needs from the career page: the guest AJAX URL (pinned to
 * the tenant host and `/app.php`) and the `section` token.
 * @param {string} html
 * @param {string} host
 * @returns {{ announcesUrl: string, section: string } | null}
 */
export function parsePagingConfig(html, host) {
  const source = String(html ?? '');
  const urlMatch = ANNOUNCES_URL_RE.exec(source);
  const sectionMatch = SECTION_RE.exec(source);
  if (!urlMatch || !sectionMatch) return null;
  let parsed;
  try {
    parsed = new URL(decodeEntities(urlMatch[1]));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== host || parsed.pathname !== '/app.php') return null;
  return { announcesUrl: `https://${host}/app.php${parsed.search}`, section: sectionMatch[1] };
}

/**
 * The next page number and sort order the page's own pager would request, or
 * null on the last page.
 * @param {string} html
 * @returns {{ page: number, order: string } | null}
 */
export function parseNextPage(html) {
  const m = NEXT_PAGE_RE.exec(String(html ?? ''));
  return m ? { page: Number(m[1]), order: m[2] } : null;
}

/**
 * Unwrap a pagination response. Anything but `{success: true, data: string}`
 * is a broken response, not an empty page.
 * @param {string} text
 * @returns {string}
 */
export function parsePageResponse(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('inrecruiting: pagination response is not JSON');
  }
  if (!json || typeof json !== 'object' || json.success !== true || typeof json.data !== 'string') {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`inrecruiting: unexpected pagination response — expected {success: true, data}, got: [${got}]`);
  }
  return json.data;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'inrecruiting',

  detect(entry) {
    const tenant = resolveTenant(entry);
    return tenant ? { url: `${tenant.origin}/${tenant.lang}/career` } : null;
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) throw new Error(`inrecruiting: cannot derive a <tenant>.intervieweb.it career URL for ${entry.name}`);
    const careerUrl = `${tenant.origin}/${tenant.lang}/career`;

    const maxPages = resolveMaxPages(entry);
    // verify-portals' liveness probe sets ctx.maxPages: 1 — kept apart from
    // maxPages so the "raise max_pages" warning never fires on a probe cap.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pagesToFetch = Math.min(maxPages, probing ? ctx.maxPages : Infinity);

    // Page 1 is not wrapped in a catch: a tenant whose career page fails is
    // broken, and must not read as an empty board.
    const html = await fetchTextWithRetry(ctx, careerUrl, { redirect: 'error' });
    const firstRows = parseCards(html, tenant.host);
    if (firstRows.length === 0) {
      assertParsedSomething(html, careerUrl);
      if (!ANNOUNCES_URL_RE.test(html)) {
        throw new Error(`inrecruiting: ${careerUrl} is not an InRecruiting career page (no vacancy list found)`);
      }
      return [];
    }

    const jobs = [];
    const seen = new Set();
    const push = (rows) => {
      let fresh = 0;
      for (const row of rows) {
        if (seen.has(row.url)) continue;
        seen.add(row.url);
        fresh++;
        jobs.push({ title: row.title, url: row.url, company: entry.name, location: row.location });
      }
      return fresh;
    };
    push(firstRows);

    // Why the walk stopped: 'complete' (no next page, or nothing new), 'cap'
    // (page budget spent with a next page still linked), 'fetch-error'.
    let stopReason = 'complete';
    let next = parseNextPage(html);
    const paging = next ? parsePagingConfig(html, tenant.host) : null;
    if (next && !paging) {
      console.error(`⚠️  inrecruiting: ${entry.name} links more pages but its paging config was not found — kept page 1 only`);
      stopReason = 'fetch-error';
      next = null;
    }

    let fetched = 1;
    while (next && paging) {
      if (fetched >= pagesToFetch) {
        if (!probing) stopReason = 'cap';
        break;
      }
      await sleep(INTER_PAGE_DELAY_MS, ctx);
      const body = new URLSearchParams({
        act1: 'vacancyListCareer',
        section: paging.section,
        order: next.order,
        page: String(next.page),
        country: '',
        region: '',
        function: '',
        project: '',
        text: '',
        division: '',
        company: '',
      }).toString();
      let pageHtml;
      try {
        const text = await fetchTextWithRetry(ctx, paging.announcesUrl, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body,
        });
        pageHtml = parsePageResponse(text);
      } catch (err) {
        // A probe needs the rejection unwrapped (ProbePageBudgetReached).
        if (probing) throw err;
        console.error(`⚠️  inrecruiting: ${entry.name} truncated at page ${next.page} (${jobs.length} jobs): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }
      fetched++;
      const rows = parseCards(pageHtml, tenant.host);
      if (rows.length === 0) {
        // Page 1 already proved the markup; a later page that links postings
        // but parses none ends the walk with the pages collected so far.
        try {
          assertParsedSomething(pageHtml, paging.announcesUrl);
        } catch (err) {
          if (probing) throw err;
          console.error(`⚠️  inrecruiting: ${entry.name} truncated at page ${next.page} (${jobs.length} jobs): ${err.message}`);
          stopReason = 'fetch-error';
        }
        break;
      }
      // No stop on a page that only repeats earlier postings: a later page can
      // still hold new ones. A server ignoring `page` is caught by the pager
      // check below, since page 1's pager never points past the page asked for.
      push(rows);
      const following = parseNextPage(pageHtml);
      // A pager pointing backwards or at itself would loop forever.
      next = following && following.page > next.page ? following : null;
    }

    if (stopReason === 'cap') {
      console.error(`⚠️  inrecruiting: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length} jobs) — raise max_pages on this entry for more`);
    }
    if (stopReason === 'cap' || stopReason === 'fetch-error') /** @type {any} */ (jobs).inrecruitingTruncated = true;

    return jobs;
  },
};
