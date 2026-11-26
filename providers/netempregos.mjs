// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Net-Empregos (Portugal) provider: net-empregos.com, a Portuguese job board
// for every sector. A `job_boards:` feed. Wire it in with a Net-Empregos
// listing URL copied from the browser: a category or area page, or a search.
//
//   - name: Net-Empregos — Programação
//     careers_url: https://www.net-empregos.com/empregos-portugal-informatica-programacao.asp?categoria=5&zona=0
//     enabled: true
//
//   - name: Net-Empregos — Python
//     careers_url: https://www.net-empregos.com/pesquisa-empregos.asp?chaves=python&categoria=&cidade=
//     enabled: true
//
// PUBLIC PAGES, NO AUTH. The listing pages are server-rendered HTML: 18 cards
// a page, `page=N` (1-based) walks them, and the page states the total
// ("807 ofertas encontradas"). This provider keeps the URL's path and query,
// drops any `page`, and walks the pages. For the programming category
// (`categoria=5`) on 2026-11-26 the walk read 807 cards in 45 pages, the
// total the page stated; 6 cards came twice, pushed one page on by ads posted
// during the walk, and are kept once.
//
// PAGE SHAPE (measured 2026-11-26). Each card is a `div.job-item`: the title
// links to the posting page (`/<id>/<slug>/`), and a list carries the date
// (`dd-mm-yyyy`, the day without a leading zero up to the 9th: `4-11-2026`),
// the place, the category and the employer. Featured ads
// (`job-item-destaque`, "Oferta em Destaque") are the same cards, shown first
// on page 1; they are not repeated further on, and this provider keeps no
// order of its own. Below the results, and on a search with no results, the
// page lists "Ofertas de Emprego Semelhantes" (similar offers outside the
// search): those cards are not read.
// The card carries no employer link: the posting page shows the application
// email or link to signed-in candidates (a free account), so `url` is the
// posting page. Nothing here is a job description.
//
// ENCODING. The pages are ISO-8859-1 (`<meta charset="ISO-8859-1">`, no
// charset in the Content-Type), so they are read with `charset:
// 'windows-1252'`, which is how browsers decode that label.
//
// EMPLOYER. Every card names one; 2 of 807 named "Anónimo" or "Confidencial".
// Those name no employer (Source Indexing Policy rule 1), so they are counted
// in `providerStats` under `no_employer` and not returned.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

const ORIGIN = 'https://www.net-empregos.com';
const ALLOWED_HOSTS = new Set(['www.net-empregos.com', 'net-empregos.com']);
const CHARSET = 'windows-1252';

/** The search page, and the category / area pages (`/empregos-lisboa-todas-categorias.asp`). */
const LISTING_PATH_RE = /^\/(?:pesquisa-empregos|empregos-[a-z0-9-]+)\.asp$/i;

/** Measured page size; a shorter page is the last one. */
const PAGE_SIZE = 18;

/** 900 postings by default; a wider listing is cut with a warning. */
const DEFAULT_MAX_PAGES = 50;

/** Hard ceiling on a configured `max_pages`: 3,600 postings, 5 minutes at the pacing below. */
const MAX_PAGES_CAP = 200;

/**
 * Measured, not a guess. robots.txt states no Crawl-delay, but on 2026-11-26
 * the site answered every page with its candidate login page (HTTP 200) for
 * about 26 minutes after a walk of about 50 pages at 250 ms, following about 60
 * earlier requests that hour, most 1.5 s apart. Walks 1.5 s apart (45, 47 and
 * 20 pages) were served in full.
 */
const INTER_PAGE_DELAY_MS = 1500;

/** Employer names that name no employer, compared after `foldName`. */
const NO_EMPLOYER = new Set(['anonimo', 'confidencial']);

const CARD_RE = /<div class="job-item\b[^"]*"/gi;
const POSTING_HREF_RE = /^\/(\d+)\/([a-z0-9-]+)\/$/i;

/**
 * Parse a careers_url into a Net-Empregos URL. Throws on anything else.
 * @param {unknown} raw
 * @returns {URL}
 */
function parseListingUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('netempregos: careers_url is required (a Net-Empregos listing URL)');
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`netempregos: invalid URL: ${raw}`);
  }
  if (url.protocol !== 'https:') throw new Error(`netempregos: URL must use HTTPS: ${raw}`);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`netempregos: untrusted hostname "${url.hostname}" — must be www.net-empregos.com`);
  }
  return url;
}

/**
 * Build the URL of one listing page from the configured URL.
 * @param {unknown} careersUrl
 * @param {number} page 1-based
 * @returns {string}
 */
export function buildPageUrl(careersUrl, page) {
  const listing = parseListingUrl(careersUrl);
  if (!LISTING_PATH_RE.test(listing.pathname)) {
    throw new Error(
      `netempregos: "${listing.pathname}" is not a listing page. Use a category, area or search page, e.g. `
      + 'https://www.net-empregos.com/empregos-portugal-informatica-programacao.asp?categoria=5&zona=0',
    );
  }
  const params = new URLSearchParams(listing.search);
  params.delete('page');
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `${ORIGIN}${listing.pathname}${query ? `?${query}` : ''}`;
}

// Strip tags to a fixed point, then drop any stray bracket (see jobbankca.mjs).
function stripTags(s) {
  let prev;
  let out = s;
  do {
    prev = out;
    out = out.replace(/<([^>]*)(>?)/g, (tag, body, close) => (close && body ? '' : tag));
  } while (out !== prev);
  return out.replace(/[<>]/g, '');
}

/** Strip tags, decode, collapse whitespace. */
function clean(s) {
  return decodeEntities(stripTags(String(s))).replace(/\s+/g, ' ').trim();
}

/** Lowercase without accents, for comparing placeholder names. */
function foldName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Text of the `<li>` that carries an icon class, or ''. */
function itemText(card, iconClass) {
  const m = card.match(new RegExp(`<li\\b[^>]*>\\s*<i class="${iconClass}"[^>]*>\\s*</i>([\\s\\S]*?)</li>`, 'i'));
  return m ? clean(m[1]) : '';
}

/** `d-mm-yyyy` / `dd-mm-yyyy` to epoch ms at UTC midnight, or undefined. */
function toEpochMs(value) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(value);
  if (!m) return undefined;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? ms : undefined;
}

/**
 * Parse one Net-Empregos listing page. Exported for unit tests.
 * Returns the postings of the results, `rawCount` (cards in the results,
 * before any is dropped), `noEmployer` (cards naming no employer) and
 * `unrecognised` (cards without a posting link or a title).
 * Throws when the page is the site's login page, when it is not a listing
 * page, or when its results hold cards and none could be read (the markup
 * changed).
 * @param {string} html
 * @returns {{ jobs: {title: string, url: string, company: string, location: string, postedAt?: number}[], rawCount: number, noEmployer: number, unrecognised: number }}
 */
export function parseNetEmpregosPage(html) {
  const body = String(html ?? '');
  // The site answers with its login page, in place of the listing, when it
  // limits requests (see INTER_PAGE_DELAY_MS). A login in the way is a stop
  // (Source Indexing Policy rule 6), and it is not a markup change.
  if (/<title>[^<]*Login de Candidato/i.test(body)) {
    throw new Error('netempregos: the site answered with its login page instead of the listing (it does this after many requests in a short time); try again later');
  }
  if (/N[ãa]o encontr[áa]mos nenhuma oferta/i.test(body)) {
    return { jobs: [], rawCount: 0, noEmployer: 0, unrecognised: 0 };
  }
  const header = body.match(/\d[\d.]*\s+ofertas?\s+encontradas?/i);
  if (!header || header.index === undefined) {
    throw new Error(`netempregos: unexpected response — no results header ("N ofertas encontradas"), got: ${JSON.stringify(body.slice(0, 80))}`);
  }
  const start = header.index + header[0].length;
  const ends = [body.indexOf('Ofertas de Emprego Semelhantes', start), body.indexOf('class="pagination-box', start)].filter((i) => i >= 0);
  const results = body.slice(start, ends.length ? Math.min(...ends) : body.length);

  const starts = [...results.matchAll(CARD_RE)].map((m) => /** @type {number} */ (m.index));
  const jobs = [];
  let noEmployer = 0;
  let unrecognised = 0;
  for (let i = 0; i < starts.length; i++) {
    const card = results.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : results.length);
    const link = card.match(/<h2\b[^>]*>\s*<a\b[^>]*\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/i);
    const href = link ? decodeEntities(link[1] ?? link[2] ?? link[3] ?? '') : '';
    const title = link ? clean(link[4]) : '';
    if (!POSTING_HREF_RE.test(href) || !title) {
      unrecognised++;
      continue;
    }
    const company = itemText(card, 'flaticon-work');
    if (!company || NO_EMPLOYER.has(foldName(company))) {
      noEmployer++;
      continue;
    }
    const postedAt = toEpochMs(itemText(card, 'flaticon-calendar'));
    jobs.push({
      title,
      url: `${ORIGIN}${href}`,
      company,
      location: itemText(card, 'flaticon-pin'),
      ...(postedAt !== undefined ? { postedAt } : {}),
    });
  }
  if (starts.length && !jobs.length && !noEmployer) {
    throw new Error(`netempregos: ${starts.length} card(s) but none recognised — the page markup may have changed`);
  }
  return { jobs, rawCount: starts.length, noEmployer, unrecognised };
}

/** @param {{ max_pages?: unknown }} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && /** @type {number} */ (v) > 0) return Math.min(/** @type {number} */ (v), MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'netempregos',

  detect(entry) {
    try {
      const url = parseListingUrl(entry?.careers_url);
      return { url: url.href };
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMax = resolveMaxPages(entry);
    const maxPages = Math.min(entryMax, probing ? ctx.maxPages : Infinity);
    buildPageUrl(entry?.careers_url, 1); // config errors throw before any request

    /** @type {Map<string, any>} */
    const byUrl = new Map();
    const stats = { dropped: {} };
    let stop = 'cap';
    let stopError = '';
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let parsed;
      try {
        const html = await fetchTextWithRetry(ctx, buildPageUrl(entry?.careers_url, page), { redirect: 'error', charset: CHARSET });
        parsed = parseNetEmpregosPage(html);
      } catch (err) {
        if (page === 1 || probing) throw err;
        stop = 'fetch-error'; // a failed or broken later page: keep the pages already read
        stopError = err instanceof Error ? err.message : String(err);
        break;
      }
      const { jobs, rawCount, noEmployer, unrecognised } = parsed;
      if (noEmployer) stats.dropped.no_employer = (stats.dropped.no_employer || 0) + noEmployer;
      if (unrecognised) stats.dropped.unrecognised = (stats.dropped.unrecognised || 0) + unrecognised;
      for (const job of jobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
      if (rawCount < PAGE_SIZE) {
        stop = 'complete';
        break;
      }
    }

    const jobs = [...byUrl.values()];
    // Read by scan.mjs for the per-source summary; not part of the job list.
    Object.defineProperty(jobs, 'providerStats', { value: stats, enumerable: false });
    if (stop === 'fetch-error') {
      console.error(`⚠️  netempregos: ${entry?.name || 'entry'} stopped on a failed or broken page (${stopError}); kept ${jobs.length} posting(s) from the pages already read`);
      markTruncated(jobs, 'fetch-error', { fetched: jobs.length });
    } else if (stop === 'cap' && !probing) {
      console.error(`⚠️  netempregos: ${entry?.name || 'entry'} truncated at max_pages=${entryMax} (${jobs.length} postings) — raise max_pages on this entry or narrow the listing`);
      markTruncated(jobs, 'page-cap', { fetched: jobs.length });
    }
    return jobs;
  },
};
