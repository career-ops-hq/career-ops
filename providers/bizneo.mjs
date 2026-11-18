// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Bizneo HR provider — career sites built with Bizneo's ATS (Spanish vendor,
// https://www.bizneo.com). Target list: `tracked_companies:`, one entry per
// employer. Bizneo boards live on the employer's own domain
// (`empleo.<company>.com`, `jobs.<company>.com`), so there is no vendor host to
// recognise and `detect()` is omitted: the entry names the provider itself,
//
//   - name: Example Bizneo Co
//     careers_url: https://empleo.exampleco.com/jobs
//     provider: bizneo
//
// `*.bizneohr.com` is Bizneo's HR application (it redirects to a sign-in
// page, checked 2026-11-18), not a careers site, so it is not claimed either.
//
// The board is server-rendered HTML with one card per posting, anchored on the
// `job-card` class of the `<a>` that wraps it:
//
//   <a class="job-card" href="https://empleo.exampleco.com/jobs/<slug>">
//     <div class="title">…</div>
//     <div class="details"><span>Madrid</span><span>Presencial</span></div>
//   </a>
//
// The first `<span>` is the place; a second one carries the work model
// (Presencial / Híbrido / Teletrabajo/Remoto). The card holds no company name,
// date or id (the slug in the URL is not a stable id), so `company` is the
// entry name and `postedAt` / `listingIdentity` are omitted.
//
// Pagination is `/jobs?page=N`. The boards checked on 2026-11-18 hold 1 to 3
// postings, so the page size is not known; a page past the end answers 200
// with no cards, which is where the walk stops (as does a page that adds
// nothing new, in case a board ignores `page`). Page 1 must look like a
// Bizneo career site (`career-site` body class) and, when it carries cards,
// at least one must parse; otherwise the markup changed and this throws
// instead of reading as an empty board.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry, sleep } from './_http.mjs';
import { visibleText } from './_html-to-text.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

const DEFAULT_MAX_PAGES = 30;
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 250;

/** An opening `<a>` whose class list contains `job-card`, and everything up to its `</a>`. */
const CARD_RE = /<a\b([^>]*\bclass="[^"]*\bjob-card\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
const HREF_RE = /\bhref="([^"]*)"/i;
const TITLE_RE = /<div\b[^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
const DETAILS_RE = /<div\b[^>]*\bclass="[^"]*\bdetails\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
const SPAN_RE = /<span\b[^>]*>([\s\S]*?)<\/span>/gi;
const CAREER_SITE_RE = /<body\b[^>]*\bclass="[^"]*\bcareer-site\b/i;

/** Work-model labels a card can carry, matched whole so a place is never taken for one. */
const WORK_MODELS = /** @type {const} */ ([
  [/^(?:teletrabajo(?:\s*\/\s*remoto)?|remoto|remote)$/i, 'remote'],
  [/^(?:h[ií]brido|hybrid)$/i, 'hybrid'],
  [/^(?:presencial|on-?site)$/i, 'onsite'],
]);

/**
 * Hostname of a careers URL, validated; the origin is rebuilt from it so a
 * port, userinfo or path in the entry never reaches the request.
 * @param {string | undefined} raw
 */
function boardHost(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw ?? ''));
  } catch {
    throw new Error(`bizneo: invalid careers_url: ${raw}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`bizneo: careers_url must use HTTPS: ${raw}`);
  return parsed.hostname;
}

/** @param {any} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  return Number.isInteger(v) && v > 0 ? Math.min(v, MAX_PAGES_CAP) : DEFAULT_MAX_PAGES;
}

/**
 * Parse one listing page. Cards without a title or a same-host https link are
 * dropped; the rest of the board stands.
 *
 * @param {string} html
 * @param {string} host - Board hostname; cards linking elsewhere are not postings of this board.
 * @param {string} company
 * @returns {{ jobs: any[], cards: number }} `cards` counts the cards seen, parsed or not.
 */
export function parseListingPage(html, host, company) {
  const source = String(html ?? '');
  /** @type {any[]} */
  const jobs = [];
  let cards = 0;
  CARD_RE.lastIndex = 0;
  let m;
  while ((m = CARD_RE.exec(source)) !== null) {
    cards++;
    const href = HREF_RE.exec(m[1]);
    const titleHtml = TITLE_RE.exec(m[2]);
    if (!href || !titleHtml) continue;
    const title = visibleText(titleHtml[1]);
    let url;
    try {
      const u = new URL(visibleText(href[1]), `https://${host}/`);
      if (u.protocol !== 'https:' || u.hostname !== host) continue;
      u.hash = '';
      url = u.href;
    } catch {
      continue;
    }
    if (!title) continue;

    /** @type {string[]} */
    const places = [];
    /** @type {'remote' | 'hybrid' | 'onsite' | undefined} */
    let workplaceType;
    const details = DETAILS_RE.exec(m[2]);
    if (details) {
      SPAN_RE.lastIndex = 0;
      let s;
      while ((s = SPAN_RE.exec(details[1])) !== null) {
        const text = visibleText(s[1]);
        if (!text) continue;
        const model = WORK_MODELS.find(([re]) => re.test(text));
        if (model) workplaceType = workplaceType ?? model[1];
        else places.push(text);
      }
    }
    const base = places.join(', ');
    const location = workplaceType === 'remote' ? [base, 'Remote'].filter(Boolean).join(', ') : base;
    jobs.push({
      title,
      url,
      company,
      location,
      ...(places.length ? { locations: places } : {}),
      ...(workplaceType ? { workplaceType } : {}),
    });
  }
  return { jobs, cards };
}

/** @type {Provider} */
export default {
  id: 'bizneo',

  async fetch(entry, ctx) {
    const host = boardHost(entry?.careers_url);
    const company = String(entry?.name ?? '');
    const ctxMax = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const entryMax = resolveMaxPages(entry);
    const maxPages = Math.min(entryMax, ctxMax);

    /** @type {any[]} */
    const jobs = [];
    const seen = new Set();
    let capped = false;

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = `https://${host}/jobs${page > 1 ? `?page=${page}` : ''}`;
      const html = await fetchTextWithRetry(ctx, url, {
        headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' },
        redirect: 'error',
      });

      const { jobs: parsed, cards } = parseListingPage(html, host, company);
      if (page === 1) {
        if (!CAREER_SITE_RE.test(html)) {
          throw new Error(`bizneo: ${url} does not look like a Bizneo career site (no career-site page)`);
        }
        if (cards > 0 && parsed.length === 0) {
          throw new Error(`bizneo: ${url} has job cards but none could be parsed — the listing markup changed`);
        }
      }
      if (cards === 0) break;

      const before = seen.size;
      for (const job of parsed) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
      }
      if (seen.size === before) break;
      // Still finding new postings on the last page the entry allows: the ceiling cut the walk.
      if (page === maxPages && entryMax <= ctxMax) capped = true;
    }

    if (capped) {
      console.warn(`bizneo: ${entry?.name || host}: stopped at max_pages (${maxPages}) with more pages possible; raise max_pages on this entry`);
      markTruncated(jobs, 'page-cap', { fetched: jobs.length });
    }
    return jobs;
  },
};
