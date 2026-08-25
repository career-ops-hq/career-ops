// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Getro provider — VC "talent network" portfolio job boards (jobs at a fund's
// portfolio companies). Powers b2venture, Earlybird, Point Nine, Speedinvest,
// Cherry, HV Capital, Atomico, and many other VC boards, all on independently
// hosted vanity domains — no common host suffix to auto-detect against, so
// this is opt-in only via `provider: getro`.
//
// The public search API is:
//   POST https://api.getro.com/api/v2/collections/{collection_id}/search/jobs
//   body: {"hitsPerPage":N,"page":P,"filters":{"page":P},"query":""}
//   -> { results: { jobs: [ {title,url,organization:{name},locations[],created_at,...} ], count } }
//
// A board's numeric collection_id is the `network.id` embedded in the board
// page's __NEXT_DATA__. Set it explicitly with `getro_collection` in
// portals.yml, or leave it out and it auto-resolves from `careers_url` (a GET
// of the board's own jobs page, parsed for __NEXT_DATA__) — no manual lookup
// required. `careers_url` is required either way: it also supplies the
// `referer` header the search API needs (a bare request without one has been
// observed returning 406).
//
//   - name: b2venture (portfolio)
//     provider: getro
//     careers_url: https://jobs.b2venture.vc/jobs
//     # getro_collection: 4283   # optional — skips the auto-resolve fetch
//     enabled: true
//
// These boards are large (1000-2000+ jobs) but the API returns them
// created_at-DESCENDING (newest first), so we paginate newest-first and STOP
// once postings fall older than `getro_max_age_days`. This is a PAGINATION
// BOUND for efficiency (don't page through thousands of stale jobs); each job
// still carries `postedAt` (epoch ms) for any downstream freshness handling.
// The bound default (90d) is deliberately wide. `getro_max_pages` (default
// 40, hard-capped at 1500) is a safety ceiling independent of the age cutoff.
// Jobs with no created_at are kept ("missing data = pass", same rule as the
// location filter).
//
// The same logical role can appear as several listings in the raw feed (once
// per location) — that's downstream dedup's job (by url), not this
// provider's; do not fold results.count into a "unique roles" assumption.
//
// Each page fetch is retried on a transient failure (429/5xx/timeout-abort)
// via the shared fetchJsonWithRetry — a large board runs into the hundreds of
// pages, so one blip mid-sweep shouldn't truncate the whole run (#2506).

import { BROWSER_LIKE_USER_AGENT, fetchJsonWithRetry, fetchTextWithRetry } from './_http.mjs';

// Getro returns `created_at` as Unix seconds, but older boards have been seen
// emitting ISO strings, so both shapes are handled. Non-positive values return
// null: the pagination cutoff below treats null as "undated, keep", whereas a
// 0 would read as 1970 and stop the walk on the first malformed row.
function toEpochMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    // Values below 1e12 are Unix seconds; at or above, already ms.
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) || ms <= 0 ? null : ms;
}

const API_BASE = 'https://api.getro.com/api/v2/collections';
const HITS_PER_PAGE = 20;          // API hard-caps page size at 20
const DEFAULT_MAX_PAGES = 40;      // safety cap: 40 x 20 = 800 newest jobs/board
// Ceiling on the per-entry `getro_max_pages` override. Without it a typo'd or
// hostile portals.yml value (getro_max_pages: 10000) turns one board into
// 10k sequential API calls against a third party.
// 1500 x 20 = 30,000 newest jobs/board — headroom for the largest known
// Getro boards (Insight Partners' portfolio alone runs ~11.5k listings,
// ~577 pages; Accel-scale boards run higher still).
const HARD_MAX_PAGES = 1500;
const DEFAULT_MAX_AGE_DAYS = 90;   // pagination bound only; global filter does the real cut

// Delay between successive pages of one tenant's own pagination loop (not
// between tenants). Getro showed no rate-limit evidence in manual testing,
// but a large board is still a long burst of same-host requests without some
// pacing.
const INTER_PAGE_DELAY_MS = 250;

function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Manual override: `entry.getro_collection`, a positive integer or all-digit string. */
function resolveCollectionOverride(entry) {
  const id = entry.getro_collection;
  if (id == null) return null;
  const s = String(id).trim();
  if (!/^\d+$/.test(s) || !/[1-9]/.test(s)) return null;
  return s;
}

// `careers_url` is locally-authored portals.yml config, not external/untrusted
// input (see AGENTS.md's Untrusted External Content boundary — job postings,
// forms, emails; not the user's own config) — the user names the host on
// purpose. Only HTTPS is enforced (needed to build a correct referer origin);
// no host allowlist.
function resolveCareersUrl(entry) {
  let parsed;
  try {
    parsed = new URL(entry.careers_url || '');
  } catch {
    return null;
  }
  return parsed.protocol === 'https:' ? parsed : null;
}

/**
 * Extract `network.id` from a Getro frontend page's `__NEXT_DATA__` blob.
 * Exported for unit tests. Returns an all-digit string, or null when the
 * page doesn't have the expected shape (no fixup attempted here — the caller
 * decides whether that's fatal).
 *
 * @param {string} html
 * @returns {string | null}
 */
export function extractCollectionId(html) {
  if (typeof html !== 'string') return null;
  // Match on the id attribute alone — tolerates attribute reordering, extra
  // attributes (e.g. a CSP nonce), whitespace around `=`, and either quote
  // style, instead of requiring an exact `id="..." type="..."` sequence.
  // Requires a literal space (not just a \b word boundary) immediately before
  // `id` so a `data-id="__NEXT_DATA__"` attribute can't false-match — `\b`
  // alone also fires on the `-`→`i` transition inside "data-id".
  const m = html.match(/<script\b[^>]*\sid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const id = data?.props?.pageProps?.network?.id;
  if (typeof id === 'string' && /^\d+$/.test(id)) return id;
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) return String(id);
  return null;
}

/** Override wins; otherwise fetch careers_url and parse __NEXT_DATA__. */
async function resolveCollectionId(entry, ctx, careersUrl) {
  const override = resolveCollectionOverride(entry);
  if (override) return override;

  const label = entry?.name || careersUrl.href;
  // Retried like every page fetch below — this single request runs BEFORE
  // pagination even starts, so without a retry a transient blip here (DNS/TLS/
  // connection reset) fails the whole board before a single page is fetched.
  const html = await fetchTextWithRetry(ctx, careersUrl.href, {
    redirect: 'error',
    headers: { accept: 'text/html', 'user-agent': BROWSER_LIKE_USER_AGENT },
  });
  const id = extractCollectionId(html);
  if (!id) {
    throw new Error(
      `getro: ${label} — could not resolve collection_id from ${careersUrl.href} (no network.id found in ` +
      `__NEXT_DATA__; page structure may have changed — set getro_collection: N on this entry as a fallback)`,
    );
  }
  return id;
}

/**
 * `{min, max, currency}` shape scan.mjs's salary_filter consumes, or null
 * when there's no usable figure. A non-year compensation_period
 * (hourly/monthly/etc.) is treated as "no usable annual figure".
 */
function getroSalary(job) {
  const period = typeof job?.compensation_period === 'string' ? job.compensation_period.trim().toLowerCase() : '';
  if (period && period !== 'year') return null;
  const minCents = Number(job?.compensation_amount_min_cents);
  const maxCents = Number(job?.compensation_amount_max_cents);
  const min = Number.isFinite(minCents) && minCents > 0 ? minCents / 100 : null;
  const max = Number.isFinite(maxCents) && maxCents > 0 ? maxCents / 100 : null;
  if (min === null && max === null) return null;
  const currency = typeof job?.compensation_currency === 'string' ? job.compensation_currency.trim() : '';
  return { min: min ?? max, max: max ?? min, currency };
}

/** All known locations joined (not just the first), plus a "Remote" tag when work_mode says so. */
function locationString(job) {
  const fromArray = (arr) => (Array.isArray(arr) ? arr.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim()) : []);
  const primary = fromArray(job.locations);
  let parts = primary.length > 0 ? primary : fromArray(job.searchable_locations);
  if (job.work_mode === 'remote' && !parts.some((l) => /remote/i.test(l))) {
    parts = [...parts, 'Remote'];
  }
  return parts.join(', ');
}

/** @type {Provider} */
export default {
  id: 'getro',

  // Getro tenants live on arbitrary vanity domains (careers.atomico.com,
  // talent.cherry.vc, ...) with no common suffix to auto-detect against.
  // Still reports a hit when `getro_collection` is set explicitly, so
  // verify-portals has a probe URL for those entries without a live fetch.
  detect(entry) {
    const id = resolveCollectionOverride(entry);
    return id ? { url: `${API_BASE}/${id}/search/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const careersUrl = resolveCareersUrl(entry);
    if (!careersUrl) throw new Error(`getro: ${entry.name} needs an https careers_url`);

    const collectionId = await resolveCollectionId(entry, ctx, careersUrl);
    const apiUrl = `${API_BASE}/${collectionId}/search/jobs`;

    const requestedMaxPages = Number.isInteger(entry.getro_max_pages) && entry.getro_max_pages > 0
      ? Math.min(entry.getro_max_pages, HARD_MAX_PAGES) : DEFAULT_MAX_PAGES;
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const maxPages = Math.min(requestedMaxPages, ctxCap);

    const maxAgeDays = Number.isFinite(entry.getro_max_age_days) && entry.getro_max_age_days >= 0
      ? entry.getro_max_age_days : DEFAULT_MAX_AGE_DAYS;
    const cutoffMs = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86_400_000 : 0;

    const out = [];
    let total = Infinity;
    for (let page = 0; page < maxPages && page * HITS_PER_PAGE < total; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);

      let json;
      try {
        // Retried on transient upstream failures (429/5xx/timeout-abort): this
        // board can run into the hundreds of pages, so a single blip mid-sweep
        // used to abort the whole provider and keep only what was fetched so
        // far — now it retries first and only truncates once retries are
        // exhausted (mirrors a16z-speedrun-talent.mjs / workday.mjs, #2506).
        json = await fetchJsonWithRetry(ctx, apiUrl, {
          method: 'POST',
          // redirect:'error' — apiUrl is pinned to api.getro.com (https), so a 3xx
          // to a private/metadata IP must not be followed (matches every provider).
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            referer: `${careersUrl.origin}/`,
          },
          body: JSON.stringify({ hitsPerPage: HITS_PER_PAGE, page, filters: { page }, query: '' }),
        });
      } catch (err) {
        // `err` is not guaranteed to be an Error — a promise may reject with
        // anything, and reading .message off null would throw *inside* the
        // catch, defeating the graceful-truncate guarantee here.
        const cause = err instanceof Error ? err.message : String(err);
        if (page === 0) {
          // The FIRST page failing after retries means the board itself is
          // unreachable, not that it has zero listings — returning [] here
          // would misreport "dead board" as "0 open roles". Every other
          // paginating provider in this codebase draws the same line (e.g.
          // radancy.mjs, phenom.mjs, cryptocurrencyjobs.mjs): fail loudly on
          // page one, truncate-with-warning on a later page.
          throw err instanceof Error ? err : new Error(cause);
        }
        console.error(`⚠️  getro: ${entry.name || collectionId} truncated at page ${page} after retries (${out.length} jobs): ${cause}`);
        break;
      }

      const results = json?.results || {};
      const jobs = Array.isArray(results.jobs) ? results.jobs : [];
      if (typeof results.count === 'number') total = results.count;
      if (jobs.length === 0) break;

      let reachedOld = false;
      for (const j of jobs) {
        const url = j.url || '';
        if (!url) continue;
        // Jobs are newest-first; a dated posting older than the cutoff (and
        // everything after it) is stale. Keep undated jobs (missing = pass).
        const createdMs = toEpochMs(j.created_at);
        if (cutoffMs > 0 && createdMs != null && createdMs < cutoffMs) {
          reachedOld = true;
          continue;
        }
        const row = {
          title: j.title || '',
          url,
          // Portfolio jobs belong to the portfolio company, not the fund —
          // expose the real employer so dedup and the tracker read correctly.
          company: j.organization?.name || j.organization_name || entry.name,
          location: locationString(j),
          postedAt: createdMs,
        };
        const salary = getroSalary(j);
        if (salary) row.salary = salary;
        out.push(row);
      }
      // Once we've crossed the age cutoff, all later pages are older still.
      if (reachedOld) break;
    }
    return out;
  },
};
