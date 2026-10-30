// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Computrabajo provider: a board-wide aggregator with one host per country
// (co.computrabajo.com, mx.computrabajo.com, ...). Target list: `job_boards:`.
//
// There is no public API; the search pages are server-rendered HTML. Wire it in
// with the search URL you would open in a browser:
//   - name: Computrabajo Colombia
//     careers_url: https://co.computrabajo.com/trabajo-de-sistemas
//
// Card shape (measured on https://co.computrabajo.com/trabajo-de-sistemas,
// 2026-10-23: HTTP 200 with career-ops' default User-Agent, 20 cards):
//   <article class="box_offer ..." data-id="{ID}">
//     <h2><a class="js-o-link fc_base" href="/ofertas-de-trabajo/...-{ID}#lc=...">TITLE</a></h2>
//     <p ...><a ... offer-grid-article-company-url>COMPANY</a></p>
//     <p class="fs16 fc_base mt5"><span class="mr10">CITY, REGION</span></p>
// Only the Colombian host was measured. Other country hosts share the domain
// and the markup is assumed to match (unverified).
//
// Pagination is `?p=N` (unverified: the listing renders no plain page links).
// The walk also stops as soon as a page brings no new ids, so a parameter the
// board ignores (re-serving page 1) ends the walk instead of repeating it.
//
// Crawl limits are deliberately tight, as the contributor asked: at most 3
// pages and 15 postings per entry, with a random 2-5 s pause between pages.

import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

const MAX_PAGES = 3; // also the hard cap: a typo cannot turn one entry into a ban-prone crawl
const DEFAULT_MAX_JOBS = 15;
const OBSERVED_PAGE_SIZE = 20; // cards per page, measured 2026-10-23
const REQUEST_TIMEOUT_MS = 20_000;

/** A two-letter country host: co.computrabajo.com, mx.computrabajo.com, ... */
const HOST_RE = /^[a-z]{2}\.computrabajo\.com$/;

/**
 * Markers that only a challenge / block page carries. Generic words such as
 * "cloudflare" or "captcha" also appear in normal pages (CDN assets, a login
 * form's reCAPTCHA), so they are not used.
 */
const CHALLENGE_RE = /<title[^>]*>[^<]*(?:just a moment|attention required|access denied|acceso denegado)|cf-(?:challenge|browser-verification|error-details)|cf-mitigated/i;

/** A posting detail link anywhere in the page: the "this is a listing" signal. */
const POSTING_HREF_RE = /href="(?:https:\/\/[a-z]{2}\.computrabajo\.com)?\/ofertas-de-trabajo\/[^"]+"/i;

/** @param {string} s */
function clean(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Keep user overrides bounded so a typo cannot turn one board into a ban-prone crawl. */
function boundedPositiveInt(value, fallback, cap) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, cap) : fallback;
}

/**
 * Validate a configured search URL and rebuild it from its parts: https only,
 * a Computrabajo country host only, port and credentials dropped.
 * @param {unknown} raw
 * @returns {URL}
 */
export function resolveListUrl(raw) {
  const u = new URL(String(raw)); // throws on a malformed URL
  if (u.protocol !== 'https:') throw new Error(`computrabajo: careers_url must be https, got ${u.protocol}`);
  if (!HOST_RE.test(u.hostname)) throw new Error(`computrabajo: ${u.hostname} is not a Computrabajo country host`);
  return new URL(`https://${u.hostname}${u.pathname}${u.search}`);
}

/**
 * Parse the posting cards out of one search page.
 * @param {string} html
 * @param {string} origin - e.g. https://co.computrabajo.com
 * @returns {Array<{id:string,title:string,url:string,company:string,location:string}>}
 */
export function parseCards(html, origin) {
  const out = [];
  for (const chunk of String(html).split(/<article\b/i).slice(1)) {
    const card = chunk.split(/<\/article>/i)[0];
    const openTag = card.slice(0, card.indexOf('>') + 1);
    if (!/\bbox_offer\b/.test(openTag)) continue;

    const link = card.match(/<a\b[^>]*\bhref="((?:https:\/\/[a-z]{2}\.computrabajo\.com)?\/ofertas-de-trabajo\/[^"#?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let url;
    try {
      url = new URL(link[1], origin);
    } catch {
      continue;
    }
    if (!HOST_RE.test(url.hostname)) continue;

    const heading = card.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const title = clean(link[2]) || (heading ? clean(heading[1]) : '');
    if (!title || title.length < 3) continue;

    const idM = openTag.match(/\bdata-id=['"]([^'"]+)['"]/);
    const companyM = card.match(/<a\b[^>]*\boffer-grid-article-company-url\b[^>]*>([\s\S]*?)<\/a>/i);
    const locationM = card.match(/<p\b[^>]*>\s*<span class="mr10">([\s\S]*?)<\/span>/i);

    out.push({
      id: idM ? idM[1] : url.pathname,
      title,
      url: `${url.origin}${url.pathname}`,
      // Never substitute the board's or the entry's name for a missing
      // employer (Source Indexing Policy rule 1): '?' is the tracker's marker.
      company: (companyM && clean(companyM[1])) || '?',
      location: locationM ? clean(locationM[1]) : '',
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'computrabajo',

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
    if (!raw) throw new Error(`computrabajo: no URL provided for ${entry.name}`);
    // Host allowlist before any request (SSRF guard).
    const listUrl = resolveListUrl(raw);

    // verify-portals' health probe sets ctx.maxPages: one page, no retries,
    // and a fetch rejection propagates unwrapped.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMaxPages = boundedPositiveInt(entry.max_pages, MAX_PAGES, MAX_PAGES);
    const maxPages = probing ? Math.min(entryMaxPages, ctx.maxPages) : entryMaxPages;
    const maxJobs = boundedPositiveInt(entry.max_jobs, DEFAULT_MAX_JOBS, DEFAULT_MAX_JOBS);

    const jobs = [];
    const seen = new Set();
    /** @type {'complete'|'cap'|'fetch-error'|'challenge'} */
    let stopReason = 'complete';

    for (let page = 1; page <= maxPages; page++) {
      // Random 2-5 s pause between pages, never before the first one.
      if (page > 1) await sleep(2000 + Math.random() * 3000, ctx);

      const pageUrl = new URL(listUrl);
      // Newest first (the board's own "Fecha" sort). Employers can pay Computrabajo to
      // feature a posting ("Empleo destacado"), and those cards are interleaved in every
      // sort order; a `by=` the user put in their URL wins.
      // robots.txt disallows `/ofertas-de-trabajo/*by=`, so no sort is sent there, not even one from the URL.
      if (pageUrl.pathname.startsWith('/ofertas-de-trabajo/')) {
        pageUrl.searchParams.delete('by');
      } else if (!pageUrl.searchParams.has('by')) {
        pageUrl.searchParams.set('by', 'publicationtime');
      }
      pageUrl.searchParams.set('p', String(page));

      let html;
      try {
        html = await fetchTextWithRetry(ctx, pageUrl.href, {
          timeoutMs: REQUEST_TIMEOUT_MS,
          redirect: 'error',
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        }, probing ? { retries: 0 } : {});
      } catch (err) {
        if (probing || page === 1) throw err;
        console.warn(`[computrabajo] ${entry.name}: page ${page} failed (${(err && err.message) || err}); keeping the ${jobs.length} posting(s) from earlier pages.`);
        stopReason = 'fetch-error';
        break;
      }

      const cards = parseCards(html, listUrl.origin);
      if (cards.length === 0) {
        const challenged = CHALLENGE_RE.test(html);
        if (page === 1) {
          if (challenged) throw new Error(`computrabajo: anti-bot challenge on ${pageUrl.href}, no postings readable`);
          if (POSTING_HREF_RE.test(html)) throw new Error(`computrabajo: ${pageUrl.href} links postings but no card parsed (markup change?)`);
          return []; // a search with no results
        }
        if (challenged) {
          console.warn(`[computrabajo] ${entry.name}: anti-bot challenge on page ${page}; keeping the ${jobs.length} posting(s) from earlier pages.`);
          stopReason = 'challenge';
        }
        break;
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
      if (stopReason === 'cap' || fresh === 0 || jobs.length >= maxJobs) break;
      if (page === maxPages && !probing && cards.length >= OBSERVED_PAGE_SIZE) stopReason = 'cap';
    }

    if (stopReason === 'cap') {
      console.warn(`[computrabajo] ${entry.name}: stopped at the provider's crawl limit (${maxPages} page(s), ${maxJobs} posting(s)); the search has more results. Narrow the search URL to see them.`);
    }
    return jobs;
  },
};
