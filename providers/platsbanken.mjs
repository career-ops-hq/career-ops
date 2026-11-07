// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Platsbanken (Sweden) provider — Arbetsförmedlingen's national job board,
// read through the JobTech Dev JobSearch API. A national public employment
// service, same class as arbeitsagentur.mjs (Germany) and jobbankca.mjs
// (Canada): a high-volume public source no commercial aggregator covers well
// (#230). Wire in via a `job_boards` entry with `provider: platsbanken` and a
// `platsbanken:` block:
//
//   - name: Platsbanken — Backend
//     provider: platsbanken
//     platsbanken:
//       # keywords optional: falls back to config/profile.yml's target_roles
//       # (primary[] + archetypes[].name) when omitted, same as vdab.mjs.
//       keywords: ["backend developer", "systemutvecklare"]
//     enabled: true
//
// PUBLIC FEED, NO AUTH. SEARCH_URL below was fetched with a plain `curl` and
// no key, cookie or session on 2026-10-12 and answered `200` with the search
// JSON. JobTech Dev is Arbetsförmedlingen's own developer portal, and this
// endpoint is the documented read side of Platsbanken.
//
// robots.txt. `https://jobsearch.api.jobtechdev.se/robots.txt` answered 404
// (fetched 2026-10-12) — a pure API host publishing no crawl rules. The
// posting pages this provider links to live on arbetsformedlingen.se and are
// never fetched here; only the API is read. INTER_PAGE_DELAY_MS below is
// self-imposed pacing to a public service rather than a published
// `Crawl-delay`, and applies between pages past the first.
//
// WHY KEYWORD-SCOPED RATHER THAN ENUMERATED. Measured 2026-10-12: the
// unfiltered board reports `total.value` 39,433 ads, but the source caps
// `offset` at 2000 — `offset=2000` still answers 100 hits, `offset=2100`
// answers 0 with no error. A walk of this source can therefore never exceed
// 2,100 rows, about 5% of the board, and the remainder is unreachable by
// paging. Presenting that capped window as "the board" would be exactly the
// partial-coverage-reads-as-complete failure Source Indexing Policy rule 3
// targets, so this provider does not attempt enumeration at all: it runs one
// query per keyword, and each keyword gets its own 2,100-row window. That is
// the same recall-first shape arbeitsagentur.mjs (nationwide pass) and
// jobbankca.mjs already ship for sources whose full inventory is not
// reachable in one sweep. The ceiling is surfaced, not hidden — see
// `warnTruncated` below.
//
// MEASURED PAYLOAD (2026-10-12, a 100-row sample of the live feed):
//   id / headline / webpage_url / publication_date / application_deadline /
//   employer.name / description.text        100/100 non-empty
//   workplace_address.municipality           97/100
//   workplace_address.city                   93/100
//   source_type: VIA_JOBPOSTING (92), VIA_ANNONSERA (8)
//   webpage_url host: arbetsformedlingen.se 100/100
//
// `source_type` is Platsbanken's own intake channel (its JobPosting API and
// its self-service posting form), not syndication from another board, so rule
// 5 is satisfied. Because `webpage_url` was `https://arbetsformedlingen.se/
// platsbanken/annonser/{id}` in every sampled row, this provider rebuilds that
// URL from `id` against a fixed literal host rather than trusting the payload
// field — the tighter trust boundary ADDING_A_PROVIDER.md prefers, and it
// leaves nothing for an allowlist to guard.
//
// `description.text` ships in the list payload at no extra per-posting
// request, so it is populated here; the scanner is zero-token and this costs
// nothing. There is no employer requisition id and no ad-level language field
// in the payload (`external_id` / `original_id` were null throughout), so
// `requisitionId` and `language` are left unset rather than guessed.

import { fetchJsonWithRetry, BROWSER_LIKE_USER_AGENT, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

const SEARCH_URL = 'https://jobsearch.api.jobtechdev.se/search';

/** Posting permalink base. Fixed literal host — see the header comment. */
const POSTING_URL_BASE = 'https://arbetsformedlingen.se/platsbanken/annonser/';

/** Measured: `limit=100` is accepted and serves 100 rows while results remain. */
const PAGE_SIZE = 100;

/** Pages per keyword; 5 covers a common keyword (~500 ads) with room to spare. */
const DEFAULT_MAX_PAGES = 5;

/**
 * Hard ceiling on a configured `max_pages`.
 *
 * Not a taste call: the source stops serving at `offset` 2000, so page 21
 * (`offset=2000`) is the last page that returns rows and page 22
 * (`offset=2100`) returns 0 with a plain HTTP 200 — measured 2026-10-12. A
 * larger cap would only buy silent empty requests.
 */
const MAX_PAGES_CAP = 21;

/** Self-imposed pacing between pages past the first. See the header comment. */
const INTER_PAGE_DELAY_MS = 1000;

/**
 * Reads and sanitizes the entry's `platsbanken:` config block.
 * @param {{ platsbanken?: any }} entry
 * @returns {{ keywords: string[] }}
 */
export function parsePlatsbankenConfig(entry) {
  const cfg = (entry && entry.platsbanken) || {};
  const keywords = Array.isArray(cfg.keywords)
    ? cfg.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim())
    : [];
  return { keywords };
}

/**
 * Build the search URL for one keyword and one page.
 *
 * `offset` is the source's own paging parameter (not a page number); page 1 is
 * offset 0. The keyword is `encodeURIComponent`'d once here, outside the row
 * loop, because it is config-derived rather than a response field — a broken
 * value should be a loud config error, not a silent per-posting drop.
 *
 * @param {string} keyword
 * @param {number} page 1-based.
 * @returns {string}
 */
export function buildSearchUrl(keyword, page) {
  const params = new URLSearchParams({
    q: keyword,
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

/**
 * Build a posting permalink from the ad id.
 *
 * The id is a response field, so it goes through `safeEncodeURIComponent`
 * (which returns null rather than throwing on a lone UTF-16 surrogate) and a
 * null drops exactly the one bad posting instead of losing the page.
 *
 * @param {unknown} id
 * @returns {string|null}
 */
export function postingUrl(id) {
  if (id === null || id === undefined) return null;
  const seg = safeEncodeURIComponent(String(id).trim());
  return seg ? `${POSTING_URL_BASE}${seg}` : null;
}

/**
 * NaN-safe date parse. `Date.parse(s) || undefined` would also null a valid
 * epoch 0 (`1970-01-01T00:00:00Z`), so the absent/empty case is guarded before
 * parsing rather than with `!parsed`.
 * @param {unknown} value
 * @returns {number|undefined}
 */
function toEpochMs(value) {
  if (!value || typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * `{place}, {region}, {country}` from whichever parts the ad carries, where
 * place is `city`, else `municipality`. The region and country are kept, not
 * just the most specific part: a bare town ("Västerås") matches no
 * `location_filter` entry for Sweden, so with a non-empty `allow` list every
 * ad from an unlisted town was dropped as out of region. Repeated parts
 * (a city named like its municipality or region) are written once.
 */
function formatLocation(address) {
  if (!address || typeof address !== 'object') return '';
  const text = (field) => (typeof address[field] === 'string' ? address[field].trim() : '');
  const parts = [text('city') || text('municipality'), text('region'), text('country')].filter(Boolean);
  const seen = new Set();
  return parts.filter((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
}

/**
 * Number of raw rows the source returned for this page.
 *
 * Pagination stops on THIS count, never on how many rows survived
 * normalization — a full page carrying one bad row would otherwise end the
 * walk a page early (`jobbankca.mjs` makes the same split).
 * @param {any} json
 * @returns {number}
 */
export function rawHitCount(json) {
  return json && Array.isArray(json.hits) ? json.hits.length : 0;
}

/**
 * Normalize the JobSearch payload. Exported for unit tests.
 *
 * Contract (ADDING_A_PROVIDER.md §2, "Defensive parsing"):
 *   - the documented container present and empty (`hits: []`)  → `[]`
 *   - the envelope not the documented shape (`{}`, `{hits: null}`,
 *     `{hits: {}}`, a bare non-object)                           → descriptive throw
 *   - one malformed row (no id / no headline)                   → skipped
 *
 * @param {any} json
 * @returns {{title: string, url: string, company: string, location: string, description?: string, postedAt?: number, externalId?: string}[]}
 */
export function parsePlatsbankenResponse(json) {
  const rows = json && Array.isArray(json.hits) ? json.hits : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`platsbanken: unexpected response — expected hits[], got: [${got}]`);
  }

  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const title = typeof row.headline === 'string' ? row.headline.trim() : '';
    if (!title) continue;

    const url = postingUrl(row.id);
    if (!url) continue;

    const employer = row.employer && typeof row.employer === 'object' ? row.employer : null;
    const description = row.description && typeof row.description === 'object' ? row.description : null;
    const descriptionText = description && typeof description.text === 'string' ? description.text.trim() : '';
    const postedAt = toEpochMs(row.publication_date);
    const externalId = row.id === null || row.id === undefined ? '' : String(row.id).trim();

    jobs.push({
      title,
      url,
      company: employer && typeof employer.name === 'string' ? employer.name.trim() : '',
      location: formatLocation(row.workplace_address),
      ...(descriptionText ? { description: descriptionText } : {}),
      ...(postedAt === undefined ? {} : { postedAt }),
      ...(externalId ? { externalId } : {}),
    });
  }
  return jobs;
}

/**
 * Pages to walk for one keyword: the entry's own `max_pages`, clamped to
 * MAX_PAGES_CAP, then capped further by a running health probe.
 * @param {{ max_pages?: any }} entry
 * @param {{ maxPages?: any }} ctx
 * @returns {number}
 */
function resolveMaxPages(entry, ctx) {
  const configured = Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
  const probeCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
  return Math.min(configured, probeCap);
}

/**
 * Say out loud that the walk ended on a ceiling rather than on the source's
 * own end, so a partial list is not read as a complete one.
 * @param {string} keyword
 * @param {number} pages
 * @param {number} rows
 * @param {'entry'|'source'} ceiling
 * @param {string} entryName
 */
function warnTruncated(keyword, pages, rows, ceiling, entryName) {
  if (ceiling === 'source') {
    console.error(`⚠️  platsbanken: "${keyword}" hit the source's 2000-offset ceiling at ${rows} rows (${pages} pages) — narrow the keyword for the rest (Platsbanken serves no page past offset 2000)`);
    return;
  }
  console.error(`⚠️  platsbanken: ${entryName} truncated at max_pages=${pages} (${rows} rows for "${keyword}") — raise max_pages on this entry for more`);
}

/** @type {Provider} */
export default {
  id: 'platsbanken',

  detect(entry) {
    return entry?.provider === 'platsbanken' ? { url: SEARCH_URL } : null;
  },

  async fetch(entry, ctx) {
    let { keywords } = parsePlatsbankenConfig(entry);
    // Fall back to config/profile.yml's target_roles when this entry has no
    // platsbanken.keywords[] of its own — same convention vdab.mjs and
    // jobbankca.mjs use, so a user who already onboarded does not have to
    // duplicate their target roles into every keyword-required provider.
    if (!keywords.length) keywords = resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(`platsbanken: entry "${entry?.name || '(unnamed)'}" has no platsbanken.keywords[] and no config/profile.yml target_roles to fall back to`);
    }

    const maxPages = resolveMaxPages(entry, ctx);
    // A running health probe (verify-portals passes maxPages: 1) is asking
    // "is this board alive", not "give me the board": it must not see pacing
    // delays and must not receive truncation advice about a walk it never
    // asked for.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryName = entry?.name || '(unnamed)';

    /** @type {Map<string, any>} */
    const byUrl = new Map();
    const errors = [];
    let succeeded = 0;

    for (const keyword of keywords) {
      let keywordFailed = false;
      // Rows this keyword has yielded so far. The truncation warning reports how
      // much of the results the scan actually collected, so it needs this
      // running total — the last page's own count answers a different question.
      let keywordRows = 0;
      for (let page = 1; page <= maxPages; page++) {
        if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);

        const url = buildSearchUrl(keyword, page);
        let json;
        try {
          json = await fetchJsonWithRetry(ctx, url, {
            headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT },
            redirect: 'error',
          });
        } catch (err) {
          // Under a probe the rejection propagates unwrapped — the caller is
          // classifying THIS failure, and a rewrapped error would hide the
          // status/identity it is reading (`vdab.mjs` behaves the same).
          if (probing) throw err;
          if (page === 1) {
            keywordFailed = true;
            errors.push(`"${keyword}": ${(err && /** @type {Error} */ (err).message) || err}`);
          }
          // A later page failing keeps the pages already collected: recall-first,
          // the same trade arbeitsagentur.mjs and jobbankca.mjs make.
          break;
        }

        const rawCount = rawHitCount(json);
        const pageJobs = parsePlatsbankenResponse(json);
        for (const job of pageJobs) {
          if (!byUrl.has(job.url)) byUrl.set(job.url, job);
        }
        keywordRows += pageJobs.length;

        if (rawCount < PAGE_SIZE) break; // short page — this keyword's own end

        if (page === maxPages && !probing) {
          // Full page at the last page we were allowed: the walk stopped on a
          // ceiling, not on the source. Which ceiling decides which advice is
          // useful — raising max_pages cannot buy a page the source does not
          // serve.
          warnTruncated(
            keyword,
            maxPages,
            keywordRows,
            maxPages >= MAX_PAGES_CAP ? 'source' : 'entry',
            entryName,
          );
        }
      }
      if (!keywordFailed) succeeded++;
    }

    // Total outage = every keyword's first request failed. A keyword that
    // answered with zero rows is not an outage — recall-first, same as
    // arbeitsagentur.mjs.
    if (succeeded === 0 && errors.length) {
      throw new Error(`platsbanken: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...byUrl.values()];
  },
};
