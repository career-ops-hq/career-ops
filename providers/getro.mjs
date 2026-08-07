// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Getro provider — generic support for VC-portfolio job boards built on the
// Getro SaaS product (one vendor, many independently-hosted tenants on
// vanity domains: careers.atomico.com, talent.cherry.vc, hv.getro.com,
// jobs.pointnine.com, ...). Not auto-detected (no common host suffix to key
// off, unlike myworkdayjobs.com) — opt-in only via `provider: getro`.
//
// Two-step fetch per tenant:
//   1. Resolve `collection_id` from the tenant's own `careers_url` — the
//      frontend page server-embeds it in a `__NEXT_DATA__` script tag
//      (`props.pageProps.network.id`), no JS execution needed. An explicit
//      `getro.collection_id` override on the entry skips this request.
//   2. Paginate `POST https://api.getro.com/api/v2/collections/{id}/search/jobs`
//      (public, zero-auth) with `{hitsPerPage, page, filters:{page}, query:''}`,
//      stopping on a short page or once `results.count` is covered.
//
// A `referer` header (derived from careers_url's origin) is required — a
// bare request without one gets a 406 (verified live).
//
// The same logical role can appear as several listings in the raw feed
// (once per location) — that's downstream dedup's job (by url), not this
// provider's; do not fold results.count into a "unique roles" assumption.

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const API_ORIGIN = 'https://api.getro.com';
const HITS_PER_PAGE = 20;

// Safety cap on pagination, same philosophy as providers/workday.mjs: a
// modest default that covers small-to-mid boards in full, raised per-entry
// for large ones (Accel-scale boards run ~1,238 pages at 20/page).
const DEFAULT_MAX_PAGES = 100;
const MAX_PAGES_CAP = 1500;

// Delay between successive pages of one tenant's own pagination loop (not
// between tenants). Getro showed no rate-limit evidence in manual testing,
// but a large board (Accel: ~1,238 pages) is still a long burst of
// same-host requests without some pacing.
const INTER_PAGE_DELAY_MS = 150;

function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Validate + normalize `entry.careers_url`. Required even when an explicit
 * `getro.collection_id` override is set — it's also the source of the
 * `referer` header the search API needs.
 */
function resolveCareersUrl(entry) {
  const label = entry?.name || 'entry';
  const raw = typeof entry?.careers_url === 'string' ? entry.careers_url.trim() : '';
  if (!raw) throw new Error(`getro: ${label} is missing careers_url (required to resolve collection_id and referer)`);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`getro: ${label} has a malformed careers_url: ${raw}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`getro: ${label} careers_url must use HTTPS: ${raw}`);
  return parsed.href;
}

/** Manual override: `entry.getro.collection_id`, positive integer or all-digit string. */
function resolveOverrideCollectionId(entry) {
  const v = entry?.getro?.collection_id;
  if (v === undefined || v === null) return null;
  if (Number.isInteger(v) && v > 0) return String(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim()) && /[1-9]/.test(v.trim())) return v.trim();
  throw new Error(`getro: ${entry?.name || 'entry'} has an invalid getro.collection_id override: ${JSON.stringify(v)} (must be a positive integer)`);
}

/**
 * Extract `network.id` from a Getro frontend page's `__NEXT_DATA__` blob.
 * Exported for unit tests. Returns an all-digit string, or null when the
 * page doesn't have the expected shape (no fixup attempted here — the
 * caller decides whether that's fatal).
 *
 * @param {string} html
 * @returns {string | null}
 */
export function extractCollectionId(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
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
  const override = resolveOverrideCollectionId(entry);
  if (override) return override;

  const label = entry?.name || careersUrl;
  const html = await ctx.fetchText(careersUrl, {
    redirect: 'error',
    headers: { accept: 'text/html', 'user-agent': BROWSER_LIKE_USER_AGENT },
  });
  const id = extractCollectionId(html);
  if (!id) {
    throw new Error(
      `getro: ${label} — could not resolve collection_id from ${careersUrl} (no network.id found in __NEXT_DATA__; ` +
      `page structure may have changed — set getro: { collection_id: N } on this entry as a fallback)`,
    );
  }
  return id;
}

// NaN-safe epoch-seconds → epoch-ms. `created_at` is seconds, not ms.
function toEpochMsFromSeconds(value) {
  const secs = Number(value);
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined;
}

/**
 * `{min, max, currency}` shape scan.mjs's salary_filter consumes, or null
 * when there's no usable figure. Ports the logic already correct in
 * plugins.local/startup-boards/lib/getro.mjs::getroSalary — same source,
 * just the backend API's snake_case field names instead of the frontend's
 * camelCase ones. A non-year compensation_period (hourly/monthly/etc.) is
 * treated as "no usable annual figure", matching the plugin's behavior.
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

/**
 * Normalize a single Getro search-API job. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `title`, trimmed (required; postings without one are
 *               dropped). Getro sometimes stores a URL string as the title
 *               — a source-side data-quality issue, passed through as-is.
 *   - url:      `url` — the job's real, already-resolved application URL
 *               (usually the company's own ATS). Required, http(s) only.
 *   - company:  `organization.name`, falling back to the portal entry name,
 *               then "Getro".
 *   - location: `locations` (array), falling back to `searchable_locations`;
 *               "Remote" is appended when `work_mode === 'remote'` and no
 *               existing part already mentions it.
 *   - postedAt: `created_at` (epoch seconds) → epoch ms.
 *   - salary:   optional, see getroSalary().
 *
 * @param {any} job
 * @param {{ name?: string }} [entry]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number, salary?: {min: number, max: number, currency: string} } | null}
 */
export function normalizeGetroJob(job, entry) {
  if (!job || typeof job !== 'object') return null;

  const title = typeof job.title === 'string' ? job.title.trim() : '';
  if (!title) return null;

  let url = '';
  const rawUrl = typeof job.url === 'string' ? job.url.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') url = parsed.href;
    } catch {
      // malformed URL → leave url = '' → dropped below
    }
  }
  if (!url) return null;

  const orgName = typeof job.organization?.name === 'string' ? job.organization.name.trim() : '';
  const fallbackName = typeof entry?.name === 'string' ? entry.name.trim() : '';
  const company = orgName || fallbackName || 'Getro';

  const fromArray = (arr) => (Array.isArray(arr) ? arr.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim()) : []);
  const primaryLocations = fromArray(job.locations);
  let locationParts = primaryLocations.length > 0 ? primaryLocations : fromArray(job.searchable_locations);
  if (job.work_mode === 'remote' && !locationParts.some((l) => /remote/i.test(l))) {
    locationParts = [...locationParts, 'Remote'];
  }

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number, salary?: {min: number, max: number, currency: string} }} */
  const result = { title, url, company, location: locationParts.join(', ') };

  const postedAt = toEpochMsFromSeconds(job.created_at);
  if (postedAt !== undefined) result.postedAt = postedAt;

  const salary = getroSalary(job);
  if (salary) result.salary = salary;

  return result;
}

/** @type {Provider} */
export default {
  id: 'getro',

  // Getro tenants live on arbitrary vanity domains (careers.atomico.com,
  // talent.cherry.vc, ...) with no common suffix to auto-detect against —
  // opt-in only via explicit `provider: getro`, per ADDING_A_PROVIDER.md §1.
  detect() {
    return null;
  },

  /**
   * @param {{ name?: string, careers_url?: string, max_pages?: number, getro?: { collection_id?: number|string } }} entry
   * @param {{ fetchText: (url: string, opts?: object) => Promise<string>, fetchJson: (url: string, opts?: object) => Promise<any>, maxPages?: number, sleep?: (ms: number) => Promise<void> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt?: number, salary?: {min: number, max: number, currency: string}}>>}
   */
  async fetch(entry, ctx) {
    const careersUrl = resolveCareersUrl(entry);
    const origin = new URL(careersUrl).origin;
    const collectionId = await resolveCollectionId(entry, ctx, careersUrl);
    const searchUrl = `${API_ORIGIN}/api/v2/collections/${collectionId}/search/jobs`;

    const maxPages = resolveMaxPages(entry);
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pageCap = Math.min(maxPages, ctxCap);

    const postOpts = (page) => ({
      method: 'POST',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        referer: `${origin}/`,
      },
      body: JSON.stringify({ hitsPerPage: HITS_PER_PAGE, page, filters: { page }, query: '' }),
    });

    const jobs = [];
    for (let page = 1; page <= pageCap; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);

      let json;
      try {
        json = await ctx.fetchJson(searchUrl, postOpts(page));
      } catch (err) {
        // `err` is not guaranteed to be an Error — a promise may reject with
        // anything, and reading .message off null would throw *inside* the
        // catch, defeating the graceful-truncate guarantee below (mirrors
        // providers/greenhouse.mjs's /offices enrichment catch).
        const cause = err instanceof Error ? err.message : String(err);
        console.error(`⚠️  getro: ${entry?.name || collectionId} truncated at page ${page} of ${pageCap} (${jobs.length} jobs): ${cause}`);
        break;
      }

      const rawJobs = Array.isArray(json?.results?.jobs) ? json.results.jobs : [];
      const count = typeof json?.results?.count === 'number' ? json.results.count : null;
      for (const j of rawJobs) {
        const normalized = normalizeGetroJob(j, entry);
        if (normalized) jobs.push(normalized);
      }

      const shortPage = rawJobs.length < HITS_PER_PAGE;
      const coveredAll = count !== null && page * HITS_PER_PAGE >= count;
      if (shortPage || coveredAll) break;

      // Cap warning: only fires when the entry's own max_pages caused the
      // stop, not a lower ctx.maxPages-driven health probe (mirrors
      // workday.mjs's ctxCap/entry-cap split).
      if (page === pageCap && pageCap === maxPages) {
        const total = count !== null ? count : 'many';
        console.error(`⚠️  getro: ${entry?.name || collectionId} truncated at max_pages=${maxPages} (${jobs.length} of ${total} listings) — raise max_pages on this entry for more`);
      }
    }

    return jobs;
  },
};
