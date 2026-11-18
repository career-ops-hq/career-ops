// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { coerceId } from './_ids.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

// Google provider — Google Careers is server-rendered, so the results page HTML
// contains every job link:
//   GET https://www.google.com/about/careers/applications/jobs/results/?q=<kw>&location=United%20States&sort_by=date
//   -> HTML with one card per posting, closed by <a href="jobs/results/{id}-{slug}">
// No JSON API and no XHR (data is in the document), so we run phrase queries and
// let scan.mjs's title filter cut.
//
// Each card carries the posting's real title (<h3>) and an "Employer | location;
// location; +2 more" line. The EMPLOYER is not always Google: the same results
// list YouTube, DeepMind and other Alphabet companies' postings, so the card's
// employer is the company, not the portals.yml entry name (CodeRabbit, #4078).
// A card without that markup falls back to the entry name, the link's
// aria-label or slug for the title, and a blank location.
//
// PAGINATION. The results are paged with a 1-based `page` query parameter
// (omitted on page 1), 20 cards per full page, newest first under
// `sort_by=date`. Until 2026-11-08 this provider read only the first page,
// because `google.com/robots.txt` disallows the `page=` results URLs; rule 6 of
// the Source Indexing Policy stopped treating robots.txt as a gate (#6691,
// #6694), so the walk now continues page by page. A query ends on the first
// empty page, a page that repeats one already seen in the same walk, or a short
// page (fewer than a full page of cards), and is otherwise bounded by
// `max_pages` per query (default DEFAULT_MAX_PAGES, hard ceiling MAX_PAGES_CAP).
//
// Config (portals.yml):
//   provider: google
//   google:
//     location: "United States"      # optional
//     queries: ["business strategy", "business operations", ...]
//   max_pages: 10                     # optional, per query
//
// FULL BOARD (opt-in, `google: { full_board: true }`). The query walk reads
// only what the queries match, and nothing reports the titles it never
// matched (#7315). Google publishes every open posting in one jobs sitemap:
//   GET https://www.google.com/about/careers/applications/jobs/sitemap.xml
//   -> one <loc> per posting, .../jobs/results/{id}-{slug}/  (3,240 on 2026-11-18)
// so full_board lists the whole board from it in one request. A <loc> carries
// only the id and a title slug; the real title, employer and locations come
// from the posting page's `ds:0` data blob, fetched only for postings the
// scan's title filter keeps (ctx.titleWanted), paced and retried, up to
// `detail_limit` (default DEFAULT_DETAIL_LIMIT, cap DETAIL_LIMIT_CAP). A row
// past the limit keeps its slug title and no location, and the board is
// marked partial ('detail-cap'). `queries` and `location` are not used.
//   google:
//     full_board: true
//     detail_limit: 200               # optional

const BASE = 'https://www.google.com/about/careers/applications/jobs/results/';
// A full results page carries 20 cards; a shorter page is the last one for that
// query. Observed live 2026-11-08.
const PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 10; // 200 postings per query
const MAX_PAGES_CAP = 50; // hard ceiling even for a max_pages override
const INTER_PAGE_DELAY_MS = 400;
// The anchor that closes each card; the markup since the previous anchor is that
// card. Google serves the href relative ("jobs/results/…"); a path prefix is
// tolerated, and the URL is rebuilt from BASE either way.
const ANCHOR_RE = /<a\b[^>]*?\bhref="(?:[^"]*\/)?jobs\/results\/(\d+)-([a-z0-9-]+)[^"]*"[^>]*>/g;
const H3_RE = /<h3\b[^>]*>([^<]+)<\/h3>/g;
const EMPLOYER_LINE_RE = /<p class="l103df">([\s\S]*?)<\/p>/g;
const ARIA_TITLE_RE = /\baria-label="Learn more about ([^"]+)"/;
// "+2 more" is Google collapsing the rest of the list, not a place.
const MORE_RE = /^\+\d+ more$/;
const DEFAULT_QUERIES = [
  'business strategy', 'business operations', 'strategy and operations',
  'corporate development', 'financial planning',
];

function getConfig(entry) {
  const c = entry.google || {};
  const queries = Array.isArray(c.queries) && c.queries.length ? c.queries : DEFAULT_QUERIES;
  return { location: c.location || 'United States', queries };
}

/** @param {any} entry @returns {number} */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

function titleFromSlug(slug) {
  return slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Card text goes through the shared pipeline, never a local strip-then-decode:
// stripping tags before decoding lets "&lt;script&gt;" come back out as a live
// "<script>" (CodeQL js/incomplete-multi-character-sanitization on #4078).
const text = (/** @type {string} */ s) => htmlToText(s);

/** Last match of a global regex in `s`, or null. */
function lastMatch(/** @type {RegExp} */ re, /** @type {string} */ s) {
  let last = null;
  for (const m of s.matchAll(re)) last = m;
  return last;
}

/**
 * Parse one results page into its cards.
 *
 * @param {string} html
 * @returns {{id: string, slug: string, title: string, employer: string, locations: string[]}[]}
 */
export function parseResultsPage(html) {
  const cards = [];
  let prevEnd = 0;
  for (const a of String(html).matchAll(ANCHOR_RE)) {
    const [tag, id, slug] = a;
    const card = html.slice(prevEnd, a.index);
    prevEnd = /** @type {number} */ (a.index) + tag.length;
    const h3 = lastMatch(H3_RE, card);
    const aria = tag.match(ARIA_TITLE_RE);
    const title = (h3 && text(h3[1])) || (aria && text(aria[1])) || titleFromSlug(slug);
    const line = lastMatch(EMPLOYER_LINE_RE, card);
    let employer = '';
    let locations = [];
    if (line) {
      const sep = line[1].indexOf('|');
      if (sep !== -1) {
        employer = text(line[1].slice(0, sep));
        locations = text(line[1].slice(sep + 1)).split(';').map((l) => l.trim()).filter((l) => l && !MORE_RE.test(l));
      }
    }
    cards.push({ id, slug, title, employer, locations });
  }
  return cards;
}

// ── Full board (google.full_board) ──────────────────────────────────────────
const SITEMAP_URL = 'https://www.google.com/about/careers/applications/jobs/sitemap.xml';
// A <loc> names the posting under careers.google.com or the google.com path;
// either way the URL is rebuilt from BASE.
const SITEMAP_LOC_RE = /<loc>\s*https:\/\/(?:careers\.google\.com|www\.google\.com\/about\/careers\/applications)\/jobs\/results\/(\d+)-([a-z0-9-]+)\/?\s*<\/loc>/g;
const DEFAULT_DETAIL_LIMIT = 200;
const DETAIL_LIMIT_CAP = 1000;
const DETAIL_DELAY_MS = 500;
const DS0_MARKER = "AF_initDataCallback({key: 'ds:0'";

/** @param {any} entry @returns {number} */
export function resolveDetailLimit(entry) {
  const v = entry?.google?.detail_limit;
  if (Number.isInteger(v) && v > 0) return Math.min(v, DETAIL_LIMIT_CAP);
  return DEFAULT_DETAIL_LIMIT;
}

/**
 * Every posting the jobs sitemap lists, first occurrence of each id.
 * Exported for tests.
 * @param {string} xml
 * @returns {{id: string, slug: string}[]}
 */
export function parseJobsSitemap(xml) {
  const out = new Map();
  for (const m of String(xml).matchAll(SITEMAP_LOC_RE)) if (!out.has(m[1])) out.set(m[1], m[2]);
  return [...out].map(([id, slug]) => ({ id, slug }));
}

/**
 * The JSON array that follows `data:` at `start`, read string-aware so a `]`
 * inside a description does not end it early. Returns null when unbalanced.
 * @param {string} s
 * @param {number} start index of the opening `[`
 */
function balancedArray(s, start) {
  if (s[start] !== '[') return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/**
 * Title, employer and locations of posting `id` from its page's `ds:0` blob,
 * or null when the blob is missing, malformed, or describes another posting.
 * The record is positional: [0] id, [1] title, [7] employer, [9] a list of
 * locations whose first element is the display string. Exported for tests.
 * @param {string} html
 * @param {string} id
 * @returns {{title: string, employer: string, locations: string[]} | null}
 */
export function parsePostingBlob(html, id) {
  const page = String(html);
  const at = page.indexOf(DS0_MARKER);
  if (at === -1) return null;
  const dataAt = page.indexOf('data:', at);
  if (dataAt === -1) return null;
  const raw = balancedArray(page, dataAt + 5);
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  const rec = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : null;
  if (!rec || String(rec[0]) !== id || typeof rec[1] !== 'string' || !rec[1].trim()) return null;
  const employer = typeof rec[7] === 'string' ? rec[7].trim() : '';
  const locations = Array.isArray(rec[9])
    ? [...new Set(rec[9].map((l) => (Array.isArray(l) && typeof l[0] === 'string' ? l[0].trim() : '')).filter(Boolean))]
    : [];
  return { title: rec[1].trim(), employer, locations };
}

/**
 * The whole board from the jobs sitemap, with posting-page detail for the
 * postings the scan keeps.
 * @param {any} entry
 * @param {any} ctx
 */
async function fetchFullBoard(entry, ctx) {
  const probing = Number(ctx?.maxPages) > 0;
  // A probe's rejection propagates unwrapped; a scan's does too, since a board
  // with no sitemap has nothing to keep.
  const xml = await fetchTextWithRetry(ctx, SITEMAP_URL, { redirect: 'error' });
  const rows = parseJobsSitemap(xml);
  if (rows.length === 0) {
    const kind = /<urlset\b/.test(String(xml)) ? 'a sitemap with no posting <loc>' : `${typeof xml} without a <urlset>`;
    throw new Error(`google: ${SITEMAP_URL} listed no postings (got ${kind}) — the sitemap format changed`);
  }
  const wanted = !probing && typeof ctx?.titleWanted === 'function' ? ctx.titleWanted : null;
  const limit = resolveDetailLimit(entry);
  /** @type {import('./_types.js').Job[]} */
  const jobs = [];
  let wantedCount = 0;
  let detailed = 0;
  let requests = 0;
  for (const { id, slug } of rows) {
    const job = {
      title: titleFromSlug(slug),
      url: `${BASE}${id}-${slug}`,
      company: entry.name,
      location: '',
      ...(coerceId(id) ? { externalId: /** @type {string} */ (coerceId(id)) } : {}),
    };
    if (wanted && wanted(job.title)) {
      wantedCount++;
      if (requests < limit) {
        if (requests > 0) await sleep(DETAIL_DELAY_MS, ctx);
        requests++;
        try {
          const d = parsePostingBlob(await fetchTextWithRetry(ctx, job.url, { redirect: 'error' }), id);
          if (d) {
            job.title = d.title;
            if (d.employer) job.company = d.employer;
            job.location = d.locations.join('; ');
            detailed++;
          }
        } catch (err) {
          // Enrichment is never fatal to the board: the sitemap row stays.
          console.error(`⚠️  google: ${entry.name} could not read posting ${id} (${err instanceof Error ? err.message : String(err)}); kept from the sitemap`);
        }
      }
    }
    jobs.push(job);
  }
  if (wantedCount > limit) {
    console.error(`⚠️  google: ${entry.name} read ${limit} of ${wantedCount} title-matched postings (detail_limit) — the rest keep their sitemap title and no location; raise google.detail_limit for more (up to ${DETAIL_LIMIT_CAP})`);
    markTruncated(jobs, 'detail-cap', { fetched: detailed, total: wantedCount });
  }
  return jobs;
}

/** @type {Provider} */

export default {
  id: 'google',

  detect(entry) {
    return entry.google ? { url: BASE } : null;
  },

  async fetch(entry, ctx) {
    if (entry?.google?.full_board === true) return fetchFullBoard(entry, ctx);
    const { location, queries } = getConfig(entry);
    // `ctx.maxPages` means verify-portals is probing, not scanning: walk one
    // query and one page, so a liveness check costs one request instead of
    // queries x pages (providers/ADDING_A_PROVIDER.md).
    const ctxMaxPages = Number(/** @type {any} */ (ctx)?.maxPages);
    const probing = ctxMaxPages > 0;
    const entryMaxPages = resolveMaxPages(entry);
    const maxPages = probing ? Math.min(entryMaxPages, ctxMaxPages) : entryMaxPages;
    const queriesToRun = probing ? queries.slice(0, 1) : queries;

    const byId = new Map();
    let requestsMade = 0;
    let truncated = false;
    let fetchFailed = false;
    let firstPageFailures = 0;
    let firstPageError;

    for (const q of queriesToRun) {
      // IDs seen in THIS query's walk: a page that adds none is Google
      // re-serving an earlier page past the end, so the walk for this query
      // stops — but a later query whose first page overlaps an earlier query
      // still walks its own deeper pages (ADDING_A_PROVIDER.md).
      const seenThisQuery = new Set();
      for (let page = 1; page <= maxPages; page++) {
        // URLSearchParams, not hand-built encodeURIComponent: q and location come from
        // portals.yml, and URLSearchParams never throws on a malformed string.
        const params = new URLSearchParams({ q: String(q), location: String(location), sort_by: 'date' });
        if (page > 1) params.set('page', String(page));
        const url = `${BASE}?${params}`;
        if (requestsMade > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
        let html;
        try {
          html = await fetchTextWithRetry(ctx, url, { redirect: 'error' });
        } catch (err) {
          // While probing, a rejection propagates unwrapped (verify-portals needs it).
          // Track page-1 failures across all queries: if every query fails on page 1,
          // throw the first error (a total outage). Otherwise, keep the jobs collected
          // from successful queries, warn, and move to the next query.
          if (probing) throw err;
          fetchFailed = true;
          if (page === 1) {
            if (firstPageFailures === 0) firstPageError = err;
            firstPageFailures += 1;
          }
          const cause = err instanceof Error ? err.message : String(err);
          console.error(`⚠️  google: ${entry.name} stopped "${q}" at page ${page} (${byId.size} jobs so far): ${cause}`);
          break;
        }
        requestsMade += 1;
        const cards = parseResultsPage(html);
        let newThisQuery = 0;
        for (const { id, slug, title, employer, locations } of cards) {
          if (!seenThisQuery.has(id)) { seenThisQuery.add(id); newThisQuery += 1; }
          if (byId.has(id)) continue;
          byId.set(id, {
            title,
            url: `${BASE}${id}-${slug}`,
            company: employer || entry.name,
            location: locations.join('; '),
            ...(coerceId(id) ? { externalId: /** @type {string} */ (coerceId(id)) } : {}),
          });
        }
        // Stop at this query's last page: empty, re-served (no new ids), or
        // short (a full page is PAGE_SIZE cards).
        if (cards.length === 0 || newThisQuery === 0 || cards.length < PAGE_SIZE) break;
        if (page === maxPages && !probing) truncated = true;
      }
    }
    if (firstPageFailures === queriesToRun.length && firstPageError) {
      throw firstPageError;
    }
    let jobs = [...byId.values()];
    if (truncated) {
      console.error(`⚠️  google: ${entry.name} hit the ${maxPages}-page cap on at least one query — raise max_pages on this entry for more`);
      jobs = markTruncated(jobs, 'page-cap', { fetched: jobs.length });
    }
    if (fetchFailed) {
      jobs = markTruncated(jobs, 'fetch-error', { fetched: jobs.length });
    }
    return jobs;
  },
};
