// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Workday provider — hits the public CXS jobs endpoint (POST, paginated).
// Auto-detects from careers_url pattern
// `https://<tenant>.<instance>.myworkdayjobs.com[/<locale>]/<site>`,
// e.g. https://23andme.wd5.myworkdayjobs.com/23 →
//      POST https://23andme.wd5.myworkdayjobs.com/wday/cxs/23andme/23/jobs
//
// Workday only exposes a relative "postedOn" label ("Posted Today",
// "Posted 5 Days Ago", "Posted 30+ Days Ago"); postedAt is derived from it
// and omitted for the unbounded "30+ Days Ago" form.

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const PAGE_SIZE = 20;

// Safety cap on pagination — applied regardless of what the upstream reports
// as `total` (or, when `total` is absent, regardless of how many full pages
// keep coming back), so a misbehaving/compromised API can't drive this into
// fetching an unbounded number of pages. Override with `max_pages` on the
// portal entry for a tenant that genuinely exceeds it.
const DEFAULT_MAX_PAGES = 100;
// Hard ceiling even for an explicit override. 1500 pages (30,000 postings)
// covers known large tenants (dollartree: 23,609; oreillyauto: 17,061;
// cvshealth: ~16,800) with headroom — not a completeness guarantee, since a
// company directory this size has no fixed upper bound.
const MAX_PAGES_CAP = 1500;

// Retry policy for transient page failures (429 rate-limit, 5xx, timeouts/aborts).
// Workday's CXS API is fronted by a WAF that rate-limits in bursts; without
// retry, a single 429 silently truncates an entire tenant (e.g. a
// 3,383-posting tenant reduced to 20 jobs on page 2). Non-transient errors
// (4xx other than 429) are not retried — retrying a malformed request just
// wastes the budget.
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;

// Delay between successive pages *within one tenant's own pagination loop*
// (not between tenants — that's scan-ats-full.mjs's concurrency, a separate
// knob). A burst of same-host requests with zero delay risks Workday's
// WAF-level rate limiting on any tenant that paginates several pages deep
// (large boards like rollsroyce, sec, roche). Only tenants that loop past
// page 1 pay this; no-date-skip and early-stopped tenants never do.
const INTER_PAGE_DELAY_MS = 150;

// Workday returns postings newest-first, so pagination can stop once a
// page's oldest *dated* posting is well past --since — no point paying for
// (and rate-limit-risking) pages that are entirely stale. Only unambiguous
// numeric ages ("Posted N Days Ago", N < 30) count for this; the unbounded
// "30+ Days Ago" bucket never triggers it, so a wide --since (>=30 days)
// simply never early-stops rather than risk a false stop.
//
// The sort isn't perfectly monotonic day-to-day — some tenants (e.g. Adobe)
// return day-labels slightly out of order across consecutive postings ("27
// Days Ago | 26 Days Ago | 27 Days Ago"), roughly 1 day of jitter. The
// margin only needs to clear that; 2 is double it as a plain safety factor,
// not a second measurement.
const EARLY_STOP_MARGIN_MS = 2 * 86_400_000;

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses a `Retry-After` header value (seconds, or an HTTP-date) to ms, or null. */
function parseRetryAfterMs(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

function isRetryableError(err) {
  const status = err?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  return status === undefined; // network error / timeout / abort — no status set
}

/** Fetches a single page, retrying transient failures with backoff. */
async function fetchPageWithRetry(ctx, api, opts) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await ctx.fetchJson(api, opts);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryableError(err)) throw err;
      const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
      // A server-supplied Retry-After is honored, but still clamped — an
      // unbounded value (hostile or just misconfigured: Retry-After: 86400)
      // would otherwise stall this tenant's fetch for as long as the server
      // says, defeating the whole point of a bounded backoff.
      const retryAfterMs = parseRetryAfterMs(err?.retryAfter);
      const delayMs = retryAfterMs !== null ? Math.min(retryAfterMs, RETRY_MAX_DELAY_MS * 4) : (backoff + Math.random() * 250);
      await sleep(delayMs, ctx);
    }
  }
  throw lastErr;
}

/** True once a page's oldest unambiguously-dated posting is past the --since window. */
function pageIsPastWindow(pageJobs, sinceMs) {
  if (typeof sinceMs !== 'number') return false;
  const dated = pageJobs.map((j) => j.postedAt).filter((v) => typeof v === 'number');
  if (dated.length === 0) return false;
  return Math.min(...dated) < sinceMs - EARLY_STOP_MARGIN_MS;
}

function resolveEndpoint(entry) {
  // Try api: first, then careers_url (mirrors greenhouse/ashby), returning the
  // first that matches the Workday tenant pattern. This lets a branded page
  // (e.g. https://www.ptc.com/en/careers) stay as careers_url while the Workday
  // tenant URL is pinned via api: — and, because we fall through on a non-match,
  // a non-Workday api: value doesn't shadow a valid careers_url.
  for (const url of [entry.api, entry.careers_url]) {
    if (typeof url !== 'string' || !url) continue;
    const m = url.match(/^https:\/\/([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/);
    if (!m) continue;
    const [, tenant, instance, site] = m;
    const origin = `https://${tenant}.${instance}.myworkdayjobs.com`;
    return {
      api: `${origin}/wday/cxs/${tenant}/${site}/jobs`,
      // externalPath is relative to the site, not the host root — without the
      // site segment the URL 404s.
      jobBase: `${origin}/${site}`,
      origin,
    };
  }
  return null;
}

function parsePostedOn(label) {
  if (!label) return undefined;
  if (/posted\s+today/i.test(label)) return Date.now();
  if (/posted\s+yesterday/i.test(label)) return Date.now() - 86_400_000;
  const m = label.match(/posted\s+(\d+)(\+?)\s*day/i);
  if (!m || m[2] === '+') return undefined; // "30+ Days Ago" — unbounded, no usable date
  return Date.now() - Number(m[1]) * 86_400_000;
}

// Workday URL path encodes location as /job/{Location-Slug}/{title-slug}.
// Use it as fallback when locationsText is absent (common on some tenants).
function locationFromPath(externalPath) {
  const m = String(externalPath || '').match(/\/job\/([^/]+)\//);
  if (!m) return '';
  let segment;
  try { segment = decodeURIComponent(m[1]); } catch { segment = m[1]; }
  return segment.replace(/-/g, ' ');
}

export function parseWorkdayResponse(json, entry) {
  const ep = resolveEndpoint(entry);
  const jobBase = ep?.jobBase || '';
  const postings = Array.isArray(json?.jobPostings) ? json.jobPostings : [];
  const jobs = [];
  for (const j of postings) {
    if (j == null) continue;
    if (!j.externalPath || !String(j.title || '').trim()) continue;
    jobs.push({
      title: j.title || '',
      url: jobBase + j.externalPath,
      company: entry.name,
      location: j.locationsText || locationFromPath(j.externalPath),
      postedAt: parsePostedOn(j.postedOn),
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'workday',

  detect(entry) {
    const ep = resolveEndpoint(entry);
    return ep ? { url: ep.api } : null;
  },

  /**
   * Fetch all job postings for a Workday-backed entry, paginating through
   * the tenant's CXS API.
   *
   * Some tenants front their CXS API with Cloudflare bot management (seen
   * live: geico) that 500s requests missing ordinary browser headers — the
   * default UA/accept-language-less request trips it even over plain HTTPS
   * with no other red flags. A real Chrome UA + accept-language + matching
   * origin/referer clears it without needing per-tenant config (same fix
   * as providers/glints.mjs's firewall).
   *
   * @param {{ name?: string, api?: string, careers_url?: string, max_pages?: number }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, sinceMs?: number, maxPages?: number }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const ep = resolveEndpoint(entry);
    if (!ep) throw new Error(`workday: cannot derive CXS endpoint for ${entry.name}`);

    const postOpts = {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': BROWSER_LIKE_USER_AGENT,
        'accept-language': 'en-US,en;q=0.9',
        origin: ep.origin,
        referer: `${ep.jobBase}/`,
      },
    };
    const makeBody = (offset) => JSON.stringify({ limit: PAGE_SIZE, offset, searchText: '', appliedFacets: {} });
    const sinceMs = typeof ctx?.sinceMs === 'number' ? ctx.sinceMs : null;

    const first = await fetchPageWithRetry(ctx, ep.api, { ...postOpts, body: makeBody(0) });
    const jobs = parseWorkdayResponse(first, entry);

    const total = typeof first?.total === 'number' ? first.total : null;
    const firstPostings = Array.isArray(first?.jobPostings) ? first.jobPostings : [];
    const maxPages = resolveMaxPages(entry);

    // How many pages to fetch in total (including the first, already-fetched
    // one): bounded by `total` when the server reports it, always capped at
    // maxPages. When `total` is absent, only probe further pages if the first
    // one was full — a short first page already means there's nothing more.
    let pagesToFetch = total !== null
      ? Math.min(Math.ceil(total / PAGE_SIZE), maxPages)
      : (firstPostings.length >= PAGE_SIZE ? maxPages : 1);

    // Honor a context page cap — verify-portals' liveness probe sets
    // `ctx.maxPages: 1` so it only needs to know a board is live, not its full
    // count. Without this we'd fetch page 0, then request page 1 and trip the
    // probe's second-request sentinel; fetchPageWithRetry treats that abort as
    // transient and retries it MAX_RETRIES times (with backoff) before giving up
    // — noisy in the logs and rude to the tenant. Capping here makes workday a
    // "cooperating provider" that stops after one page and reports an exact
    // first-page count. Kept separate from `maxPages` so the entry-cap warning
    // below (pagesToFetch === maxPages) stays quiet. No effect on real scans,
    // which don't set ctx.maxPages.
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    pagesToFetch = Math.min(pagesToFetch, ctxCap);

    // Why pagination stopped — drives which warning (if any) fires below.
    // 'fetch-error' must NOT produce the "raise max_pages" advice: that knob
    // does nothing for a tenant that died on a rate limit rather than hit the cap.
    let stopReason = 'complete';
    if (pageIsPastWindow(jobs, sinceMs)) stopReason = 'early-stop';
    // Some tenants' CXS responses never include postedOn at all (e.g.
    // adventhealth, on every page). Early-stop can't apply then — there's
    // no dated posting to recognize as "past the window".
    const sawAnyDatedPosting = jobs.some((j) => typeof j.postedAt === 'number');

    // Zero dated postings on page 0, --include-undated off, --since-bounded
    // scan: further pagination is pure waste — every posting from this
    // tenant will be dropped downstream as undated regardless of page count
    // (newest-first sort means if the *freshest* postings lack a date, older
    // ones will too). Return page 0's results instead of grinding to maxPages.
    if (stopReason === 'complete' && sinceMs !== null && ctx?.includeUndated !== true
      && !sawAnyDatedPosting && jobs.length > 0) {
      stopReason = 'no-date-skip';
    }

    // Sequential, not concurrent (mirrors providers/4dayweek.mjs, thehub.mjs,
    // arbeitnow.mjs, jibeapply.mjs) — a single tenant's API has no reason to
    // receive a burst of parallel requests, and a mid-run failure stops
    // cleanly with whatever pages were already gathered instead of
    // discarding them (Promise.all would fail the whole batch on one error).
    let page = 1;
    if (stopReason === 'complete') {
      for (; page < pagesToFetch; page++) {
        await sleep(INTER_PAGE_DELAY_MS, ctx);
        let json;
        try {
          json = await fetchPageWithRetry(ctx, ep.api, { ...postOpts, body: makeBody(page * PAGE_SIZE) });
        } catch (err) {
          const jobsSummary = `${jobs.length}${total !== null ? ` of ${total}` : ''} jobs`;
          console.error(`⚠️  workday: ${entry.name} truncated at ${page + 1} of ${pagesToFetch} pages after ${MAX_RETRIES + 1} attempts (${jobsSummary}): ${err.message}`);
          stopReason = 'fetch-error';
          break;
        }
        const pageJobs = parseWorkdayResponse(json, entry);
        jobs.push(...pageJobs);
        if (total === null) {
          const postings = Array.isArray(json?.jobPostings) ? json.jobPostings : [];
          if (postings.length < PAGE_SIZE) break; // short page → last page reached
        }
        if (pageIsPastWindow(pageJobs, sinceMs)) { stopReason = 'early-stop'; break; }
      }
      if (stopReason === 'complete' && page === pagesToFetch && pagesToFetch === maxPages) {
        stopReason = 'cap';
      }
    }

    // The cap is a safety net, not a working limit — silent by design, but a
    // tenant that actually hits it needs to be surfaced, in one short line
    // (a full-directory scan can hit this on dozens of tenants).
    //
    // "raise max_pages" only applies when `entry` is a real portals.yml
    // tracked_companies entry (scan.mjs, sinceMs === null). scan-ats-full.mjs's
    // reverse scan (the only caller that sets ctx.sinceMs) synthesizes entries
    // from the external dataset — there's no portal entry to edit, and no
    // fixed cap can guarantee full coverage of an unbounded company
    // directory anyway, so there's nothing else to suggest.
    if (stopReason === 'cap') {
      const jobsSummary = `${jobs.length}${total !== null ? ` of ${total}` : ''} jobs`;
      if (sinceMs === null) {
        console.error(`⚠️  workday: ${entry.name} truncated at max_pages=${maxPages} (${jobsSummary}) — raise max_pages on this entry for more`);
      } else {
        // Workday's CXS backend can report `total` as exactly
        // maxPages*PAGE_SIZE when the real count is far higher (e.g.
        // dickssportinggoods: total=2000, public site lists 7,120; requests
        // at offset 2000/4000 return the same first posting as offset 0).
        // Flag it, don't explain it here.
        const suspectTag = total !== null && total === maxPages * PAGE_SIZE ? ' (total may be Workday-capped, not real)' : '';
        console.error(`⚠️  workday: ${entry.name} truncated at ${maxPages} pages (${jobsSummary})${suspectTag}`);
      }
    }
    // 'no-date-skip' hits many tenants in a full-directory scan (a company
    // with several Workday sites, like a1group or ashealthnet, triggers it
    // once per site) — a console.error per hit would repeat thousands of
    // times, so tag the array instead; scan-ats-full.mjs aggregates it into
    // one summary line.
    if (stopReason === 'no-date-skip') jobs.workdayNoDateSkip = true;

    return jobs;
  },
};
