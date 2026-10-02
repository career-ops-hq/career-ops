// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

// Deutsche Bahn provider — single-company (pattern: ibm/dassault/rheinmetall).
// DB's postings live in an Avature tenant (jobs.deutschebahngroup.careers,
// which also hosts login and applications); db.jobs is the custom search
// front over them, and the two share job ids. db.jobs's search page exposes a
// server-rendered results endpoint that paginates over bare HTTP:
//
//   GET {origin}/service/search/de-de/{searchId}?query=&sort=pubExternalDate_tdt&itemsPerPage=1000&pageNum={N}
//
// An empty query sorted by `score` renders the page shell with no results
// section at all, so the walk sorts by publication date (the order db.jobs's
// own Stellensuche link uses). Newest-first also makes MAX_JOBS keep the most
// recent postings.
//
// The order of postings that tie on the sort key (thousands share a
// publication date) differs from one request to the next, under every sort
// db.jobs offers, so consecutive pages overlap and skip postings at their
// boundaries. A large page keeps those boundaries rare: db.jobs doesn't cap
// the page size, and one 1000-hit page covers MAX_JOBS in a single request.
// Any request whose window reaches the board's total renders the
// results-less shell instead, so the board's last posting is never served
// and a last partial page arrives as the shell rather than short.
//
// {searchId} is the DB search-config id (5441588 at time of writing) — it's
// stable per portal, so we pin it via the api:/careers_url. Each result is:
//   <a href="/de-de/Suche/{slug}-{routeId}?jobId={jobId}" data-job-id="{jobId}" …>
//     <h3 class="m-search-hit__title"><span class="m-search-hit__title-text">{Title}</span>…</h3>
//     …<ul class="m-search-hit__items"><li …><i aria-label="Arbeitsort"></i> {City, Country} </li>…</ul>
//   </a>
// data-job-id is the dedup key; the href resolves to the public posting.
// Every results page also carries the total hit count:
//   <span class="result-count" data-count="3.596">3.596 Stellen</span>
// (German thousands separator; data-count="0" on a genuinely empty search).
//
// The board is large (thousands of postings, mostly rail operations) — rely on
// title/location filters; MAX_JOBS + max_pages bound the walk.

const ITEMS_PER_PAGE = 1000; // see header: large pages keep tie-order drift rare
const MAX_PAGES = 5; // safety cap on request count (5*1000 = 5000 postings)
const MAX_JOBS = 1000; // cap total postings pulled
const PAGE_DELAY_MS = 150; // polite pacing between page requests
const PAGE_TIMEOUT_MS = 30_000; // a 1000-hit page is ~4MB and takes several seconds
const SORT = 'pubExternalDate_tdt'; // newest first; see header for why not `score`

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

/**
 * Number of hit anchors the page carries, before parseHits drops malformed
 * or repeated rows — the page size the source actually returned.
 * @param {string} html
 */
export function countHitAnchors(html) {
  if (typeof html !== 'string') return 0;
  return (html.match(/<a\b[^>]*class="[^"]*m-search-hit\b[^"]*"/gi) || []).length;
}

/**
 * Total hit count from the results header, or null when the page has no
 * results section (the shell db.jobs renders for a query it can't serve).
 * @param {string} html
 */
export function parseResultCount(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/class="result-count"[^>]*data-count="([\d.]+)"/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * A page parseHits found nothing on must carry no posting-shaped link
 * (`?jobId={digits}`, the query every hit href ends in); one that does still
 * has postings the hit selector no longer matches. Applies to every page: on
 * a later page the results header always carries the board total, so this
 * is the only signal separating the end of the board from a markup change.
 * @param {string} html @param {string} url
 */
export function assertNoUnparsedHits(html, url) {
  if (!/href="[^"]*[?&](?:amp;)?jobId=\d+/.test(String(html ?? ''))) return;
  throw new Error(`deutschebahn: ${url} still contains posting links but no hit could be parsed — the listing markup changed`);
}

/**
 * A first page with no parsed hits is a genuinely empty board only when its
 * results header says data-count="0" and it carries no posting-shaped link. A
 * missing header (the request no longer yields a results section) or a
 * positive count (the hit markup changed) is a broken scan and throws, so it
 * never reads as "DB has no jobs".
 * @param {string} html @param {string} url
 */
export function assertEmptyFirstPage(html, url) {
  assertNoUnparsedHits(html, url);
  const count = parseResultCount(html);
  if (count === 0) return;
  if (count === null) throw new Error(`deutschebahn: ${url} returned no results section — the search request is no longer served`);
  throw new Error(`deutschebahn: ${url} reports ${count} postings but no hit could be parsed — the listing markup changed`);
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

    const maxPages = resolveMaxPages(entry);
    const jobs = [];
    const seen = new Set();

    // Each page is a multi-megabyte HTML document; an occasional timeout/abort
    // on one is a transient blip, not a board failure — fetchTextWithRetry
    // absorbs it instead of failing the whole scan.

    // Why the walk stopped: `cap` (max_pages ran out after a full page) unless
    // an exit below names another reason.
    let stopReason = 'cap';
    let lastHtml = '';
    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS, ctx);
      const url = `${cfg.searchBase}?qli=true&query=&sort=${SORT}&itemsPerPage=${ITEMS_PER_PAGE}&pageNum=${page}`;
      let html;
      try {
        html = await fetchTextWithRetry(ctx, url, { headers: { accept: 'text/html' }, redirect: 'error', timeoutMs: PAGE_TIMEOUT_MS });
      } catch (err) {
        // A failed first page is a dead board, and a liveness probe needs the
        // rejection unwrapped (verify-portals reads ProbePageBudgetReached by
        // type) — both propagate. A later page that exhausts its retries
        // keeps the pages already collected.
        if (page === 0 || ctx?.maxPages) throw err;
        console.warn(`deutschebahn: ${entry.name}: page ${page} failed (${err?.message ?? err}) — keeping the ${jobs.length} collected so far`);
        stopReason = 'fetch-error';
        break;
      }
      lastHtml = html;
      const rows = parseHits(html, cfg.origin);
      if (rows.length === 0) {
        stopReason = 'complete';
        if (page === 0) {
          assertEmptyFirstPage(html, url);
        } else {
          assertNoUnparsedHits(html, url);
          // An empty page whose offset is still inside the reported total
          // means the walk was cut short, not that the board ended. The
          // pages already collected are kept (a mid-scan failure keeps
          // partials); the warning keeps the truncation from passing as a
          // complete board.
          const count = parseResultCount(html);
          if (count !== null && page * ITEMS_PER_PAGE < count) {
            console.warn(`deutschebahn: ${entry.name}: page ${page} came back empty with ${count} postings reported — keeping the ${jobs.length} collected so far`);
          }
        }
        break; // past the last page
      }

      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        jobs.push({ title: row.title, url: row.url, company: entry.name, location: row.location });
      }
      if (jobs.length >= MAX_JOBS) {
        stopReason = 'max-jobs';
        break;
      }
      // The stop reads the hit count the source returned, never the parsed or
      // post-dedup count: tie-order drift can make a full page repeat earlier
      // hits while later pages still hold unseen postings.
      if (countHitAnchors(html) < ITEMS_PER_PAGE) {
        stopReason = 'complete'; // short page: the board ended
        break;
      }
    }
    // max_pages ran out on a full page: warn so a truncated board doesn't
    // pass as complete, unless the reported total shows the walk already
    // covered the whole board.
    if (stopReason === 'cap') {
      const count = parseResultCount(lastHtml);
      if (count === null || maxPages * ITEMS_PER_PAGE < count) {
        console.warn(`deutschebahn: ${entry.name}: stopped at ${maxPages} pages (${jobs.length} postings); raise max_pages on this entry`);
      }
    }
    return jobs.slice(0, MAX_JOBS);
  },
};
