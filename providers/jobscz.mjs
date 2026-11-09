// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// jobs.cz (Czechia) provider — keyword search over the public listing pages of
// Alma Career's jobs.cz portal. Wire in via a `job_boards` entry with
// `provider: jobscz`:
//
//   - name: Jobs.cz
//     provider: jobscz
//     enabled: true
//     jobscz:
//       # keywords optional: falls back to config/profile.yml's target_roles.
//       keywords: ["backend developer", "vývojář"]
//       location: praha   # optional; the site's own slug (praha, brno, …)
//     max_pages: 10       # optional page cap per keyword
//
// Measured 2026-10-20:
//   - robots.txt: `User-agent: *` disallows /muj/ /asmt/ /api/ /iapi/
//     /status/ /translations/ /js/ /nabidky-podle-cv/ /session-log/; /prace/
//     is allowed. Only /prace/ listing pages are fetched here.
//   - Search URL: `https://www.jobs.cz/prace/?q%5B%5D=python`; a location is a
//     path segment (`/prace/praha/`), and an unknown slug answers 404.
//   - Words inside one `q[]` value are AND-matched; separate `q[]` values are
//     OR-matched. Each keyword is one `q[]` value and its own search, so every
//     keyword gets its own page window.
//   - 30 cards per page, `&page=N`. A page past the last 302-redirects to the
//     last page, which `redirect: 'error'` refuses, so the walk never requests
//     past ceil(total / 30).

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

const SEARCH_URL = 'https://www.jobs.cz/prace/';
const POSTING_URL_BASE = 'https://www.jobs.cz/rpd/';
const PAGE_SIZE = 30;
const DEFAULT_MAX_PAGES = 10;
const INTER_PAGE_DELAY_MS = 1000;

const MONTHS = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

/**
 * @param {{ jobscz?: any }} entry
 * @returns {{ keywords: string[], location: string }}
 */
export function parseJobsCzConfig(entry) {
  const cfg = (entry && entry.jobscz) || {};
  const keywords = Array.isArray(cfg.keywords)
    ? cfg.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim())
    : [];
  const location = typeof cfg.location === 'string' ? cfg.location.trim() : '';
  return { keywords, location };
}

/**
 * @param {string} keyword
 * @param {number} page
 * @param {string} location
 * @returns {string}
 */
export function buildSearchUrl(keyword, page, location) {
  const path = location ? `${encodeURIComponent(location)}/` : '';
  return `${SEARCH_URL}${path}?q%5B%5D=${encodeURIComponent(keyword)}${page > 1 ? `&page=${page}` : ''}`;
}

/**
 * @param {string} text
 * @param {number} [nowMs]
 * @returns {number|undefined}
 */
export function parsePostedAt(text, nowMs = Date.now()) {
  const date = /^(\d{1,2})\.\s*(\p{L}+)$/u.exec(text);
  if (date) {
    const month = MONTHS.indexOf(date[2]);
    if (month === -1) return undefined;
    const year = new Date(nowMs).getFullYear();
    const ms = new Date(year, month, Number(date[1])).getTime();
    return ms > nowMs ? new Date(year - 1, month, Number(date[1])).getTime() : ms;
  }
  if (text === 'Přidáno dnes') return nowMs;
  if (text === 'Přidáno včera') return nowMs - 86_400_000;
  const ago = /^Aktualizováno před (\d+) (minut|hodin)/.exec(text);
  if (ago) return nowMs - Number(ago[1]) * (ago[2] === 'minut' ? 60_000 : 3_600_000);
  return undefined;
}

/** @param {string|undefined} html */
function cleanText(html) {
  return decodeEntities((html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} html
 * @param {number} [nowMs]
 * @returns {{ total: number, jobs: {title: string, url: string, company: string, location: string, postedAt?: number}[] }}
 */
export function parseJobsCzPage(html, nowMs = Date.now()) {
  const cards = html.split(/<article\s+class="SearchResultCard[^"]*"/).slice(1);
  const jobs = [];
  for (const card of cards) {
    const id = /data-jobad-id="(\d+)"/.exec(card)?.[1];
    const title = cleanText(/data-test-ad-title="([^"]*)"/.exec(card)?.[1]);
    const seg = id && safeEncodeURIComponent(id);
    if (!seg || !title) continue;
    const postedAt = parsePostedAt(cleanText(/data-test-ad-status="[^"]*"[^>]*>([^<]*)</.exec(card)?.[1]), nowMs);
    jobs.push({
      title,
      url: `${POSTING_URL_BASE}${seg}/`,
      company: cleanText(/<span translate="no">([\s\S]*?)<\/span>/.exec(card)?.[1]),
      location: cleanText(/data-test="serp-locality"[^>]*>([\s\S]*?)<\/li>/.exec(card)?.[1]),
      ...(postedAt === undefined ? {} : { postedAt }),
    });
  }

  const text = decodeEntities(html.replace(/<[^>]*>/g, ' '));
  if (!cards.length) {
    if (text.includes('Nenašli jsme žádné nabídky')) return { total: 0, jobs: [] };
    throw new Error('jobscz: no result cards and no empty-result notice — page markup changed?');
  }
  const digits = /Našli jsme\s+([\d\s]+?)\s*nabíd/.exec(text)?.[1].replace(/\D/g, '');
  if (!digits) throw new Error('jobscz: result count not found — page markup changed?');
  return { total: Number(digits), jobs };
}

/** @type {Provider} */
export default {
  id: 'jobscz',

  detect(entry) {
    return entry?.provider === 'jobscz' ? { url: SEARCH_URL } : null;
  },

  async fetch(entry, ctx) {
    let { keywords, location } = parseJobsCzConfig(entry);
    if (!keywords.length) keywords = resolveProfileKeywords();
    const entryName = entry?.name || '(unnamed)';
    if (!keywords.length) {
      throw new Error(`jobscz: entry "${entryName}" has no jobscz.keywords[] and no config/profile.yml target_roles to fall back to`);
    }

    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const configured = Number.isInteger(entry?.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES;
    const maxPages = probing ? Math.min(configured, ctx.maxPages) : configured;

    /** @type {Map<string, any>} */
    const byUrl = new Map();
    const errors = [];

    for (const keyword of keywords) {
      let total = 0;
      let lastPage = 1;
      let rows = 0;
      for (let page = 1; page <= lastPage; page++) {
        if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);

        let html;
        try {
          html = await fetchTextWithRetry(ctx, buildSearchUrl(keyword, page, location), { redirect: 'error' });
        } catch (err) {
          if (probing) throw err;
          const message = (err && /** @type {Error} */ (err).message) || err;
          if (page === 1) errors.push([keyword, message]);
          else console.error(`⚠️  jobscz: "${keyword}" page ${page} failed (${message}) — kept ${rows} offers`);
          break;
        }

        const parsed = parseJobsCzPage(html);
        for (const job of parsed.jobs) {
          if (!byUrl.has(job.url)) byUrl.set(job.url, job);
        }
        rows += parsed.jobs.length;
        if (page === 1 && parsed.total > 0 && !parsed.jobs.length) {
          throw new Error(`jobscz: "${keyword}" reports ${parsed.total} offers but none parsed — page markup changed?`);
        }
        if (!parsed.jobs.length) break;

        if (page === 1) {
          total = parsed.total;
          lastPage = Math.min(Math.ceil(total / PAGE_SIZE), maxPages);
        }
        if (page === maxPages && Math.ceil(total / PAGE_SIZE) > maxPages && !probing) {
          console.error(`⚠️  jobscz: ${entryName} truncated at max_pages=${maxPages} (${rows} of ${total} offers for "${keyword}") — narrow the keyword, set jobscz.location, or raise max_pages`);
        }
      }
    }

    if (errors.length === keywords.length) {
      throw new Error(`jobscz: all ${keywords.length} keyword request(s) failed — "${errors[0][0]}": ${errors[0][1]}`);
    }
    for (const [keyword, message] of errors) {
      console.error(`⚠️  jobscz: "${keyword}" page 1 failed (${message}) — keyword skipped`);
    }

    return [...byUrl.values()];
  },
};
