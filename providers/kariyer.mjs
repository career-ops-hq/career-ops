// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { markTruncated } from '../lib/board-truncation.mjs';
import { intInRange } from './_config-utils.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { coerceId } from './_ids.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// kariyer.net — Turkey's largest job board (operator: Kariyer.net Elektronik
// Yayıncılık ve İletişim Hizmetleri A.Ş., named in the site's own footer).
// Target list: `job_boards:` — one entry covers the whole country-wide board,
// there is no per-tenant URL to configure:
//
//   - name: Kariyer.net (Türkiye)
//     provider: kariyer
//     careers_url: https://www.kariyer.net/is-ilanlari
//     enabled: true
//
// --- Source -----------------------------------------------------------------
//
// The board's candidate site is a Nuxt app whose own client calls a separate,
// auth-free JSON gateway. That gateway — not the HTML — is what this provider
// reads:
//
//   POST https://candidatewebapigw.kariyer.net/search
//        { currentPage, size, sortType, sortDirection }
//   → { statusCode: 'Success',
//       data: { totalJobCount, currentPage, jobSortType,
//               jobs: { items: [ { id, title, companyName, jobUrl, companyUrl,
//                                  locationText, allLocations, locations: […],
//                                  postingDate, showTime, jobCode, workType,
//                                  workModel, confidential, isSponsored,
//                                  redirectedInformation }, … ] } } }
//
//   GET  https://candidatewebapigw.kariyer.net/job?jobId={id}
//   → { data: { jobGeneralInformation: { title, companyName, locationText,
//                postingDate, showTime, language, qualifications,
//                qualificationsWithHtml }, jobCompanyInformation: {…} } }
//
// Measured live 2026-11-16: the gateway answers the shared career-ops
// User-Agent on every request (20/20), needs no cookie, token, Referer or
// `Api-Version` header (sending `Api-Version: 1.1` is answered with 403), and
// serves no `robots.txt` at all (404 — no rule to honour). The site's HTML
// routes are a different story: `www.kariyer.net/is-ilanlari` sits behind a
// PerimeterX bot challenge that answers a plain client with a 403
// `px-captcha` page, which is why this provider never fetches the HTML listing
// or the posting pages. `www.kariyer.net/robots.txt` disallows `/filtre`,
// `/ozgecmis`, the account routes and a few query-string forms; none of the
// paths this provider requests (`/search`, `/job` on the gateway host) is
// covered by it.
//
// --- Complete inventory (rule 3) --------------------------------------------
//
// `totalJobCount` is the whole board (~22,936 on 2026-11-16), and the default
// view IS that inventory: no keyword or facet is needed for coverage. Two
// properties of the walk matter:
//
// 1. Sort stability. The gateway's default sort is `SmartSort`, a
//    relevance-model ordering that re-ranks between requests. Walking it by
//    offset was measured to lose 551 of 22,930 postings across 12 pages: page
//    boundaries move under the walk, so rows are both duplicated and skipped.
//    `sortType: 'SortByDate', sortDirection: 'Ascending'` (oldest first) is
//    stable for the walk's duration — new postings append at the tail and
//    cannot shift a page already read. The same 12-page walk then returned
//    22,934 unique ids against a single-request snapshot's 22,935 taken five
//    seconds later (the one-row difference is a posting published between the
//    two calls). `totalJobCount` is identical under every sort mode, so the
//    ascending order is not a narrower view.
//
// 2. Sponsored pins. Three promoted rows are pinned to the top of every page
//    on top of the requested `size`, so each page returns `size + 3` rows and
//    those three repeat on every page. They are real postings, so they are not
//    dropped — they are de-duplicated by URL like any other repeat.
//
// The walk stops on the board's own natural end (a page shorter than `size`,
// then an empty one) and is bounded by this provider's own page ceiling; the
// source's `totalJobCount` is never what decides the loop. A walk the ceiling
// or a failed page cuts short carries the canonical
// `jobs.truncated = { reason, fetched, total }` marker (`markTruncated()` in
// `lib/board-truncation.mjs`), so scan.mjs logs the board `partial` instead of
// `reachable`; a health probe and a naturally-ended walk are never marked.
//
// --- URL / dedup key --------------------------------------------------------
//
// 115 of the 22,930 rows carry `redirectedInformation.redirectedJobUrl` — the
// employer's own application page (basf.jobs, *.icims.com, hrpeak,
// smartrecruiters, …). Per Source Indexing Policy rule 2 that is the emitted
// `Job.url`, with the board's own `utm_*` parameters stripped; the kariyer.net
// posting page (`https://www.kariyer.net` + `jobUrl`) is the fallback, used
// when the upstream link is absent, not `https:`, malformed, or points at the
// board's own click-tracking host (`stats.the-network.com` — a placement
// tracker, i.e. paid attribution the candidate should not be routed through,
// rule 3). The emitted URL is display-only and never fetched by this provider,
// so only the API URLs we actually request are host-locked (`assertKariyerApiUrl`).
//
// --- Fields -----------------------------------------------------------------
//
// - `title`, `companyName` and `locationText` are carried by every row (22,930
//   of 22,930; 22,928 for the location). A confidential posting hides the
//   employer on the posting page but still names it in `companyName`, so no
//   row is dropped for it.
// - `postedAt` comes from `showTime` ("2026-11-16T08:40"), the board's Turkish
//   local wall-clock with no offset; Turkey has run on a fixed UTC+3 (TRT) with
//   no DST since 2016, so the offset is applied explicitly rather than guessed
//   from the host clock. `postingDate` (date-only) is the fallback.
// - `requisitionId` is the employer's own posting code (`jobCode`, e.g.
//   "RF-AF6464"), present on every row; `externalId` is the board's own
//   posting id. `listingIdentity` is deliberately NOT set: the gateway serves
//   the whole country board with no tenant or board slug to resolve, and
//   `docs/listing-fingerprint.md` says to supply no triple when the full
//   namespace cannot be resolved (a made-up `board_slug` would assert a strong
//   identity the source never issued). URL dedup still collapses the same
//   posting reached twice.
// - `workplaceType` comes from the payload's own `workModel`
//   ("OnSite"/"Hybrid"/"Remote"), a dedicated field, never inferred from the
//   location text; an unmapped or absent value omits the key.
// - `locations` carries the payload's per-place array before it is joined into
//   `locationText` (`locations[].cityName`, deduped, omitted when empty) — a
//   multi-city posting like "İstanbul(Asya), Kocaeli" ships as two places.
// - No `language`: the list payload carries no language field, and the detail
//   payload's display name ("Turkish") is not worth making the Job shape
//   depend on whether detail enrichment is on.
// - No `country` (`locations[].countryId` is an internal id, not a country
//   code) and no `eligibilityText`/`visaText` (the board states no such thing
//   outside the JD).
// - No `salary` and no list-level `description`: the list payload carries
//   neither. `qualifications` on the detail endpoint is the real JD text, so
//   opt in per entry with `kariyer: { fetchDetails: true, detailLimit: 25 }`
//   (capped at 100, skipped during health probes).

const SITE_ORIGIN = 'https://www.kariyer.net';
const BOARD_URL = `${SITE_ORIGIN}/is-ilanlari`;
const API_ORIGIN = 'https://candidatewebapigw.kariyer.net';
const SEARCH_URL = `${API_ORIGIN}/search`;
const DETAIL_URL = `${API_ORIGIN}/job`;

// Rows per request. Measured 2026-11-16: 2,000 rows arrive in ~400 ms as a
// ~3.4 MB body, and the whole ~22.9k-row board is 12 pages / ~4.5 s. A single
// request large enough to hold the board in one response (size=30000, 40 MB)
// was observed to truncate mid-body, and a small page size multiplies the
// request count for no gain.
const PAGE_SIZE = 2000;
// Safety bound, not a coverage setting: 50 pages × 2,000 rows = 100,000
// postings, ~4.4× the board measured on 2026-11-16.
const DEFAULT_MAX_PAGES = 50;
// The gateway clamps `currentPage` above 100 server-side, so a larger
// `max_pages` on the entry cannot buy more than this.
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const DETAIL_PACE_MS = 250;
const DETAIL_LIMIT_DEFAULT = 25;
const DETAIL_LIMIT_MAX = 100;

// Oldest-first, so a posting published mid-walk appends at the tail instead of
// shifting every page boundary already read (see the header note).
const SEARCH_SORT = Object.freeze({ sortType: 'SortByDate', sortDirection: 'Ascending' });

// The board's own click trackers. A redirect through one of these is placement
// attribution, not the employer's page (rule 2 + rule 3).
const TRACKING_REDIRECT_HOSTS = new Set(['stats.the-network.com']);

// `workModel` is the source's dedicated workplace field. Anything else — a new
// value the board introduces — maps to nothing and the key is omitted, rather
// than being forced into one of the three the contract allows.
const WORKPLACE_TYPES = new Map([
  ['onsite', 'onsite'],
  ['hybrid', 'hybrid'],
  ['remote', 'remote'],
]);

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The board's timestamps are Turkish local wall-clock with no offset.
 * `showTime` is "YYYY-MM-DDTHH:mm"; `postingDate` is a date-only fallback.
 * @param {any} item
 * @returns {number|undefined}
 */
export function kariyerPostedAt(item) {
  const showTime = text(item?.showTime);
  const withTime = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(showTime);
  if (withTime) {
    const parsed = Date.parse(`${withTime[1]}T${withTime[2]}:00+03:00`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const date = text(item?.postingDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = Date.parse(`${date}T00:00:00+03:00`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * The payload's own workplace model, normalized to the contract's three
 * values. Undefined when the field is absent or carries a value this provider
 * does not know.
 * @param {any} item
 * @returns {'onsite'|'hybrid'|'remote'|undefined}
 */
export function kariyerWorkplaceType(item) {
  return WORKPLACE_TYPES.get(text(item?.workModel).toLowerCase());
}

/**
 * The distinct places the payload lists before it joins them into
 * `locationText` — its per-place `cityName`, in payload order, deduped.
 * @param {any} item
 * @returns {string[]}
 */
export function kariyerPlaces(item) {
  const rows = Array.isArray(item?.locations) ? item.locations : [];
  const out = [];
  for (const row of rows) {
    const name = text(row?.cityName) || text(row?.countryName);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Canonical URL for a posting — Source Indexing Policy rule 2, "the shortest
 * verifiable path to the employer the source exposes".
 *
 * Prefers `redirectedInformation.redirectedJobUrl` (the employer's own
 * application page), with `utm_*` parameters stripped. Accepts any https:
 * origin except the board's click trackers — the value is display-only and is
 * never fetched here. Falls back to the kariyer.net posting page. Returns ''
 * when neither is usable, and the caller drops the row.
 *
 * `jobUrl` must be site-root-relative: "//evil.example/x" resolves away from
 * SITE_ORIGIN under the WHATWG URL parser (as does a leading "/\"), so those
 * shapes are rejected before parsing rather than after.
 *
 * @param {any} item
 * @returns {string}
 */
export function resolveKariyerUrl(item) {
  const upstream = text(item?.redirectedInformation?.redirectedJobUrl);
  if (upstream) {
    try {
      const parsed = new URL(upstream);
      if (parsed.protocol === 'https:' && !TRACKING_REDIRECT_HOSTS.has(parsed.hostname.toLowerCase())) {
        for (const key of [...parsed.searchParams.keys()]) {
          if (key.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(key);
        }
        return parsed.href;
      }
    } catch {
      // malformed — fall through to the board page
    }
  }

  const rawPath = text(item?.jobUrl);
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.startsWith('/\\')) return '';
  try {
    const parsed = new URL(rawPath, SITE_ORIGIN);
    if (parsed.protocol === 'https:' && parsed.hostname === 'www.kariyer.net') return parsed.href;
  } catch {
    // malformed path → unusable
  }
  return '';
}

/**
 * Normalize a single search row. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:         `title`, trimmed (rows without one are dropped).
 *   - url:           see resolveKariyerUrl (rows with no usable URL are dropped).
 *   - company:       `companyName`, falling back to the portal entry name.
 *   - location:      `locationText`, falling back to `allLocations`.
 *   - locations:     the payload's per-place `cityName` list, before joining.
 *   - workplaceType: `workModel`, normalized; omitted when unknown.
 *   - postedAt:      `showTime` (Turkish local, UTC+3), else `postingDate`.
 *   - externalId:    the board's own posting id.
 *   - requisitionId: `jobCode`, the employer's own posting code.
 *
 * @param {any} item
 * @param {string} [fallbackCompany]
 * @returns {{title: string, url: string, company: string, location: string, locations?: string[], workplaceType?: 'onsite'|'hybrid'|'remote', postedAt?: number, externalId?: string, requisitionId?: string} | null}
 */
export function normalizeKariyerJob(item, fallbackCompany) {
  if (!item || typeof item !== 'object') return null;

  const title = text(item.title);
  if (!title) return null;

  const url = resolveKariyerUrl(item);
  if (!url) return null;

  const company = text(item.companyName) || text(fallbackCompany) || 'kariyer.net';
  const location = text(item.locationText) || text(item.allLocations);
  const locations = kariyerPlaces(item);
  const workplaceType = kariyerWorkplaceType(item);
  const postedAt = kariyerPostedAt(item);
  const externalId = coerceId(item.id);
  const requisitionId = coerceId(item.jobCode);

  return {
    title,
    url,
    company,
    location,
    ...(locations.length === 0 ? {} : { locations }),
    ...(workplaceType === undefined ? {} : { workplaceType }),
    ...(postedAt === undefined ? {} : { postedAt }),
    ...(externalId === undefined ? {} : { externalId }),
    ...(requisitionId === undefined ? {} : { requisitionId }),
  };
}

/**
 * SSRF guard: every request this provider issues goes to a fixed literal host,
 * so this only asserts that the constant has not been reshaped. Reference:
 * `assertGreenhouseUrl` in `providers/greenhouse.mjs`.
 * @param {string} url
 */
function assertKariyerApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`kariyer: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`kariyer: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== 'candidatewebapigw.kariyer.net') {
    throw new Error(`kariyer: untrusted hostname "${parsed.hostname}" — must be candidatewebapigw.kariyer.net`);
  }
  return url;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** @param {any} entry */
function parseConfig(entry) {
  const cfg = entry?.kariyer || {};
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, DETAIL_LIMIT_DEFAULT, 1, DETAIL_LIMIT_MAX),
  };
}

/**
 * The detail endpoint's JD text. `qualifications` is already plain text;
 * `qualificationsWithHtml` is the same content marked up, and is only used when
 * the plain field comes back empty. `jobDescription` was null on every posting
 * sampled live, so it is not read.
 * @param {any} json
 * @returns {string}
 */
export function parseKariyerDetail(json) {
  const general = json?.data?.jobGeneralInformation;
  if (!general || typeof general !== 'object') return '';
  const plain = text(general.qualifications);
  if (plain) return plain;
  return htmlToText(text(general.qualificationsWithHtml));
}

/** @type {Provider} */
export default {
  id: 'kariyer',

  detect(entry) {
    const raw = entry?.api || entry?.careers_url;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let parsed;
    try {
      parsed = new URL(raw.trim());
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'www.kariyer.net' && host !== 'kariyer.net') return null;
    // Only the board's own listing paths. The same host serves employer profile
    // pages (`/firma-profil/…`), which are single-company entries this provider
    // must not claim — claiming one would scan the whole country's board for a
    // company entry that asked for one employer.
    if (!/^\/is-ilanlari(?:\/|$)/.test(parsed.pathname)) return null;
    return { url: BOARD_URL };
  },

  async fetch(entry, ctx) {
    assertKariyerApiUrl(SEARCH_URL);
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMaxPages = resolveMaxPages(entry);
    // ctx.maxPages is verify-portals' "first page only" health probe — it always
    // wins over the entry's own bound.
    const maxPages = Math.min(entryMaxPages, probing ? ctx.maxPages : Number.POSITIVE_INFINITY);
    const label = text(entry?.name) || 'kariyer.net';
    const jobs = [];
    const seen = new Set();
    let stopReason = 'complete';
    /** @type {number|undefined} */
    let reportedTotal;

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);

      let json;
      try {
        json = await fetchJsonWithRetry(ctx, SEARCH_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ currentPage: page, size: PAGE_SIZE, ...SEARCH_SORT }),
          redirect: 'error',
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
      } catch (err) {
        // While probing, a ctx.fetch* rejection (e.g. ProbePageBudgetReached)
        // must propagate unwrapped so verify-portals reads it as "live, count
        // unknown" rather than a broken board.
        if (probing) throw err;
        // A first page that cannot be fetched has nothing to keep, and
        // returning [] would read as a live but empty board: fail loud.
        if (page === 1) throw err;
        stopReason = 'fetch-error';
        console.error(`⚠️  kariyer: ${label} — page ${page} failed after retries (${err?.message}); keeping ${jobs.length} postings`);
        break;
      }

      const items = json?.data?.jobs?.items;
      if (!Array.isArray(items)) {
        const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
        throw new Error(
          `kariyer: unexpected response on page ${page} — expected { data: { jobs: { items: [...] } } }, got keys: [${got}]`,
        );
      }

      // The source's own board size, carried into the truncation marker so a
      // partial read says how much of the board it reached.
      const pageTotal = json?.data?.totalJobCount;
      if (Number.isFinite(pageTotal)) reportedTotal = pageTotal;

      for (const item of items) {
        const job = normalizeKariyerJob(item, label);
        if (!job) continue;
        if (seen.has(job.url)) continue; // the 3 promoted pins repeat on every page
        seen.add(job.url);
        jobs.push(job);
      }

      // The stop conditions read the row count the SOURCE returned for this
      // page, before de-duplication and before malformed rows are dropped.
      const rawCount = items.length;
      if (rawCount === 0) break; // natural end of the board
      if (rawCount < PAGE_SIZE) break; // short final page wins over the ceiling
      if (page === maxPages) {
        // A full page at the ceiling is only a truncation when the source's own
        // total says more postings exist. Reaching that total means the whole
        // board was read and the boundary page merely happened to be full — a
        // board whose size is an exact multiple of PAGE_SIZE.
        if (!(Number.isFinite(reportedTotal) && jobs.length >= reportedTotal)) stopReason = 'cap';
      }
    }

    // The warning is tied to the entry's own bound, never to a ctx.maxPages
    // probe cap: a health probe truncating on purpose is not a misconfiguration.
    // With max_pages: 1 on the entry, maxPages === entryMaxPages holds under
    // the probe too, so the probe is excluded by name (#7180).
    if (stopReason === 'cap' && maxPages === entryMaxPages && !probing) {
      // Past MAX_PAGES_CAP the gateway clamps `currentPage` anyway, so the
      // "raise max_pages" advice would be a dead end there.
      const advice = maxPages < MAX_PAGES_CAP
        ? 'raise max_pages on this entry for more'
        : `the gateway clamps currentPage at ${MAX_PAGES_CAP}, so a higher max_pages cannot help — raise PAGE_SIZE in the provider instead`;
      console.error(`⚠️  kariyer: ${label} truncated at max_pages=${maxPages} (${jobs.length} postings) — ${advice}`);
    }

    // Canonical partial-read signal (`lib/board-truncation.mjs`): a board cut
    // short by the page ceiling or by a page that failed after retries is
    // logged `partial` in the portal-health ledger instead of `reachable`, and
    // named in the run summary. A health probe is not a truncation — it stops
    // below the cap by design, and a failure there throws — so it never marks,
    // and neither does a walk that ended on the board's own short/empty page.
    if (!probing && (stopReason === 'cap' || stopReason === 'fetch-error')) {
      markTruncated(jobs, stopReason === 'cap' ? 'page-cap' : 'fetch-error', {
        fetched: jobs.length,
        ...(reportedTotal === undefined ? {} : { total: reportedTotal }),
      });
    }

    const { fetchDetails, detailLimit } = parseConfig(entry);
    if (!fetchDetails || probing) return jobs;

    // The walk is oldest-first, so enrichment takes the newest postings — the
    // ones a candidate can still act on.
    const candidates = jobs.slice(-detailLimit);
    for (let i = 0; i < candidates.length; i++) {
      const job = candidates[i];
      // A row whose id will not encode (a lone surrogate) is dropped rather
      // than fetched, and an absent id is no request at all.
      const jobId = safeEncodeURIComponent(coerceId(job.externalId) ?? '');
      if (!jobId) continue;
      try {
        const detail = await fetchJsonWithRetry(ctx, `${DETAIL_URL}?jobId=${jobId}`, {
          headers: { accept: 'application/json' },
          redirect: 'error',
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        const description = parseKariyerDetail(detail);
        if (description) job.description = description;
      } catch {
        // Detail lookup is opt-in enrichment. Keep the listing row on failure.
      }
      if (i + 1 < candidates.length) await sleep(DETAIL_PACE_MS, ctx);
    }

    return jobs;
  },
};
