// @ts-check
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { coerceId } from './_ids.mjs';
import { workplaceField } from './_workplace-type.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { markTruncated } from '../lib/board-truncation.mjs';

/** @typedef {import('./_types.js').Provider} Provider */

// a16z speedrun talent network provider — board-wide aggregator feed (a16z
// speedrun + wider a16z portfolio startups, ~200 companies):
// https://speedrun-talent-network.com/api/v1/jobs (public, zero-auth; OpenAPI
// at /api/v1/openapi.json, human docs at /developers).
// Response shape: { jobs: [ { id, title, company, url, location, remote,
//   published_at, ... } ], total, page, page_size, total_pages, facets }
//
// Paginated 50/page via `?page=N` (0-indexed); the response carries
// `total_pages`, so iteration is bounded by min(total_pages, max_pages).
// Page budgets are sized in 50-job pages — see DEFAULT_MAX_PAGES and
// MAX_PAGES_CAP below. Either raise `max_pages` on the entry or narrow
// server-side with `q:` (the feed runs full-text search with synonym
// expansion, e.g. "ml", "swe", "nyc").
//
// Optional feed filters, passed through to the same query (documented
// parameters only; see FILTER_PARAMS below for each name and its values):
//
//   a16z_speedrun_talent:
//     filters: { scope: everywhere, fn: engineering, wp: remote, sen: [senior, staff, _], posted: 7d }
//
// The list has no apply link and no description. Optional detail reads add
// both, from /api/v1/jobs/<id>: `apply.url` (for an `external` apply, the
// employer's own posting) replaces the job's url, and `description_text`
// becomes `description`. Off by default, like the other providers' extra
// per-job requests (smartrecruiters, vdab):
//
//   a16z_speedrun_talent:
//     fetchDetails: true   # one detail request per job, in batches of 5
//     detailLimit: 25      # max detail requests per scan (default 25, max 100)
//
// Detail reads are skipped while verify-portals probes (ctx.maxPages is set).
//
// Every request carries `source=career-ops` — the feed's documented optional
// attribution param, echoed in the response; it does not change results.
//
// Wire in via a `job_boards:` entry with `provider: a16z-speedrun-talent`, or point
// `careers_url` at https://speedrun-talent-network.com (auto-detected).

const FEED_BASE = 'https://speedrun-talent-network.com/api/v1/jobs';
const TRUSTED_HOST = 'speedrun-talent-network.com';
const PER_PAGE = 50;
const DEFAULT_MAX_PAGES = 6; // × PER_PAGE = the 300-job default scan
// Runaway bound, not a coverage target: iteration already stops at the
// feed's reported total_pages (or, when the feed omits it, a short page), so
// on an honest feed the cap costs nothing and full-board sweeps keep working
// as the board grows.
// It only bites a misbehaving feed or an absurd max_pages entry — so it
// sits well above plausible board size (~353 pages / ~17.6k jobs as of
// 2026-08), same policy as workday.mjs's cap.
const MAX_PAGES_CAP = 1000;
const DETAIL_BATCH = 5;
// Pause between detail batches, so a long read does not hit the feed in a burst.
const INTER_BATCH_DELAY_MS = 250;
const DEFAULT_DETAIL_LIMIT = 25;
const MAX_DETAIL_LIMIT = 100;

// The feed's documented filter parameters (/api/v1/openapi.json, searchJobs),
// minus `q`, `page` and `source`, which this provider sets itself. An unknown
// name throws, so a typo does not read the whole board unfiltered.
//   list: comma-separated values, given as a string or an array of strings
//   flag: the feed takes only `1`; true or 1 on the entry sends it
//   int:  a non-negative integer
//   enum: one of the listed values
const LIST_FILTERS = new Set([
  'fn', 'spec', 'sen', 'lvl', 'yoe', 'eng', 'emp', 'loc', 'wp', 'metro', 'stage', 'size', 'industry', 'portfolio',
  'cohort',
]);
const FLAG_FILTERS = new Set(['founding', 'ai', 'remote', 'comp_any', 'lab', 'bigtech']);
const INT_FILTERS = new Set(['comp', 'comp_max']);
const ENUM_FILTERS = /** @type {Record<string, string[]>} */ ({
  posted: ['24h', '7d', '30d'],
  scope: ['speedrun', 'portfolio', 'everywhere'],
  sort: ['rel', 'new', 'comp'],
  stealth: ['only', 'hide'],
});
// `metro` takes at most 5 keys, per the feed's documentation.
const MAX_METROS = 5;
const SETTINGS = new Set(['filters', 'fetchDetails', 'detailLimit']);

/** @param {string} url */
function assertFeedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`a16z-speedrun-talent: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`a16z-speedrun-talent: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`a16z-speedrun-talent: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** Optional server-side query: `q:` on the entry, else joined `keywords:`. */
function resolveQuery(entry) {
  if (typeof entry?.q === 'string' && entry.q.trim()) return entry.q.trim();
  if (Array.isArray(entry?.keywords) && entry.keywords.length > 0) {
    const joined = entry.keywords.filter((k) => typeof k === 'string' && k.trim()).join(' ').trim();
    if (joined) return joined;
  }
  return null;
}

/**
 * The entry's `a16z_speedrun_talent` settings, or an empty object.
 * @param {any} entry
 * @returns {Record<string, any>}
 */
function resolveSettings(entry) {
  const cfg = entry?.a16z_speedrun_talent;
  if (cfg == null) return {};
  const name = entry?.name || 'a16z speedrun talent network';
  if (typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error(`a16z-speedrun-talent: ${name} — a16z_speedrun_talent must be a map of settings`);
  }
  const unknown = Object.keys(cfg).find((key) => !SETTINGS.has(key));
  if (unknown) throw new Error(`a16z-speedrun-talent: ${name} — unknown setting "${unknown}" (use filters, fetchDetails or detailLimit)`);
  return cfg;
}

/**
 * The feed filters of the entry as [name, value] pairs, validated against the
 * documented parameters. Throws on an unknown name or an invalid value.
 * @param {any} entry
 * @returns {Array<[string, string]>}
 */
function resolveFilters(entry) {
  const filters = resolveSettings(entry).filters;
  if (filters == null) return [];
  const name = typeof entry?.name === 'string' && entry.name ? entry.name : 'a16z speedrun talent network';
  const bad = (key, why) => new Error(`a16z-speedrun-talent: ${name} — filters.${key} ${why}`);
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw new Error(`a16z-speedrun-talent: ${name} — filters must be a map of feed parameters`);
  }
  /** @type {Array<[string, string]>} */
  const pairs = [];
  for (const [key, raw] of Object.entries(filters)) {
    if (raw == null || raw === '') continue;
    if (LIST_FILTERS.has(key)) {
      if (!Array.isArray(raw) && typeof raw !== 'string') throw bad(key, 'must be a string or a list of strings');
      const items = Array.isArray(raw) ? raw : raw.split(',');
      if (items.some((v) => typeof v !== 'string')) throw bad(key, 'must be a string or a list of strings');
      const values = items.map((v) => v.trim()).filter(Boolean);
      // `loc` takes city names ("San Francisco", "O'Fallon"): letters, marks,
      // digits, spaces, periods, apostrophes and hyphens; no commas or controls.
      const plain = key === 'loc' ? /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'-]*$/u : /^[A-Za-z0-9_.-]+$/;
      if (!values.length || values.some((v) => !plain.test(v))) throw bad(key, 'must be a string or a list of plain values');
      if (key === 'metro' && values.length > MAX_METROS) throw bad(key, `takes at most ${MAX_METROS} values`);
      pairs.push([key, values.join(',')]);
    } else if (FLAG_FILTERS.has(key)) {
      if (raw === false || raw === 0 || raw === '0') continue;
      if (raw !== true && raw !== 1 && raw !== '1') throw bad(key, 'must be true');
      pairs.push([key, '1']);
    } else if (INT_FILTERS.has(key)) {
      if (!Number.isInteger(raw) || raw < 0) throw bad(key, 'must be a non-negative integer');
      pairs.push([key, String(raw)]);
    } else if (Object.hasOwn(ENUM_FILTERS, key)) {
      if (typeof raw !== 'string' || !ENUM_FILTERS[key].includes(raw.trim())) throw bad(key, `must be one of ${ENUM_FILTERS[key].join(', ')}`);
      pairs.push([key, raw.trim()]);
    } else if (key === 'company') {
      if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 120) throw bad(key, 'must be a company key string');
      pairs.push([key, raw.trim()]);
    } else {
      throw new Error(`a16z-speedrun-talent: ${name} — unknown filter "${key}" (use a parameter of the feed's searchJobs operation)`);
    }
  }
  return pairs;
}

/**
 * Whether to read each job's detail, and at most how many per scan.
 * @param {any} entry
 * @returns {{ fetchDetails: boolean, detailLimit: number }}
 */
function resolveDetails(entry) {
  const cfg = resolveSettings(entry);
  const name = entry?.name || 'a16z speedrun talent network';
  const { fetchDetails, detailLimit } = cfg;
  if (fetchDetails != null && typeof fetchDetails !== 'boolean') {
    throw new Error(`a16z-speedrun-talent: ${name} — fetchDetails must be true or false`);
  }
  if (detailLimit != null && !(Number.isInteger(detailLimit) && detailLimit > 0)) {
    throw new Error(`a16z-speedrun-talent: ${name} — detailLimit must be a positive integer`);
  }
  return {
    fetchDetails: fetchDetails === true,
    detailLimit: detailLimit != null ? Math.min(detailLimit, MAX_DETAIL_LIMIT) : DEFAULT_DETAIL_LIMIT,
  };
}

/**
 * The employer's own posting from a job detail: its `apply.url` when the apply
 * is `external`, https, and not on speedrun's own host. Null otherwise
 * (`onsite` means the candidate applies on the job page itself).
 * @param {any} detail
 * @returns {string | null}
 */
export function applyUrlOf(detail) {
  const apply = detail?.apply;
  if (apply?.kind !== 'external' || typeof apply.url !== 'string') return null;
  try {
    const parsed = new URL(apply.url.trim());
    const onFeedHost = parsed.hostname === TRUSTED_HOST || parsed.hostname.endsWith(`.${TRUSTED_HOST}`);
    return parsed.protocol === 'https:' && !onFeedHost ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * The pay band of a feed job as a Job salary, or null. Only an annual band
 * counts (`comp_period` is "year", or null, which the feed defines as annual):
 * an hourly or monthly one is not annual, and this provider does not convert it.
 * Bounds must be numbers above 0; a one-sided band fills the other bound, and
 * `posted` keeps the bounds as given. `currency` is the feed's 3-letter code,
 * upper-cased, and absent when the feed gives none.
 * @param {any} j
 */
function salaryOf(j) {
  const period = j.comp_period;
  if (period != null && period !== 'year') return null;
  const bound = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const lo = bound(j.comp_min);
  const hi = bound(j.comp_max);
  if (lo === undefined && hi === undefined) return null;
  const code = typeof j.comp_currency === 'string' ? j.comp_currency.trim().toUpperCase() : '';
  const currency = /^[A-Z]{3}$/.test(code) ? code : '';
  return {
    min: Math.min(lo ?? hi, hi ?? lo),
    max: Math.max(lo ?? hi, hi ?? lo),
    ...(currency ? { currency } : {}),
    period: 'year',
    posted: { ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}) },
  };
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Normalize a single speedrun talent network job. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (postings without one are dropped).
 *   - url:      `url` — the canonical posting page, host-locked to
 *               `speedrun-talent-network.com` (the feed always serves its own
 *               absolute /jobs/... URL). An off-host or non-https URL drops
 *               the posting. url is the dedup key and is display-only here.
 *   - company:  `company`, falling back to the portal entry name, then
 *               "speedrun talent network". Unannounced roles arrive already
 *               masked as "Stealth" by the feed.
 *   - location: `location`; "Remote" is appended when `remote` is true.
 *   - workplaceType: `workplace_type` (Remote, Hybrid, OnSite); omitted when null.
 *   - postedAt: `published_at` ISO date → epoch ms (omitted when absent or
 *               unparseable).
 *   - externalId: `id`, the feed's own posting id (omitted when absent).
 *   - salary:   `comp_min` / `comp_max` / `comp_currency` for an annual band
 *               (see salaryOf; omitted when the feed gives no annual numbers).
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, workplaceType?: 'remote' | 'hybrid' | 'onsite', postedAt?: number, externalId?: string, salary?: object } | null}
 */
export function normalizeSpeedrunJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null;

  let url = '';
  const rawUrl = typeof j.url === 'string' ? j.url.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_HOST) url = parsed.href;
    } catch {
      // malformed URL → leave url = '' → dropped below
    }
  }
  if (!url) return null;

  const company =
    typeof j.company === 'string' && j.company.trim()
      ? j.company.trim()
      : typeof fallbackCompany === 'string' && fallbackCompany.trim()
        ? fallbackCompany.trim()
        : 'a16z speedrun talent network';

  const base = typeof j.location === 'string' ? j.location.trim() : '';
  const location = [base, j.remote === true ? 'Remote' : ''].filter(Boolean).join(', ');

  /** @type {{ title: string, url: string, company: string, location: string, workplaceType?: 'remote' | 'hybrid' | 'onsite', postedAt?: number, externalId?: string, salary?: object }} */
  const job = { title, url, company, location };
  // `workplace_type` is "Remote", "Hybrid", "OnSite" or "Onsite", and null when
  // the poster gave none.
  Object.assign(job, workplaceField(j.workplace_type));
  const postedAt = toEpochMs(j.published_at);
  if (postedAt !== undefined) job.postedAt = postedAt;
  const externalId = coerceId(j.id);
  if (externalId) job.externalId = externalId;
  const salary = salaryOf(j);
  if (salary) job.salary = salary;
  return job;
}

/**
 * Reads the detail of the first `limit` jobs, five at a time, and sets
 * `description` (from `description_text`) and, for an external apply, `url` to
 * the employer's own posting. A detail that fails keeps the job as the list
 * gave it; the failures are counted in one warning.
 * @param {Array<any>} jobs
 * @param {number} limit
 * @param {any} ctx
 * @param {string} [name]
 */
async function enrichFromDetails(jobs, limit, ctx, name) {
  // A job whose id cannot be encoded (a lone surrogate) keeps the list's fields.
  const due = jobs.filter((job) => job.externalId && safeEncodeURIComponent(job.externalId) !== null).slice(0, limit);
  let failed = 0;
  for (let i = 0; i < due.length; i += DETAIL_BATCH) {
    if (i > 0) await sleep(INTER_BATCH_DELAY_MS, ctx);
    await Promise.all(due.slice(i, i + DETAIL_BATCH).map(async (job) => {
      try {
        const url = `${FEED_BASE}/${safeEncodeURIComponent(job.externalId)}?${new URLSearchParams({ source: 'career-ops' })}`;
        const json = await fetchJsonWithRetry(ctx, assertFeedUrl(url), { redirect: 'error' });
        const detail = json?.job;
        if (!detail || typeof detail !== 'object' || detail.status === 'closed') return;
        const text = typeof detail.description_text === 'string' ? detail.description_text.trim() : '';
        if (text) job.description = text;
        const apply = applyUrlOf(detail);
        if (apply) job.url = apply;
      } catch {
        failed++;
      }
    }));
  }
  if (failed) {
    const label = typeof name === 'string' && name ? name : 'a16z speedrun talent network';
    console.error(`⚠️  a16z-speedrun-talent: ${label} — ${failed} of ${due.length} job details not read; those jobs keep the list's fields`);
  }
}

/** @type {Provider} */
export default {
  id: 'a16z-speedrun-talent',

  detect(entry) {
    for (const candidate of [entry?.careers_url, entry?.api]) {
      if (typeof candidate !== 'string' || !candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_HOST) {
          return { url: candidate };
        }
      } catch {
        // not a URL → not ours
      }
    }
    return null;
  },

  async fetch(entry, ctx) {
    assertFeedUrl(FEED_BASE);
    const maxPages = resolveMaxPages(entry);
    // verify-portals' and audit-portals' health probe sets ctx.maxPages (1): it
    // only needs to know the feed is live, so it reads that many pages and is
    // never warned about or marked as a max_pages cut. Kept apart from
    // maxPages, which a probe on a max_pages: 1 entry would equal (#7180).
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pagesToFetch = probing ? Math.min(maxPages, ctx.maxPages) : maxPages;
    const q = resolveQuery(entry);
    const filters = resolveFilters(entry);
    // read before any request, so a bad detail setting fails the scan up front
    const { fetchDetails, detailLimit } = resolveDetails(entry);
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 0; page < pagesToFetch; page++) {
      const params = new URLSearchParams({ page: String(page), source: 'career-ops' });
      if (q) params.set('q', q);
      for (const [key, value] of filters) params.set(key, value);
      const url = `${FEED_BASE}?${params}`;
      // redirect:'error' prevents SSRF via server-side redirects.
      // Retried on transient upstream failures (429/5xx/timeout): this board
      // paginates into the hundreds of pages, so a single blip mid-sweep used
      // to abort the whole provider and return NOTHING. Retries are bounded
      // and, once exhausted, the error still propagates — a silent partial
      // board would be worse than an loud empty one (#2506).
      const json = await fetchJsonWithRetry(ctx, url, { redirect: 'error' });
      if (!json || !Array.isArray(json.jobs)) {
        throw new Error(
          `a16z-speedrun-talent: unexpected API response on page ${page} — expected { jobs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const j of json.jobs) {
        const normalized = normalizeSpeedrunJob(j, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      // Stop at the last page. Termination priority (#2547):
      //   1. An empty page always ends iteration — nothing left to read, and
      //      it bounds a feed that over-reports total_pages instead of burning
      //      requests up to max_pages.
      //   2. The feed's own total_pages when present. A page that comes back
      //      49/50 because a listing was deleted between requests on a board
      //      that rotates mid-sweep is NOT the last page; treating it as one
      //      ended the sweep silently, at a clean exit code — the cap warning
      //      below is gated on max_pages and is never reached from here.
      //      A non-positive total_pages is not a statement about board size,
      //      so it counts as absent: a feed reporting 0 alongside 50 real
      //      rows contradicts itself, and the rows win. Trusting them can
      //      only cost requests (bounded by rule 1 and max_pages), never jobs.
      //   3. A short page, only as the fallback for feeds whose total_pages is
      //      absent or non-positive. Demoting it (rather than merely
      //      reordering the two checks) is what fixes #2547: a 49-row page
      //      fails the total_pages test and would still break out on the
      //      next line.
      if (json.jobs.length === 0) break;
      if (Number.isInteger(json.total_pages) && json.total_pages > 0) {
        if (page + 1 >= json.total_pages) break;
      } else if (json.jobs.length < PER_PAGE) {
        break;
      }
      // Cap warning (same pattern as jibeapply/workday): the feed had more
      // pages than we were allowed to read — surface it, with the fix.
      if (!probing && page + 1 >= maxPages && Number.isInteger(json.total_pages) && json.total_pages > maxPages) {
        const name = typeof fallbackCompany === 'string' && fallbackCompany ? fallbackCompany : 'a16z speedrun talent network';
        console.error(
          `⚠️  a16z-speedrun-talent: ${name} truncated at max_pages=${maxPages} (${out.length} of ${Number.isInteger(json.total) ? json.total : 'many'} jobs) — raise max_pages on this entry or narrow with q: for more`,
        );
        // The same cut marks the result, so scan.mjs logs the board partial
        // instead of reachable (lib/board-truncation.mjs).
        markTruncated(out, 'page-cap', { fetched: out.length });
      }
    }

    // Detail enrichment answers "what does this job say", not "is this feed
    // alive": skipped while probing, like smartrecruiters and vdab.
    if (fetchDetails && !probing) await enrichFromDetails(out, detailLimit, ctx, fallbackCompany);
    return out;
  },
};
