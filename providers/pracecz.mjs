// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

// prace.cz (Czechia) provider — keyword search over the public listing pages
// of Alma Career's prace.cz portal. Wire in via a `job_boards` entry with
// `provider: pracecz`:
//
//   - name: Prace.cz
//     provider: pracecz
//     enabled: true
//     pracecz:
//       # keywords optional: falls back to config/profile.yml's target_roles.
//       keywords: ["backend developer", "vývojář"]
//       location: brno    # optional; the site's own slug (praha, brno, …)
//     max_pages: 10       # optional page cap per keyword
//
// Measured 2026-10-20:
//   - robots.txt: `User-Agent: *` disallows /auth/ /muj/ /asmt/ /hledat/
//     /odpovedni-formular/ /presmerovani-na-formular/ /odpoved-odeslana/;
//     /nabidky/ is allowed. Only /nabidky/ listing pages are fetched here,
//     never /hledat/.
//   - Search URL: `https://www.prace.cz/nabidky/?q=python`; a location is a
//     path segment (`/nabidky/brno/`), and an unknown slug answers 404.
//   - Words inside `q` are AND-matched. Each keyword is its own search, so
//     every keyword gets its own page window.
//   - 40 items per page, `&page=N`. A page past the last redirects to the last
//     page, which `redirect: 'error'` refuses, so the walk never requests past
//     ceil(total / 40).
//   - The page is Next.js App Router output: `self.__next_f.push([1,"…"])` RSC
//     chunks carry `"totalItems"` and `"currentPageItems":[…]` as JSON. That
//     JSON is read instead of the HTML, whose card CSS classes are hashed
//     modules (`JobCard-module-scss-module__ki5xOq__JobCard`) that change on
//     every rebuild.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

const SEARCH_URL = 'https://www.prace.cz/nabidky/';
const POSTING_URL_BASE = 'https://www.prace.cz/nabidka/';
const PAGE_SIZE = 40;
const DEFAULT_MAX_PAGES = 10;
const INTER_PAGE_DELAY_MS = 1000;
const NOT_FOUND = 'pracecz: currentPageItems/totalItems not found — page markup changed?';

/**
 * @param {{ pracecz?: any }} entry
 * @returns {{ keywords: string[], location: string }}
 */
export function parsePraceCzConfig(entry) {
  const cfg = (entry && entry.pracecz) || {};
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
  return `${SEARCH_URL}${path}?q=${encodeURIComponent(keyword)}${page > 1 ? `&page=${page}` : ''}`;
}

/**
 * @param {string} html
 * @returns {{ totalItems: number, items: any[] }}
 */
export function extractResults(html) {
  let text = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    const chunk = JSON.parse(m[1]);
    if (typeof chunk[1] === 'string') text += chunk[1];
  }

  const total = /"totalItems":(\d+)/.exec(text);
  const key = /"currentPageItems":\s*/.exec(text);
  const start = key ? key.index + key[0].length : -1;
  if (!total || text[start] !== '[') throw new Error(NOT_FOUND);

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      return { totalItems: Number(total[1]), items: JSON.parse(text.slice(start, i + 1)) };
    }
  }
  throw new Error(NOT_FOUND);
}

/** @param {any} raw */
function careerPageUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname.endsWith('.jobs.cz') ? url.origin + url.pathname : null;
  } catch {
    return null;
  }
}

/** @param {any} s */
function annualSalary(s) {
  const factor = s?.period === 'MONTH' ? 12 : s?.period === 'YEAR' ? 1 : 0;
  if (!factor || s.displayMode === 'NO') return undefined;
  /** @type {{ min?: number, max?: number, currency?: string }} */
  const out = {};
  if (Number.isFinite(s.min) && s.min > 0) out.min = s.min * factor;
  if (Number.isFinite(s.max) && s.max > 0) out.max = s.max * factor;
  if (!out.min && !out.max) return undefined;
  out.currency = String(s.currency ?? '').toUpperCase();
  return out;
}

/**
 * @param {any} item
 * @returns {Job | null}
 */
export function normalizeItem(item) {
  const advert = item?.advert ?? {};
  const title = typeof advert.title === 'string' ? advert.title.trim() : '';
  const id = item?.metadata?.advertId;
  const seg = id == null ? null : safeEncodeURIComponent(id);
  if (!title || !seg) return null;

  const work = advert.workLocation ?? {};
  const places = (Array.isArray(work.places) ? work.places : [])
    .map((p) => (typeof p?.city === 'string' ? p.city.trim() : ''))
    .filter(Boolean);
  if (work.type === 'FULL_REMOTE') places.unshift('Remote');

  const postedAt = Date.parse(item.metadata.publishedAt);
  const salary = annualSalary(advert.salary);
  return {
    title,
    url: careerPageUrl(item.extended?.careerPage?.url) ?? `${POSTING_URL_BASE}${seg}/`,
    company: typeof item.company?.publicName === 'string' ? item.company.publicName.trim() : '',
    location: places.join(', '),
    ...(Number.isNaN(postedAt) ? {} : { postedAt }),
    ...(typeof advert.language === 'string' && advert.language ? { language: advert.language } : {}),
    ...(salary ? { salary } : {}),
  };
}

/** @type {Provider} */
export default {
  id: 'pracecz',

  detect(entry) {
    return entry?.provider === 'pracecz' ? { url: SEARCH_URL } : null;
  },

  async fetch(entry, ctx) {
    let { keywords, location } = parsePraceCzConfig(entry);
    if (!keywords.length) keywords = resolveProfileKeywords();
    const entryName = entry?.name || '(unnamed)';
    if (!keywords.length) {
      throw new Error(`pracecz: entry "${entryName}" has no pracecz.keywords[] and no config/profile.yml target_roles to fall back to`);
    }

    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const configured = Number.isInteger(entry?.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES;
    const maxPages = probing ? Math.min(configured, ctx.maxPages) : configured;

    /** @type {Map<string, Job>} */
    const byId = new Map();
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
          else console.error(`⚠️  pracecz: "${keyword}" page ${page} failed (${message}) — kept ${rows} offers`);
          break;
        }

        const { totalItems, items } = extractResults(html);
        for (const item of items) {
          const job = normalizeItem(item);
          if (!job) continue;
          rows++;
          const id = String(item.metadata.advertId);
          if (!byId.has(id)) byId.set(id, job);
        }
        if (page === 1 && totalItems > 0 && !rows) {
          throw new Error(`pracecz: "${keyword}" reports ${totalItems} offers but none parsed — page markup changed?`);
        }
        if (!items.length) break;

        if (page === 1) {
          total = totalItems;
          lastPage = Math.min(Math.ceil(total / PAGE_SIZE), maxPages);
        }
        if (page === maxPages && Math.ceil(total / PAGE_SIZE) > maxPages && !probing) {
          console.error(`⚠️  pracecz: ${entryName} truncated at max_pages=${maxPages} (${rows} of ${total} offers for "${keyword}") — narrow the keyword, set pracecz.location, or raise max_pages`);
        }
      }
    }

    if (errors.length === keywords.length) {
      throw new Error(`pracecz: all ${keywords.length} keyword request(s) failed — "${errors[0][0]}": ${errors[0][1]}`);
    }
    for (const [keyword, message] of errors) {
      console.error(`⚠️  pracecz: "${keyword}" page 1 failed (${message}) — keyword skipped`);
    }

    return [...byId.values()];
  },
};
