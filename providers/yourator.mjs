// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Yourator provider — yourator.co, a Taiwanese job board focused on startups
// and digital roles. Public JSON API, no auth, no cookie, no Referer:
//
//   https://www.yourator.co/api/v4/jobs?page=N
//   → { payload: { hasMore, currentPage, nextPage, jobs: [ { id, name, path,
//       salary, lastActiveAt, location, companyId, tags, company: { brand, … },
//       thirdPartyUrl, externalSource } ], recommendedJobs, trendingKeywords } }
//
// Configure via a `job_boards` (or `tracked_companies`) entry with
// `provider: yourator`:
//
//   - name: Yourator (Taiwan startup board)
//     provider: yourator
//     careers_url: https://www.yourator.co/jobs
//     enabled: true
//
// --- Design notes -----------------------------------------------------------
//
// URL / dedup key. Each posting may carry `thirdPartyUrl` — the employer's own
// ATS page (teamdoor.io, Greenhouse, Lever, BambooHR, Breezy, or a self-hosted
// careers site) — and that is the emitted URL, per Source Indexing Policy rule
// 2: the shortest verifiable path to the employer. The Yourator posting page
// (SITE_ORIGIN + `path`) is the fallback, used when a row has no usable
// thirdPartyUrl. A live walk on 2026-08-18 found 636 of 1,760 rows (36.1%)
// carrying one, all https:, none pointing back at yourator.co.
//
// Following remotli.mjs and jobvite.mjs, the emitted URL is accepted from any
// https: origin and is NOT host-pinned: it is display-only and never fetched by
// this provider, so the host lock belongs on the API URLs we actually request
// (assertYouratorUrl), not on the URLs we hand downstream. Non-https and
// malformed values fall back to the Yourator page rather than being trusted.
//
// UTM stripping. Five of those 636 rows arrive with the board's ad-campaign
// parameters appended (`utm_source=yourator&utm_medium=ads&utm_campaign=…`).
// They are dropped from the emitted URL for two reasons: the same role reached
// through the employer's direct ATS provider must dedup to the same key, and
// rule 3 says paid placement does not reach the candidate — that includes not
// forwarding the placement's attribution. Only `utm_*` keys are removed; any
// functional query parameter (a job id, a tenant slug) survives.
//
// Complete inventory (rule 3). The API exposes no free-text search parameter —
// q / keyword / search / term / query / title are all accepted and silently
// ignored, returning the unfiltered board — and no filter parameter is needed
// for full coverage: the default view IS the complete inventory. The provider
// therefore walks every page until `payload.hasMore` turns false and lets
// scan.mjs's title/content/location filters decide (rule 5). This matters more
// than it looks: the board's ordering is not purely chronological, and the five
// ad-carrying rows all landed in pages 1-18 of 88. A shallow default would have
// captured 100% of the promoted rows and 11% of the board — precisely the
// response bias rule 3 exists to prevent. DEFAULT_MAX_PAGES is a safety bound
// above the observed page count, not a coverage setting.
//
// Employer attribution. `company.brand` carries the real employer (151 distinct
// companies across the board), not the aggregator's name, so tracker rows land
// under the actual employer and the cross-listing check has something to
// compare against.
//
// No postedAt. The API publishes only `lastActiveAt`, a localized relative
// string ("一天內更新"), with no absolute timestamp anywhere in the payload.
// Per the Job contract, postedAt is omitted rather than guessed — a synthesized
// date would silently corrupt scan-ats-full.mjs's recency filtering.

const SITE_ORIGIN = 'https://www.yourator.co';
const FEED_BASE = `${SITE_ORIGIN}/api/v4/jobs`;
const TRUSTED_HOST = 'www.yourator.co';
// Safety bound only — the loop stops on payload.hasMore. The live board was 88
// pages on 2026-08-18; this leaves room to grow without silently truncating.
const DEFAULT_MAX_PAGES = 120;
const MAX_PAGES_CAP = 500;
const PAGE_DELAY_MS = 200;

/** @param {string} url */
function assertYouratorUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`yourator: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`yourator: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`yourator: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Canonical URL for a posting — Source Indexing Policy rule 2, "the shortest
 * verifiable path to the employer the source exposes".
 *
 * Prefers `thirdPartyUrl` (the employer's own ATS page), with the board's
 * `utm_*` ad parameters stripped. Accepts any https: origin — the value is
 * display-only and never fetched here. Falls back to the Yourator posting page
 * when thirdPartyUrl is absent, non-https or malformed. Returns '' when neither
 * is usable, and the caller drops the row.
 *
 * `path` must be site-root-relative: "//evil.example/x" resolves away from
 * SITE_ORIGIN under the WHATWG URL parser (as does a leading "/\"), so those
 * shapes are rejected before parsing rather than after.
 *
 * @param {any} j
 * @returns {string}
 */
export function resolveYouratorUrl(j) {
  const raw = typeof j.thirdPartyUrl === 'string' ? j.thirdPartyUrl.trim() : '';
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'https:') {
        for (const key of [...parsed.searchParams.keys()]) {
          if (key.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(key);
        }
        return parsed.href;
      }
    } catch {
      // malformed — fall through to the board page
    }
  }

  const rawPath = typeof j.path === 'string' ? j.path.trim() : '';
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.startsWith('/\\')) return '';
  try {
    const parsed = new URL(rawPath, SITE_ORIGIN);
    if (parsed.protocol === 'https:' && parsed.hostname === TRUSTED_HOST) return parsed.href;
  } catch {
    // malformed path → unusable
  }
  return '';
}

/**
 * Normalize a single Yourator job. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:    `name`, trimmed (rows without one are dropped).
 *   - url:      see resolveYouratorUrl (rows with no usable URL are dropped).
 *   - company:  `company.brand`, falling back to the portal entry name, then "Yourator".
 *   - location: `location` — a Taiwanese city name, e.g. "臺北市".
 *   - postedAt: never emitted; see the header note.
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string } | null}
 */
export function normalizeYouratorJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.name === 'string' ? j.name.trim() : '';
  if (!title) return null;

  const url = resolveYouratorUrl(j);
  if (!url) return null;

  const brand = typeof j.company?.brand === 'string' ? j.company.brand.trim() : '';
  const company = brand || fallbackCompany || 'Yourator';
  const location = typeof j.location === 'string' ? j.location.trim() : '';

  return { title, url, company, location };
}

/** @type {Provider} */
export default {
  id: 'yourator',

  async fetch(entry, ctx) {
    assertYouratorUrl(FEED_BASE);
    // ctx.maxPages is verify-portals.mjs's "first page only" health probe — it
    // always wins over the entry's own bound.
    const maxPages = Math.min(resolveMaxPages(entry), ctx?.maxPages ?? Number.POSITIVE_INFINITY);
    const fallbackCompany = entry?.name;
    const out = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = `${FEED_BASE}?page=${page}`;
      // redirect:'error' prevents SSRF via server-side redirects
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      const jobs = json?.payload?.jobs;
      if (!Array.isArray(jobs)) {
        throw new Error(
          `yourator: unexpected API response on page ${page} — expected { payload: { jobs: [...] } }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const j of jobs) {
        const normalized = normalizeYouratorJob(j, fallbackCompany);
        if (normalized) out.push(normalized);
      }
      // `hasMore` is the API's own end-of-board signal and the only stop
      // condition: past the last page it answers with an empty array and
      // hasMore:false. A short-page heuristic is deliberately NOT used — it
      // cannot help (maxPages already bounds a runaway walk) and a single short
      // intermediate page would silently truncate the board.
      if (json.payload.hasMore !== true) break;
      if (page < maxPages) {
        await (ctx.sleep ? ctx.sleep(PAGE_DELAY_MS) : new Promise(r => setTimeout(r, PAGE_DELAY_MS)));
      }
    }
    return out;
  },
};
