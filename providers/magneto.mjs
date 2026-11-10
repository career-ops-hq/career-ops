// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Magneto365 provider: magneto365.com, a general job board for Colombia.
// Target list: `job_boards:`. Wire it in with the search URL you would open in
// a browser:
//   - name: Magneto365 Tecnologia
//     careers_url: https://www.magneto365.com/co/trabajos/buscar/tecnologia
//
// There is no public API; the search pages are server-rendered HTML. Card shape
// (measured on https://www.magneto365.com/co/trabajos/buscar/tecnologia,
// 2026-10-23: HTTP 200 with career-ops' default User-Agent, 20 cards):
//   <article class="mg_job_card_desktop_magneto-ui-card-jobs_...">
//     <h2 ...><a href="https://www.magneto365.com/co/empleos/{slug}-{ID}" title="TITLE">TITLE</a></h2>
//     <h3 ...>COMPANY | CONTRACT TYPE</h3>
//     <p ...>SALARY</p>
//     <p ...>CITY</p>
//   </article>
// The same page also links /co/trabajos/... category, search and pagination
// pages; only /{country}/empleos/{slug}-{ID} detail pages are postings.
//
// Pagination: `?paginator[page]=N`, the shape of the page's own pager links on
// the measured page (only page 1 was fetched). The walk also stops as soon as
// a page brings no new ids.

import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 20;
const DEFAULT_MAX_JOBS = 100;
const MAX_JOBS_CAP = 500;
const OBSERVED_PAGE_SIZE = 20; // cards per page, measured 2026-10-23
const PAGE_PARAM = 'paginator[page]';

const ALLOWED_HOSTS = new Set(['www.magneto365.com', 'magneto365.com']);

/** A posting detail path: /co/empleos/{slug}-{numeric id}. */
const POSTING_PATH_RE = /^\/[a-z]{2}\/empleos\/[a-z0-9-]+-(\d+)\/?$/i;
/** A posting detail link anywhere in the page: the "this is a listing" signal. */
const POSTING_HREF_RE = /href="(?:https:\/\/(?:www\.)?magneto365\.com)?\/[a-z]{2}\/empleos\/[a-z0-9-]+-\d+\/?"/i;

/** @param {unknown} s */
function clean(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Keep user overrides bounded so a typo cannot turn one board into an unbounded crawl. */
function boundedPositiveInt(value, fallback, cap) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, cap) : fallback;
}

/**
 * Validate a configured search URL and rebuild it from its parts: https only,
 * a magneto365.com host only, port and credentials dropped.
 * @param {unknown} raw
 * @returns {URL}
 */
export function resolveListUrl(raw) {
  const u = new URL(String(raw)); // throws on a malformed URL
  if (u.protocol !== 'https:') throw new Error(`magneto: careers_url must be https, got ${u.protocol}`);
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error(`magneto: ${u.hostname} is not a magneto365.com host`);
  return new URL(`https://${u.hostname}${u.pathname}${u.search}`);
}

/**
 * The URL of one results page. Brackets stay literal, as in the board's own
 * pager links (`?paginator[page]=2`).
 * @param {URL} listUrl
 * @param {number} page
 * @returns {string}
 */
export function buildPageUrl(listUrl, page) {
  const u = new URL(listUrl);
  u.searchParams.delete(PAGE_PARAM);
  const rest = u.searchParams.toString();
  u.search = `${rest ? `${rest}&` : ''}${PAGE_PARAM}=${page}`;
  return u.href;
}

/**
 * Parse the job cards out of one search page.
 * @param {string} html
 * @param {string} origin - e.g. https://www.magneto365.com
 * @returns {Array<{id:string,title:string,url:string,company:string,location:string}>}
 */
export function parseCards(html, origin) {
  const out = [];
  for (const chunk of String(html).split(/<article\b/i).slice(1)) {
    const card = chunk.split(/<\/article>/i)[0];
    // Only result cards; the page's detail-preview panel is an <article> too.
    const openTag = card.slice(0, card.indexOf('>') + 1);
    if (!/card-jobs/.test(openTag)) continue;

    let url = null;
    let id = '';
    let titleHtml = '';
    for (const a of card.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      let u;
      try {
        u = new URL(decodeEntities(a[1]), origin);
      } catch {
        continue;
      }
      const m = ALLOWED_HOSTS.has(u.hostname) ? u.pathname.match(POSTING_PATH_RE) : null;
      if (!m) continue;
      url = u;
      id = m[1];
      titleHtml = a[2];
      break;
    }
    if (!url) continue;

    const title = clean(titleHtml);
    if (!title || title.length < 3) continue;

    // "COMPANY | CONTRACT TYPE"
    const h3 = card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const named = h3 ? clean(h3[1]).split(' | ')[0].trim() : '';
    // "Confidencial" and the board's own name ("Magneto empleos", seen on 4 of
    // 20 cards on 2026-10-23) stand in for an undisclosed employer.
    const company = /^(?:confidencial|empresa confidencial|magneto(?: empleos| 365)?)$/i.test(named) ? '' : named;
    // The last paragraph is the city; the one before it is the salary.
    const paragraphs = [...card.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => clean(p[1]));
    const last = paragraphs.length ? paragraphs[paragraphs.length - 1] : '';
    const location = last && !last.startsWith('$') ? last : '';

    out.push({
      id,
      title,
      url: `${url.origin}${url.pathname}`,
      // Never substitute the board's or the entry's name for a missing
      // employer (Source Indexing Policy rule 1): '?' is the tracker's marker.
      company: company || '?',
      location,
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'magneto',

  detect(entry) {
    const raw = entry?.api || entry?.careers_url;
    if (typeof raw !== 'string' || !raw) return null;
    try {
      return { url: resolveListUrl(raw).href };
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const raw = entry.api || entry.careers_url;
    if (!raw) throw new Error(`magneto: no URL provided for ${entry.name}`);
    // Host allowlist before any request (SSRF guard).
    const listUrl = resolveListUrl(raw);

    // verify-portals' health probe sets ctx.maxPages: one page, no retries,
    // and a fetch rejection propagates unwrapped.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMaxPages = boundedPositiveInt(entry.max_pages, DEFAULT_MAX_PAGES, MAX_PAGES_CAP);
    const maxPages = probing ? Math.min(entryMaxPages, ctx.maxPages) : entryMaxPages;
    const maxJobs = boundedPositiveInt(entry.max_jobs, DEFAULT_MAX_JOBS, MAX_JOBS_CAP);

    const jobs = [];
    const seen = new Set();
    /** @type {'complete'|'cap'|'fetch-error'} */
    let stopReason = 'complete';

    for (let page = 1; page <= maxPages; page++) {
      // Random 1-2 s pause between pages, never before the first one.
      if (page > 1) await sleep(1000 + Math.random() * 1000, ctx);

      const pageUrl = buildPageUrl(listUrl, page);

      let html;
      try {
        html = await fetchTextWithRetry(ctx, pageUrl, {
          redirect: 'error',
          headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        }, probing ? { retries: 0 } : {});
      } catch (err) {
        if (probing || page === 1) throw err;
        console.warn(`[magneto] ${entry.name}: page ${page} failed (${(err && err.message) || err}); keeping the ${jobs.length} posting(s) from earlier pages.`);
        stopReason = 'fetch-error';
        break;
      }

      const cards = parseCards(html, listUrl.origin);
      if (cards.length === 0) {
        if (page === 1 && POSTING_HREF_RE.test(html)) {
          throw new Error(`magneto: ${pageUrl} links postings but no job card parsed (markup change?)`);
        }
        break; // page 1: a search with no results; later: past the last page
      }

      let fresh = 0;
      for (const card of cards) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        fresh++;
        if (jobs.length >= maxJobs) {
          stopReason = 'cap';
          break;
        }
        jobs.push({ title: card.title, url: card.url, company: card.company, location: card.location });
      }
      if (stopReason === 'cap' || fresh === 0) break;
      // A full page that ends exactly on max_jobs, or the last allowed page, may hide more results.
      if (!probing && cards.length >= OBSERVED_PAGE_SIZE && (jobs.length >= maxJobs || page === maxPages)) stopReason = 'cap';
      if (stopReason === 'cap' || jobs.length >= maxJobs) break;
    }

    if (stopReason === 'cap') {
      console.warn(`[magneto] ${entry.name}: stopped at max_pages ${maxPages} / max_jobs ${maxJobs}; the search has more results. Raise max_pages or max_jobs on this entry to read them.`);
    }
    return jobs;
  },
};
