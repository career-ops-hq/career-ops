// @ts-check
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

/** @typedef {import('./_types.js').Provider} Provider */

// Gupy provider: board-wide job_boards: feed over the Brazilian Gupy ATS.
//   https://employability-portal.gupy.io/api/v1/jobs  (public, zero-auth)
// Response shape: { data: [ { name, jobUrl, careerPageName, city, state,
//   country, workplaceType, publishedDate, description,
//   isConfidentialCareerPage, ... } ], pagination: { total, offset, limit } }
//
// Target list: `job_boards:`. Gupy hosts the career pages of thousands of
// Brazilian employers (<tenant>.gupy.io) and exposes one public search across
// all of them. That search is keyed by KEYWORD, not by company, so one entry
// runs one sweep per keyword and the results are merged. The board therefore
// surfaces employers that are not in tracked_companies at all.
//
// Source Indexing Policy (checked 2026-09-28):
//   - Rule 1: postings are the employers' own, published on their Gupy career
//     page, free to read and apply to. Rows flagged isConfidentialCareerPage
//     carry "Confidencial" instead of an employer and are dropped (about 7% of
//     a 100-row sample).
//   - Rule 2: jobUrl is the posting on the employer's own <tenant>.gupy.io
//     career page, the shortest path to the employer the payload offers.
//   - Rule 3: results are ordered publishedDate-descending; the payload
//     carries no sponsored or promoted flag.
//   - Rule 6: employability-portal.gupy.io/robots.txt answers 404 (no rules);
//     portal.gupy.io/robots.txt is `User-agent: *` / `Disallow:` (allow all).
//
// Paginated via offset/limit. limit caps at 100 server-side (limit=200 is a
// 400). Every keyword is swept independently and results are deduped by
// posting URL, since one posting commonly matches several keywords.
//
// `pagination.total` is NOT usable as a stop condition. It reports the page
// size, not the result-set size: at limit=100 it answers 100 at every offset
// however deep the feed goes (measured 2026-08-13: jobName=Desenvolvedor
// returned 370 postings across 4 pages, and every page reported total=100;
// re-checked 2026-09-28). Reading it as a count ends every sweep after page 0.
// A short page is the only end-of-feed signal this API gives.
//
// The endpoint answers the shared default user-agent with no Origin/Referer
// and no sec-ch-ua block, so no browser impersonation is needed.
//
// The feed is ordered publishedDate-descending and that ordering holds ACROSS
// pages (page 0 ends on the same date page 1 opens with), so a recency window
// can stop a sweep early, the workday.mjs pattern. The window comes from
// `ctx.sinceMs` (the run's --since/--posted-after) or, when the run states
// none, from this entry's own `since_days`.
//
// Select with `provider: gupy` on a job_boards: entry, or point `careers_url`
// at https://portal.gupy.io (auto-detected). A company's own
// <tenant>.gupy.io career page is NOT claimed: this provider searches the
// whole platform and would ignore the tenant. Search keys live in a `gupy:`
// block, the vdab/arbeitsagentur/jobbankca shape: `keywords` (falls back to
// config/profile.yml target_roles), `q`, `since_days`, `workplace_types`,
// `job_types`, `state`, `country`. `max_pages` stays on the entry itself, as
// it does for jobbankca and mycareersfuture.
//
// One entry, N independent queries. Three places where this reads the
// provider contract for that shape:
//   - `ctx.maxPages` is a total page budget for the call, counting pages
//     ATTEMPTED, not pages per sweep. Per sweep, a 1-page probe of a
//     10-keyword entry would issue 10 requests.
//   - A failed page ends its own sweep and the others continue (workday's
//     policy). Sweeps 1-6 are complete and correct when sweep 7 dies. During
//     a probe the rejection propagates unwrapped instead.
//   - `max_pages` is per keyword, so the entry's ceiling is
//     max_pages × keywords.length.

const API_BASE = 'https://employability-portal.gupy.io/api/v1/jobs';
const API_HOST = 'employability-portal.gupy.io';
// Hosts whose URL means "the whole Gupy platform", as opposed to one tenant.
const PLATFORM_HOSTS = new Set(['portal.gupy.io', API_HOST]);
const PER_PAGE = 100; // server-side maximum
const DEFAULT_MAX_PAGES = 5; // × PER_PAGE = 500 postings per keyword
// Runaway bound, not a coverage target. Iteration stops on a short page, so on
// an honest feed this costs nothing: a measured 10-keyword sweep needed 13
// requests and no keyword got past page 4.
const MAX_PAGES_CAP = 200;
// Spacing between requests to the same host. No throttling observed; this is
// the contract's default range.
const INTER_REQUEST_DELAY_MS = 200;

// Same margin workday.mjs uses: stop a safe distance PAST the floor so a feed
// that is not perfectly monotonic can never strand an eligible posting on an
// unfetched page. Costs at most one extra page per keyword.
const EARLY_STOP_MARGIN_MS = 2 * 86_400_000;

/** Hosts a Gupy posting URL is allowed to live on. */
function isSafeGupyUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && (host === 'gupy.io' || host.endsWith('.gupy.io'));
  } catch {
    return false;
  }
}

/** @param {string} url */
function assertApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`gupy: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`gupy: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== API_HOST) {
    throw new Error(`gupy: untrusted hostname "${parsed.hostname}"; must be ${API_HOST}`);
  }
  return url;
}

/** Resolve the per-keyword page cap: a positive integer `max_pages`, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** The entry's `gupy:` block, or {} when absent or not a mapping. */
function searchConfig(entry) {
  const cfg = entry?.gupy;
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

/**
 * Keywords to sweep. Gupy's jobName is a narrow title match, so each keyword
 * needs its own sweep; joined into one query the terms AND together and
 * return almost nothing.
 *
 * Falls back to config/profile.yml's target_roles (the vdab.mjs pattern) when
 * the entry declares none.
 */
function resolveKeywords(cfg) {
  if (Array.isArray(cfg.keywords)) {
    const list = cfg.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim());
    if (list.length > 0) return list;
  }
  if (typeof cfg.q === 'string' && cfg.q.trim()) return [cfg.q.trim()];
  return resolveProfileKeywords();
}

/**
 * This entry's own recency window in days, or null when unset.
 *
 * scan.mjs's `max_posting_age_days` is global: a 14-day window for this
 * board-wide sweep would otherwise also narrow every tracked company, or need
 * `--since 14` for the whole run. A per-entry window is what vdab.mjs's
 * `vdab.days` expresses, scoped where it belongs.
 */
function resolveSinceDays(cfg) {
  const v = cfg.since_days;
  return Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * Turn a day count into an absolute floor, truncated to UTC midnight.
 *
 * Truncated on purpose, to match what `--since` means: scan.mjs's
 * resolveEffectiveAfter does the same. An exact `now - days` timestamp would
 * make the same config return different results depending on the hour the
 * scan ran.
 *
 * Returns null for a day count large enough to leave the representable Date
 * range, rather than propagating an Invalid Date into the comparison.
 *
 * @param {number|null} days
 * @param {number} [now] - Injectable clock for tests.
 * @returns {number|null}
 */
export function sinceDaysToCutoffMs(days, now = Date.now()) {
  if (days === null) return null;
  const d = new Date(now - days * 86_400_000);
  if (Number.isNaN(d.getTime())) return null;
  return Date.parse(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
}

/**
 * True once a page's oldest dated posting is past the window.
 *
 * Undated postings are invisible here (the `dated.length === 0` guard), so a
 * page of nothing but undated postings never stops pagination. Mirrors
 * workday.mjs's function of the same name. Exported for the test suite.
 *
 * @param {Array<{postedAt?: number}>} pageJobs
 * @param {number|null} cutoffMs
 */
export function pageIsPastWindow(pageJobs, cutoffMs) {
  if (typeof cutoffMs !== 'number') return false;
  const dated = pageJobs.map((j) => j?.postedAt).filter((v) => typeof v === 'number');
  if (dated.length === 0) return false;
  return Math.min(...dated) < cutoffMs - EARLY_STOP_MARGIN_MS;
}

/** Comma-joined list param, or null when unset. Mirrors the platform's format. */
function listParam(value) {
  if (!Array.isArray(value)) return null;
  const list = value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  return list.length > 0 ? list.join(',') : null;
}

// NaN-safe Date.parse: `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * The documented envelope's `data` array, or a descriptive throw naming what
 * arrived instead. `{ data: [] }` is an empty result, not an error.
 *
 * @param {any} json
 * @param {string} keyword
 * @param {number} page
 * @returns {any[]}
 */
export function extractGupyRows(json, keyword, page) {
  const rows = json && typeof json === 'object' && Array.isArray(json.data) ? json.data : null;
  if (!rows) {
    const got = json && typeof json === 'object' ? `keys: [${Object.keys(json).join(', ')}]` : `type: ${json === null ? 'null' : typeof json}`;
    throw new Error(`gupy: unexpected API response for "${keyword}" page ${page}: expected { data: [...] }, got ${got}`);
  }
  return rows;
}

/**
 * Build the display location from the platform's separate fields.
 *
 * The API exposes `workplaceType` as a SINGULAR string (remote / hybrid /
 * on-site); there is no plural `workplaceTypes` field in the payload. Labels
 * stay in pt-BR to match what the Brazilian postings themselves say and what
 * `location_filter` in portals.yml is written against.
 *
 * @param {any} j
 */
export function buildGupyLocation(j) {
  const parts = [];
  const type = typeof j?.workplaceType === 'string' ? j.workplaceType.trim() : '';
  if (type) {
    parts.push({ remote: 'Remoto', hybrid: 'Híbrido', 'on-site': 'Presencial' }[type] || type);
  } else if (j?.isRemoteWork === true) {
    parts.push('Remoto');
  }
  for (const field of ['city', 'state', 'country']) {
    const v = j?.[field];
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  }
  return parts.join(', ');
}

/**
 * Normalize one raw Gupy API posting. Exported for unit tests.
 *
 * Field mapping to the normalized Job shape:
 *   - title:       `name`, trimmed (postings without one are dropped).
 *   - url:         `jobUrl`, host-locked to HTTPS *.gupy.io (dedup key).
 *   - company:     `careerPageName`, the label the employer's career page
 *                  publishes under.
 *   - location:    workplaceType + city/state/country (see buildGupyLocation).
 *   - description: shipped in the list payload for free, so content_filter and
 *                  the cross-listing fingerprint work without a second request.
 *   - postedAt:    `publishedDate` ISO → epoch ms (omitted when unparseable).
 *
 * A posting flagged `isConfidentialCareerPage`, or with a blank
 * `careerPageName`, names no employer and is dropped (Source Indexing Policy
 * rule 1). scan.mjs copies `company` into the pipeline as-is, so an empty one
 * would reach it unattributed.
 *
 * @param {any} j
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number } | null}
 */
export function normalizeGupyApiJob(j) {
  if (!j || typeof j !== 'object') return null;
  if (j.isConfidentialCareerPage === true) return null;

  const title = typeof j.name === 'string' ? j.name.trim() : '';
  if (!title) return null;

  const rawUrl = typeof j.jobUrl === 'string' ? j.jobUrl.trim() : '';
  if (!isSafeGupyUrl(rawUrl)) return null;

  const company = typeof j.careerPageName === 'string' ? j.careerPageName.trim() : '';
  if (!company) return null;

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number }} */
  const job = {
    title,
    url: rawUrl,
    company,
    location: buildGupyLocation(j),
  };
  if (typeof j.description === 'string' && j.description) job.description = j.description;
  const postedAt = toEpochMs(j.publishedDate);
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/** @type {Provider} */
export default {
  id: 'gupy',

  detect(entry) {
    if (entry?.provider === 'gupy') return { url: API_BASE };
    for (const candidate of [entry?.careers_url, entry?.api]) {
      if (typeof candidate !== 'string' || !candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === 'https:' && PLATFORM_HOSTS.has(parsed.hostname.toLowerCase())) {
          return { url: candidate };
        }
      } catch {
        // not a URL, not ours
      }
    }
    return null;
  },

  async fetch(entry, ctx) {
    assertApiUrl(API_BASE);
    const maxPages = resolveMaxPages(entry);
    const cfg = searchConfig(entry);
    const keywords = resolveKeywords(cfg);
    if (keywords.length === 0) {
      throw new Error(
        `gupy: entry "${entry?.name || '(unnamed)'}" has no gupy.keywords[]/gupy.q and no config/profile.yml target_roles to fall back to`,
      );
    }
    const workplaceTypes = listParam(cfg.workplace_types);
    const jobTypes = listParam(cfg.job_types);
    const state = typeof cfg.state === 'string' ? cfg.state.trim() : '';
    const country = typeof cfg.country === 'string' ? cfg.country.trim() : '';

    // Total page budget for this call, not pages per keyword (see the header).
    // Counts pages ATTEMPTED: a failing sweep moves on to the next keyword, so
    // counting only successes would let a probe of a broken board walk every
    // keyword.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const pageBudget = probing ? ctx.maxPages : Infinity;
    let pagesAttempted = 0;

    // Recency window. `ctx.sinceMs`, the run's own window from --since or
    // --posted-after, wins when present: an operator who widened the run to 30
    // days must not silently get this entry's 14. `since_days` is the entry's
    // default for runs that state no window.
    //
    // Only the entry's own window FILTERS. A ctx window is early-stop only,
    // exactly as workday.mjs treats it: scan.mjs applies its date filters
    // downstream. Nothing downstream knows about since_days, so that one must
    // filter here.
    const ctxCutoff = typeof ctx?.sinceMs === 'number' ? ctx.sinceMs : null;
    const entryCutoff = sinceDaysToCutoffMs(resolveSinceDays(cfg));
    const cutoffMs = ctxCutoff ?? entryCutoff;
    const filterCutoff = ctxCutoff === null ? entryCutoff : null;

    // One posting routinely matches several keywords; the URL is the dedup key
    // so the merged result carries each posting exactly once. Each sweep's
    // short-page stop reads the raw page length, never this set.
    const seen = new Set();
    const out = [];

    // Per-sweep failure isolation (workday.mjs policy): keep what completed,
    // warn, stop that sweep. Within a sweep a mid-walk failure leaves that
    // keyword partial; the feed is newest-first, so a partial sweep is "the
    // freshest N pages of this keyword".
    let firstError = null;
    let succeededOnce = false;

    for (const keyword of keywords) {
      if (pagesAttempted >= pageBudget) break;
      for (let page = 0; page < maxPages; page++) {
        if (pagesAttempted >= pageBudget) break;
        const params = new URLSearchParams({
          jobName: keyword,
          offset: String(page * PER_PAGE),
          limit: String(PER_PAGE),
        });
        if (workplaceTypes) params.set('workplaceTypes', workplaceTypes);
        if (jobTypes) params.set('jobTypes', jobTypes);
        if (state) params.set('state', state);
        if (country) params.set('country', country);

        const url = assertApiUrl(`${API_BASE}?${params}`);
        if (pagesAttempted > 0) await sleep(INTER_REQUEST_DELAY_MS, ctx);
        pagesAttempted++;
        let rows;
        try {
          const json = await fetchJsonWithRetry(ctx, url, { redirect: 'error' });
          rows = extractGupyRows(json, keyword, page);
        } catch (err) {
          // A probe must see the rejection itself: verify-portals identifies
          // its budget cut-off by the error's identity.
          if (probing) throw err;
          if (firstError === null) firstError = err;
          console.error(`⚠️  gupy: sweep "${keyword}" stopped at page ${page}: ${err?.message || String(err)}`);
          break;
        }
        succeededOnce = true;

        const pageJobs = [];
        for (const raw of rows) {
          const normalized = normalizeGupyApiJob(raw);
          if (!normalized) continue;
          pageJobs.push(normalized);
          if (seen.has(normalized.url)) continue;
          seen.add(normalized.url);
          // Undated postings pass the window, the same "don't penalize missing
          // data" convention scan.mjs's date filters use.
          if (filterCutoff !== null && typeof normalized.postedAt === 'number'
              && normalized.postedAt < filterCutoff) {
            continue;
          }
          out.push(normalized);
        }

        // A short page is the end of the feed (see the header on why
        // `pagination.total` cannot be used for this).
        if (rows.length < PER_PAGE) break;
        // Newest-first ordering means once a whole page sits past the window,
        // every later page does too.
        if (pageIsPastWindow(pageJobs, cutoffMs)) break;
        // Full page in hand and no max_pages left: the feed has more and this
        // entry's config stopped us. Not warned when ctx.maxPages did the
        // cutting; a probe is not a misconfiguration.
        if (page + 1 >= maxPages) {
          console.error(
            `⚠️  gupy: "${keyword}" truncated at max_pages=${maxPages} (${maxPages * PER_PAGE} postings read, feed has more); raise max_pages on this entry for more`,
          );
        }
      }
    }

    // Not one sweep produced a page: an outage, a moved endpoint or a changed
    // payload, which must reach scan.mjs's error report instead of passing for
    // a quiet zero. Rethrows the ORIGINAL error: verify-portals reads
    // err.status and err.name to classify it.
    if (!succeededOnce && firstError !== null) throw firstError;
    return out;
  },
};
