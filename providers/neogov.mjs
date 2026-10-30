// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

// NEOGOV provider — public-sector and education careers sites on
// `www.schooljobs.com` and `www.governmentjobs.com` (community colleges, school
// districts, cities, counties). tracked_companies: (one entry = one agency).
// Auto-detects from a careers_url shaped `/careers/<agency>[/<folder>]`.
//
// The public page is an SPA, but it loads its list from a plain HTML endpoint,
// `/careers/home/index`, paged 10 at a time. An optional `<folder>` (a custom
// careers page such as Clark College's `facultypositions`) is sent as
// `departmentFolder`, scoping the list to that page; without one, every posting
// for the agency is returned.
//
// The bare hosts (`schooljobs.com`, `governmentjobs.com`) redirect to `www.`,
// which redirect:'error' would refuse, so detect() normalises to the www host.
// A wrong agency slug is answered with a redirect to the site's home page and so
// fails loudly instead of reading as an empty board.

const NEOGOV_ORIGINS = new Map([
  ['schooljobs.com', 'https://www.schooljobs.com'],
  ['www.schooljobs.com', 'https://www.schooljobs.com'],
  ['governmentjobs.com', 'https://www.governmentjobs.com'],
  ['www.governmentjobs.com', 'https://www.governmentjobs.com'],
]);
const SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

const PAGE_SIZE = 10;
const DEFAULT_MAX_PAGES = 30; // 300 postings
const MAX_PAGES_CAP = 200;
const INTER_PAGE_DELAY_MS = 200;

/** @param {import('./_types.js').PortalEntry} entry */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * `{ origin, agency, folder }` from a careers_url, or null.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{origin: string, agency: string, folder: string} | null}
 */
function resolveTarget(entry) {
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const origin = NEOGOV_ORIGINS.get(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' || !origin) return null;
  const [root, agency, folder = ''] = parsed.pathname.split('/').filter(Boolean);
  if (root !== 'careers' || !agency || !SEGMENT_RE.test(agency)) return null;
  // `careers/home/...` is the site's own path, not an agency.
  if (agency.toLowerCase() === 'home') return null;
  if (folder && !SEGMENT_RE.test(folder)) return null;
  return { origin, agency: agency.toLowerCase(), folder: folder.toLowerCase() };
}

/**
 * @param {{origin: string, agency: string, folder: string}} t
 * @param {number} page
 */
function pageUrl(t, page) {
  const q = new URLSearchParams({ agency: t.agency });
  if (t.folder) q.set('departmentFolder', t.folder);
  q.set('sort', 'PostingDate');
  q.set('isDescendingSort', 'true');
  q.set('page', String(page));
  return `${t.origin}/careers/home/index?${q}`;
}

/** @type {Provider} */
export default {
  id: 'neogov',

  detect(entry) {
    const t = resolveTarget(entry);
    return t ? { url: pageUrl(t, 1) } : null;
  },

  async fetch(entry, ctx) {
    const t = resolveTarget(entry);
    if (!t) throw new Error(`neogov: cannot derive agency for ${entry.name} (need an https://www.schooljobs.com/careers/<agency>[/<folder>] or governmentjobs.com careers_url)`);

    const ctxMax = Number(ctx?.maxPages);
    const ceiling = resolveMaxPages(entry);
    const pagesToFetch = ctxMax > 0 ? Math.min(ceiling, ctxMax) : ceiling;

    const jobs = [];
    const seen = new Set();
    let stoppedOnEmpty = false;
    let pagesFetched = 0;
    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      // No catch: rejections (incl. the probe's ProbePageBudgetReached) propagate
      // unwrapped, and a real failure fails the target rather than returning a
      // partial list.
      const html = await fetchTextWithRetry(ctx, pageUrl(t, page), {
        redirect: 'error',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      pagesFetched++;
      const found = parseNeogovPage(html, entry.name, t.origin);
      // A page that adds nothing new is the end — or the site ignoring `page`
      // and repeating itself. Either way, stop instead of looping.
      let fresh = 0;
      for (const job of found) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        jobs.push(job);
        fresh++;
      }
      if (fresh === 0) {
        stoppedOnEmpty = true;
        break;
      }
    }
    if (!stoppedOnEmpty && pagesFetched >= ceiling && !(ctxMax > 0 && ctxMax < ceiling)) {
      console.warn(`neogov: ${entry.name}: stopped at ${ceiling} pages (${ceiling * PAGE_SIZE} postings); raise max_pages on this entry`);
    }
    return jobs;
  },
};

/** @param {string} s */
const text = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Parse one `/careers/home/index` HTML page. Exported for unit tests.
 *
 * Each posting is an `<li class="list-item">` holding an
 * `<a class="item-details-link" href="/careers/<agency>/[<folder>/]jobs/<id>/<slug>">`
 * and a `<ul class="list-meta">` whose first `<li>` is the work location.
 *
 * - Empty/blank body → [].
 * - A body with no list items but the page's own `jobs-not-found-container`
 *   (or an empty `search-results-listing-container`) → [] — an empty board, or a
 *   page past the last one.
 * - Any other non-empty body → throws (not the documented endpoint), so a
 *   changed page cannot read as an empty board forever.
 * - Hrefs that do not resolve to a `/careers/…/jobs/…` path on the same origin
 *   are skipped, so a page can never point a job off-site.
 *
 * @param {string} html
 * @param {string} companyName
 * @param {string} origin  e.g. "https://www.schooljobs.com"
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseNeogovPage(html, companyName, origin) {
  if (typeof html !== 'string' || !html.trim()) return [];
  const items = html.split(/<li class="list-item"/i).slice(1);
  if (!items.length) {
    // "No jobs at this time." / "No jobs found." (and every page past the last)
    // render this container instead of a list.
    if (html.includes('jobs-not-found-container') || html.includes('search-results-listing-container')) return [];
    throw new Error('neogov: response is not a NEOGOV job list (no list items, listing container or not-found container)');
  }
  const jobs = [];
  for (const item of items) {
    const link =
      item.match(/<a [^>]*class="item-details-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
      item.match(/<a [^>]*href="([^"]+)"[^>]*class="item-details-link"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const title = text(link[2]);
    let url;
    try {
      const u = new URL(decodeEntities(link[1]), origin);
      if (u.origin !== origin || !/^\/careers\/[^/]+\/(?:[^/]+\/)?jobs\/\d+/.test(u.pathname)) continue;
      u.hash = '';
      url = u.href;
    } catch {
      continue;
    }
    if (!title) continue;
    const meta = (item.match(/<ul class="list-meta">([\s\S]*?)<\/ul>/i) || [])[1] || '';
    const location = text((meta.match(/<li>([\s\S]*?)<\/li>/i) || [])[1] || '');
    jobs.push({ title, url, company: companyName, location });
  }
  return jobs;
}
