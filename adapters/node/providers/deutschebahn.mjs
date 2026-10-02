// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { decodeEntities } from './_html-entities.mjs';

// Deutsche Bahn provider — single-company (pattern: ibm/dassault/rheinmetall).
// DB's careers run on the custom db.jobs portal (the branded Avature front,
// jobs.deutschebahngroup.careers, just 302-redirects into it). The search page
// exposes a server-rendered results endpoint that paginates over bare HTTP:
//
//   GET {origin}/service/search/de-de/{searchId}?query=&sort=score&itemsPerPage=20&pageNum={N}
//
// {searchId} is the DB search-config id (5441588 at time of writing) — it's
// stable per portal, so we pin it via the api:/careers_url. Each result is:
//   <a href="/de-de/Suche/{slug}-{routeId}?jobId={jobId}" data-job-id="{jobId}" …>
//     <h3 class="m-search-hit__title"><span class="m-search-hit__title-text">{Title}</span>…</h3>
//     …<ul class="m-search-hit__items"><li …><i aria-label="Arbeitsort"></i> {City, Country} </li>…</ul>
//   </a>
// data-job-id is the dedup key; the href resolves to the public posting.
//
// The board is large (thousands of postings, mostly rail operations) — rely on
// title/location filters; MAX_JOBS + max_pages bound the walk.

const ITEMS_PER_PAGE = 20; // DB's default page size
const MAX_PAGES = 60; // safety cap on request count (60*20 = 1200 postings)
const MAX_JOBS = 1000; // cap total postings pulled
const PAGE_DELAY_MS = 150; // polite pacing between page requests

/** @param {string} s */
function clean(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Resolve the search-config base from api:/careers_url. Accepts either a full
// /service/search/de-de/{id} URL, or any db.jobs URL that carries the numeric
// search id in its path; falls back to the well-known DB id.
/** @param {import('./_types.js').PortalEntry} entry */
export function resolveConfig(entry) {
  const raw = entry.api || entry.careers_url || '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.host.toLowerCase();
  if (host !== 'db.jobs' && !host.endsWith('.db.jobs')) return null;
  const idM = u.pathname.match(/\/service\/search\/de-de\/(\d+)/) || u.pathname.match(/\/(\d{6,})(?:[/?]|$)/);
  const searchId = idM ? idM[1] : '5441588';
  return {
    origin: u.origin,
    searchBase: `${u.origin}/service/search/de-de/${searchId}`,
  };
}

/**
 * Parse one search-results fragment into raw {id, title, url, location}.
 * @param {string} html @param {string} origin
 */
export function parseHits(html, origin) {
  if (typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();
  // Each hit is an <a class="m-search-hit" href data-job-id> … </a>.
  const re = /<a\b[^>]*class="[^"]*m-search-hit\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const anchor = m[0];
    const inner = m[1];
    const hrefM = anchor.match(/href="([^"]+)"/);
    const idM = anchor.match(/data-job-id="([^"]+)"/);
    if (!hrefM) continue;
    const href = decodeEntities(hrefM[1]);
    const id = idM ? idM[1] : href;
    if (seen.has(id)) continue;
    const titleM = inner.match(/m-search-hit__title-text"[^>]*>([\s\S]*?)<\/span>/i);
    const title = titleM ? clean(titleM[1]) : '';
    if (!title) continue;
    // Location: the <li> whose icon is aria-label="Arbeitsort".
    const locM = inner.match(/aria-label="Arbeitsort"[^>]*><\/i>([\s\S]*?)<\/li>/i);
    let url;
    try {
      url = new URL(href, origin).href;
    } catch {
      continue;
    }
    seen.add(id);
    out.push({ id, title, url, location: locM ? clean(locM[1]) : '' });
  }
  return out;
}

/** Resolve the page cap: positive integer `max_pages`, else default. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES);
  return MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'deutschebahn',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    return resolveConfig({ api: url }) ? { url } : null;
  },

  async fetch(entry, ctx) {
    const cfg = resolveConfig(entry);
    if (!cfg) throw new Error(`deutschebahn: cannot resolve db.jobs search id for ${entry.name}`);

    const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
    const maxPages = resolveMaxPages(entry);
    const jobs = [];
    const seen = new Set();

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await wait(PAGE_DELAY_MS);
      const url = `${cfg.searchBase}?qli=true&query=&sort=score&itemsPerPage=${ITEMS_PER_PAGE}&pageNum=${page}`;
      const html = await ctx.fetchText(url, { headers: { accept: 'text/html' } });
      const rows = parseHits(html, cfg.origin);
      if (rows.length === 0) break; // past the last page

      let fresh = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        fresh++;
        jobs.push({ title: row.title, url: row.url, company: entry.name, location: row.location });
      }
      if (fresh === 0) break; // server clamped pageNum / looped
      if (jobs.length >= MAX_JOBS) break;
    }
    return jobs.slice(0, MAX_JOBS);
  },
};
