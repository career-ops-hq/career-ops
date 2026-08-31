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

import { BROWSER_LIKE_USER_AGENT, fetchJsonWithRetry } from './_http.mjs';

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

// Retry policy for transient page failures (429 rate-limit, 5xx, timeouts/aborts),
// via providers/_http.mjs's shared fetchJsonWithRetry. Workday's CXS API is
// fronted by a WAF that rate-limits in bursts; without retry, a single 429
// silently truncates an entire tenant (e.g. a 3,383-posting tenant reduced to
// 20 jobs on page 2). Non-transient errors (4xx other than 429) are not
// retried — retrying a malformed request just wastes the budget.
const RETRY_POLICY = { retries: 3 };

// Delay between successive pages *within one tenant's own pagination loop*
// (not between tenants — that's scan-ats-full.mjs's concurrency, a separate
// knob). A burst of same-host requests with zero delay risks Workday's
// WAF-level rate limiting on any tenant that paginates several pages deep
// (large boards like rollsroyce, sec, roche). Only tenants that loop past
// page 1 pay this; no-date-skip and early-stopped tenants never do.
const INTER_PAGE_DELAY_MS = 250;

// Offset past which some tenants' CXS backend stops paginating: it reports
// `total` as exactly 2000 and answers offset=2000/4000 with the same postings
// as offset=0. Raising max_pages buys duplicates, not coverage — see the facet
// split below for the way around it.
const WORKDAY_OFFSET_CEILING = 2000;

// How many times a slice may itself be split. Two levels turn a clamped board
// into (values of facet A) x (values of facet B) queries, which cleared every
// clamped tenant observed; the bound exists because a tenant that reports a
// clamp at every level would otherwise recurse until it runs out of facets.
const MAX_SPLIT_DEPTH = 2;

// Total slice queries one tenant may spend. A pathological facet (hundreds of
// values, each still clamped) must not turn one board into an unbounded crawl.
const MAX_SPLIT_SLICES = 100;

// Page budget for a whole tenant, as a multiple of max_pages. A clamped board
// is crawled once unfaceted and then once per slice, and slices overlap, so the
// page count is not bounded by the board size — this is what stops one
// pathological tenant from eating a sweep.
const SPLIT_PAGE_BUDGET_FACTOR = 5;

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

// ── Facet split ───────────────────────────────────────────────────
//
// Workday's CXS backend refuses to paginate past offset 2000 on some tenants,
// and reports `total` as exactly 2000 while doing it (dickssportinggoods: says
// 2000, its own facet counts add up to ~8,400, the public site lists 7,120+).
// Offsets 2000 and 4000 then return the same postings as offset 0, so raising
// `max_pages` buys duplicates, not coverage.
//
// The facet counts in the same response are not clamped, which gives both the
// detector and the way out: re-issue the query once per facet value, so a slice
// that fits under the ceiling paginates honestly.
//
// This recovers coverage; it does not guarantee completeness. Real boards are
// skewed — dickssportinggoods puts 6,564 of its 8,423 postings in one jobFamily
// value, and *inside that slice* every other facet is skewed the same way
// (Brand 6562/6564, timeType 6483/6499), so the dominant mass never splits
// below the ceiling. The split is therefore strictly additive on top of the
// unfaceted crawl, and a board it could not finish keeps the workdayTruncated
// tag rather than being reported as complete.

/** Sum one facet's value counts; null when none of its values carry a count. */
function facetCoverage(facet) {
  const values = Array.isArray(facet?.values) ? facet.values : [];
  let sum = 0;
  let counted = 0;
  for (const v of values) {
    if (!Number.isInteger(v?.count) || v.count < 0) continue;
    sum += v.count;
    counted++;
  }
  return counted > 0 ? sum : null;
}

/**
 * Board size according to the facets, or null when no facet carries counts.
 *
 * Each facet partitions the same board, so any one of them should sum to the
 * true total; they disagree slightly in practice (a posting missing a facet
 * value is absent from that facet's counts), so take the largest — the reading
 * that under-reports least. Compared against the response's own `total` by the
 * caller: facets materially higher means `total` is clamped.
 *
 * Exported for the test suite, which pins the DSG numbers.
 */
export function trueTotalFromFacets(facets) {
  let best = null;
  for (const facet of Array.isArray(facets) ? facets : []) {
    const coverage = facetCoverage(facet);
    if (coverage === null) continue;
    if (best === null || coverage > best) best = coverage;
  }
  return best;
}

/**
 * Pick the facet to split a clamped board on, or null when none can.
 *
 * Chooses the facet with the smallest largest-slice, since that slice is the
 * one at risk of still being clamped and needing another split. Facets whose
 * values lack an `id` are unusable as a filter (live tenants ship id-less group
 * headers like `locationMainGroup`), and a facet with fewer than two usable
 * values is not a partition at all — applying it just re-fetches the same board
 * under a filter, which turns the split into a spin.
 *
 * `exclude` carries the facet parameters already applied further up the split,
 * without which re-splitting a slice would keep re-deriving the same partition.
 *
 * Exported for the test suite.
 */
export function chooseSplitFacet(facets, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  let best = null;
  for (const facet of Array.isArray(facets) ? facets : []) {
    const facetParameter = facet?.facetParameter;
    if (typeof facetParameter !== 'string' || !facetParameter || skip.has(facetParameter)) continue;
    const values = (Array.isArray(facet.values) ? facet.values : []).filter(
      (v) => typeof v?.id === 'string' && v.id && Number.isInteger(v?.count) && v.count >= 0,
    );
    if (values.length < 2) continue;
    const largest = Math.max(...values.map((v) => v.count));
    // Tie-break on value count: a finer partition leaves less to re-split.
    if (best === null || largest < best.largest || (largest === best.largest && values.length > best.values.length)) {
      best = { facetParameter, values, largest };
    }
  }
  return best ? { facetParameter: best.facetParameter, values: best.values } : null;
}

function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True once a page's oldest unambiguously-dated posting is past the --since window.
 *
 * Undated postings are invisible here. A page of nothing but undated postings
 * never stops pagination (the `dated.length === 0` guard), but a page that
 * mixes stale dated postings with undated ones does — and the undated ones on
 * later pages are then never fetched, even though scan.mjs's date filters
 * would have accepted them. Exported for test-all.mjs, which pins that
 * behaviour so it can't drift without the docs drifting too.
 */
export function pageIsPastWindow(pageJobs, sinceMs) {
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
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any>, sinceMs?: number, maxPages?: number, syntheticEntries?: boolean }} ctx
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
    const makeBody = (offset, appliedFacets) => JSON.stringify({ limit: PAGE_SIZE, offset, searchText: '', appliedFacets });
    const sinceMs = typeof ctx?.sinceMs === 'number' ? ctx.sinceMs : null;
    const maxPages = resolveMaxPages(entry);

    // Honor a context page cap — verify-portals' liveness probe sets
    // `ctx.maxPages: 1` so it only needs to know a board is live, not its full
    // count. Without this we'd fetch page 0, then request page 1 and trip the
    // probe's second-request sentinel; fetchJsonWithRetry treats that abort as
    // transient and retries it RETRY_POLICY.retries times (with backoff) before giving up
    // — noisy in the logs and rude to the tenant. Capping here makes workday a
    // "cooperating provider" that stops after one page and reports an exact
    // first-page count. Kept separate from `maxPages` so the entry-cap warning
    // below (pagesToFetch === maxPages) stays quiet. No effect on real scans,
    // which don't set ctx.maxPages.
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;

    // Shared across the unfaceted crawl and every slice, so one tenant's total
    // cost is bounded no matter how its facets fan out.
    const pageBudget = maxPages * SPLIT_PAGE_BUDGET_FACTOR;
    let pagesSpent = 0;
    let budgetExhausted = false;

    /**
     * True when this query hit the CXS offset clamp and can only be finished by
     * splitting it. The tell is the reported total sitting at (or under) the
     * ceiling while the facet counts — which are not clamped — describe a
     * bigger board. A probe (ctx.maxPages) never splits: it asked for one page.
     */
    const isClamped = (total, facets) => {
      if (ctxCap !== Infinity) return false;
      if (total === null || total > WORKDAY_OFFSET_CEILING) return false;
      const trueTotal = trueTotalFromFacets(facets);
      return trueTotal !== null && trueTotal > WORKDAY_OFFSET_CEILING;
    };

    /**
     * One paginated pass over a single query — the whole board when
     * `appliedFacets` is empty, otherwise one slice of it.
     *
     * Returns the facets alongside the jobs because the caller needs them to
     * decide whether this query was clamped and, if so, what to split it on.
     */
    const runQuery = async (appliedFacets) => {
      pagesSpent++;
      const first = await fetchJsonWithRetry(ctx, ep.api, { ...postOpts, body: makeBody(0, appliedFacets) }, RETRY_POLICY);
      const jobs = parseWorkdayResponse(first, entry);

      const total = typeof first?.total === 'number' ? first.total : null;
      const facets = Array.isArray(first?.facets) ? first.facets : [];
      const firstPostings = Array.isArray(first?.jobPostings) ? first.jobPostings : [];

      // How many pages to fetch in total (including the first, already-fetched
      // one): bounded by `total` when the server reports it, always capped at
      // maxPages. When `total` is absent, only probe further pages if the first
      // one was full — a short first page already means there's nothing more.
      let pagesToFetch = total !== null
        ? Math.min(Math.ceil(total / PAGE_SIZE), maxPages)
        : (firstPostings.length >= PAGE_SIZE ? maxPages : 1);
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

      // A clamped query is still worth paginating: everything up to the ceiling
      // is real and distinct, and it is the coverage floor the split builds on.
      // Only the pages *past* the ceiling are duplicates, and `total` being
      // clamped to the ceiling already stops pagination there.
      const clamped = stopReason === 'complete' && isClamped(total, facets);

      // Sequential, not concurrent (mirrors providers/4dayweek.mjs, thehub.mjs,
      // arbeitnow.mjs, jibeapply.mjs) — a single tenant's API has no reason to
      // receive a burst of parallel requests, and a mid-run failure stops
      // cleanly with whatever pages were already gathered instead of
      // discarding them (Promise.all would fail the whole batch on one error).
      let page = 1;
      if (stopReason === 'complete') {
        for (; page < pagesToFetch; page++) {
          if (pagesSpent >= pageBudget) { budgetExhausted = true; break; }
          await sleep(INTER_PAGE_DELAY_MS, ctx);
          pagesSpent++;
          let json;
          try {
            json = await fetchJsonWithRetry(ctx, ep.api, { ...postOpts, body: makeBody(page * PAGE_SIZE, appliedFacets) }, RETRY_POLICY);
          } catch (err) {
            const jobsSummary = `${jobs.length}${total !== null ? ` of ${total}` : ''} jobs`;
            // err.attempts (set by fetchJsonWithRetry) is the actual request count —
            // a non-retryable error can end the loop after just one attempt, well
            // short of RETRY_POLICY.retries + 1.
            const attempts = err.attempts ?? RETRY_POLICY.retries + 1;
            console.error(`⚠️  workday: ${entry.name} truncated at ${page + 1} of ${pagesToFetch} pages after ${attempts} attempts (${jobsSummary}): ${err.message}`);
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

      return { jobs, total, facets, stopReason, clamped };
    };

    const root = await runQuery({});
    const { total, stopReason } = root;

    // Set when the split ran out of depth, slices, or splittable facets with
    // part of the board still unreached — the difference between "this is the
    // whole board" and "this is as much of it as we could get".
    let splitIncomplete = false;
    let slicesSpent = 0;
    let jobs = root.jobs;

    if (root.clamped) {
      // Slices overlap wherever a posting carries several values of the split
      // facet, and every slice re-includes what the unfaceted page 0 already
      // returned, so the union is deduped on the posting URL. Only the split
      // path dedups: an unclamped tenant returns exactly what it paginated.
      const seen = new Set();
      const out = [];
      const absorb = (pageJobs) => {
        for (const job of pageJobs) {
          if (seen.has(job.url)) continue;
          seen.add(job.url);
          out.push(job);
        }
      };

      /**
       * Absorb one query's jobs and, when it came back clamped, recurse into a
       * facet that partitions it. `applied` accumulates the filters, `excluded`
       * the facet parameters already spent — without which the next level would
       * keep re-deriving the same partition.
       */
      const split = async (result, applied, depth, excluded) => {
        absorb(result.jobs);
        // A slice that stopped early is not a slice that finished. `clamped` is
        // only ever true for stopReason 'complete', so without this the
        // `!result.clamped` return below absorbs a slice's partial jobs and
        // reports the board recovered — the one thing this path exists to
        // avoid. 'early-stop' (and 'no-date-skip', which only drops postings
        // the sweep would discard anyway) stay exempt: those slices are
        // genuinely done for this sweep's purposes.
        //
        // 'cap' only counts against an UNCLAMPED query, matching the entry-cap
        // warning below. A clamped query reports total at the ceiling, which is
        // exactly maxPages * PAGE_SIZE, so it always ends at the cap — that is
        // the clamp being detected, not pages going unread, and it is what the
        // split then recovers. Tagging it would put "(still incomplete)" on
        // every clamped board and say nothing.
        if (result.stopReason === 'fetch-error' || (result.stopReason === 'cap' && !result.clamped)) {
          splitIncomplete = true;
        }
        if (!result.clamped) return;

        if (depth >= MAX_SPLIT_DEPTH) { splitIncomplete = true; return; }
        const facet = chooseSplitFacet(result.facets, { exclude: excluded });
        if (!facet) { splitIncomplete = true; return; }

        for (const value of facet.values) {
          if (slicesSpent >= MAX_SPLIT_SLICES) { splitIncomplete = true; break; }
          if (pagesSpent >= pageBudget) { splitIncomplete = true; break; }
          slicesSpent++;
          await sleep(INTER_PAGE_DELAY_MS, ctx);
          const nextApplied = { ...applied, [facet.facetParameter]: [value.id] };
          // runQuery()'s page-0 fetch is unguarded — fine for the one page-0 of
          // an ordinary board, but here it runs once per slice against a tenant
          // that is by definition large, which is where a WAF or rate limiter
          // lives. Letting it throw would abandon the whole tenant including
          // the unfaceted crawl already absorbed into `out`, so a dead slice
          // becomes an incomplete split and the rest of the partition is still
          // tried. Same accounting as a slice that died mid-pagination.
          let sliceResult;
          try {
            sliceResult = await runQuery(nextApplied);
          } catch (err) {
            const attempts = err.attempts ?? RETRY_POLICY.retries + 1;
            console.error(`⚠️  workday: ${entry.name} slice ${facet.facetParameter}=${value.id} failed on its first page after ${attempts} attempts: ${err.message}`);
            splitIncomplete = true;
            continue;
          }
          await split(
            sliceResult,
            nextApplied,
            depth + 1,
            [...excluded, facet.facetParameter],
          );
        }
      };

      await split(root, {}, 0, []);
      jobs = out;

      // Distinct from the cap warning below: nothing about this tenant's entry
      // can be edited to fix it, and the count that matters is what the split
      // recovered on top of the ceiling.
      const short = splitIncomplete || budgetExhausted ? ' (still incomplete)' : '';
      console.error(`⚠️  workday: ${entry.name} offset-clamped at ${WORKDAY_OFFSET_CEILING} — recovered ${jobs.length} jobs via ${slicesSpent} facet slices${short}`);
    }

    // The cap is a safety net, not a working limit — silent by design, but a
    // tenant that actually hits it needs to be surfaced, in one short line
    // (a full-directory scan can hit this on dozens of tenants).
    //
    // "raise max_pages" only applies when `entry` is a real portals.yml
    // tracked_companies entry — there is something to edit. scan-ats-full.mjs's
    // reverse scan synthesizes entries from the external dataset, so there's no
    // portal entry to point at, and no fixed cap can guarantee full coverage of
    // an unbounded company directory anyway; nothing else to suggest there.
    //
    // The branch below used to key on `sinceMs === null` as a proxy for that
    // distinction, which held only because scan-ats-full.mjs was the sole
    // caller setting it. #2418 broke the proxy — `scan.mjs --since` sets
    // ctx.sinceMs too, so a tracked entry lost the actionable half of the
    // message on every --since run (#2495). Provenance is now stated by the
    // caller instead of inferred from an unrelated flag, so a future caller
    // that starts setting sinceMs cannot re-couple the two concerns.
    //
    // Absence means "tracked": scan-ats-full.mjs is the only caller that
    // synthesizes entries AND can reach the cap (discover-ats.mjs and
    // verify-portals.mjs both probe with ctx.maxPages: 1, which never sets
    // stopReason to 'cap'), so it is the one place that opts out.
    const syntheticEntries = ctx?.syntheticEntries === true;
    if (stopReason === 'cap' && !root.clamped) {
      const jobsSummary = `${jobs.length}${total !== null ? ` of ${total}` : ''} jobs`;
      if (!syntheticEntries) {
        console.error(`⚠️  workday: ${entry.name} truncated at max_pages=${maxPages} (${jobsSummary}) — raise max_pages on this entry for more`);
      } else {
        // Workday's CXS backend can report `total` as exactly
        // maxPages*PAGE_SIZE when the real count is far higher (e.g.
        // dickssportinggoods: total=2000, public site lists 7,120; requests
        // at offset 2000/4000 return the same first posting as offset 0).
        // Flag it, don't explain it here. A tenant whose facets prove the
        // clamp takes the facet-split path above instead of this warning.
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
    // 'fetch-error' means retries were exhausted mid-pagination while 19
    // other tenants were hammering the same uplink. scan-ats-full.mjs
    // collects tagged tenants and retries them sequentially after the
    // parallel sweep, when the line is quiet — same array-tag pattern as
    // workdayNoDateSkip (no extra per-tenant logging here).
    if (stopReason === 'fetch-error') jobs.workdayTruncated = true;
    // A split that could not reach the whole board is the same kind of partial
    // result, and scan-ats-full.mjs already knows how to report that tag.
    if (splitIncomplete || budgetExhausted) jobs.workdayTruncated = true;

    return jobs;
  },
};
