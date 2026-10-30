// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/**
 * Jobstreet-only portal options. Keep these out of the generic provider contract.
 * @typedef {import('./_types.js').PortalEntry & {
 *   siteKey?: string,
 *   searchKeywords?: string,
 *   searchLocation?: string,
 *   pageSize?: number,
 *   maxPages?: number,
 *   appendWorkType?: boolean,
 * }} JobstreetEntry
 */
/**
 * Jobs with optional metadata indicating an incomplete scan.
 * @typedef {import('./_types.js').Job[] & {
 *   jobstreetTruncated?: {reason: 'cap' | 'fetch-error'}
 * }} JobstreetJobs
 */

import { fetchJsonWithRetry, sleep } from "./_http.mjs";

// Jobstreet / SEEK provider — hits the public SEEK v5 JobSearch REST API.
//
// Jobstreet (jobstreet.com, jobstreet.co.id, etc.) and SEEK (seek.com.au,
// seek.co.nz) share the same SEEK infrastructure. The old chalice-search
// v4 API (/api/chalice-search/v4/search) was deprecated; the v5 API at
// /api/jobsearch/v5/search is the current replacement.
//
// This provider is designed for explicit `provider: jobstreet` in portals.yml.
// Auto-detection from careers_url is not supported because Jobstreet is a
// job board aggregator, not a company ATS.
//
// Portal entry fields (all optional except `provider`):
//   api             — v5 search endpoint URL (default: https://id.jobstreet.com/api/jobsearch/v5/search)
//   siteKey         — SEEK site key for regional filtering (default: "ID-Main")
//   searchKeywords  — Search keywords, space-separated (default: "")
//   searchLocation  — Location filter (default: "")
//   pageSize        — Results per page (default 30, hard-capped at 100)
//   max_pages       — Page cap (default 100, hard-capped at 500; legacy maxPages also accepted)
//   appendWorkType  — Append the listing's work type(s) to the title, e.g.
//                     "Strategy Consultant [Part time]", so title filters and
//                     triage can see employment type at scan time (default: false)
//
// Site keys by market:
//   ID-Main  → id.jobstreet.com (Indonesia)
//   SG-Main  → sg.jobstreet.com (Singapore)
//   MY-Main  → my.jobstreet.com (Malaysia)
//   AU-Main  → www.seek.com.au  (Australia — set api: https://www.seek.com.au/api/jobsearch/v5/search)
//   NZ-Main  → www.seek.co.nz   (New Zealand)
//   HK-Main  → hk.jobsdb.com    (Hong Kong)
//
// Hong Kong runs under the JobsDB brand rather than Jobstreet, but it is the
// same SEEK platform behind the same v5 endpoint, so it needs no separate
// provider — only its hostname in the allowlist below and siteKey: HK-Main.

const DEFAULT_API = "https://id.jobstreet.com/api/jobsearch/v5/search";
const DEFAULT_SITE_KEY = "ID-Main";
const DEFAULT_PAGE_SIZE = 30;
const PAGE_SIZE_CAP = 100;
const DEFAULT_MAX_PAGES = 100;
const MAX_PAGES_CAP = 500;
const INTER_PAGE_DELAY_MS = 200;

/**
 * Resolve a positive integer configuration value and clamp it to a safe limit.
 * Invalid values use the fallback; the source-reported total cannot raise the cap.
 * @param {unknown} value - Raw configuration value.
 * @param {number} fallback - Default for invalid values.
 * @param {number} cap - Independent maximum permitted value.
 * @returns {number}
 */
function resolvePositiveInt(value, fallback, cap) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, cap) : fallback;
}

const ALLOWED_JOBSTREET_HOSTS = new Set([
  "id.jobstreet.com",
  "www.jobstreet.com",
  "www.jobstreet.co.id",
  "jobstreet.com",
  "jobstreet.co.id",
  "sg.jobstreet.com",
  "my.jobstreet.com",
  // SEEK's Hong Kong property keeps the JobsDB brand; same v5 search API.
  "hk.jobsdb.com",
  "www.seek.com.au",
  "www.seek.co.nz",
]);

// v5 API paths (the client-side JS on jobstreet uses these relative paths
// resolved against the current origin). We keep the allowlist for SSRF
// protection on the base URL, then build the v5 search path from it.
const V5_SEARCH_PATH = "/api/jobsearch/v5/search";

// Job-detail path by market. Only the Indonesian sites carry the `/id/` locale
// prefix (https://id.jobstreet.com/id/job/<id>). Every other SEEK-platform host
// — my/sg.jobstreet.com, www.seek.com.au, www.seek.co.nz — serves /job/<id> and
// answers 404 on /id/job/<id> (verified against live ids, 2026-08-28). A global
// switch either way breaks one market, which is why this is keyed on the host.
const ID_LOCALE_HOSTS = new Set([
  "id.jobstreet.com",
  "www.jobstreet.co.id",
  "jobstreet.co.id",
]);

/** @param {string} origin — scheme + hostname */
function jobDetailPath(origin) {
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    /* fall through to the common path */
  }
  return ID_LOCALE_HOSTS.has(host) ? "/id/job/" : "/job/";
}

/** @param {string} url */
function assertJobstreetUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobstreet: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:")
    throw new Error(`jobstreet: URL must use HTTPS: ${url}`);
  if (!ALLOWED_JOBSTREET_HOSTS.has(parsed.hostname))
    throw new Error(
      `jobstreet: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_JOBSTREET_HOSTS].join(", ")}`,
    );
  return url;
}

/**
 * Derive the origin from the API hostname.
 * e.g. id.jobstreet.com → https://id.jobstreet.com
 * @param {string} apiUrl
 * @returns {string}
 */
function deriveOrigin(apiUrl) {
  try {
    const parsed = new URL(apiUrl);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return "https://id.jobstreet.com";
  }
}

// NaN-safe Date.parse
/** @param {string | null | undefined} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse a single Jobstreet/SEEK v5 search API result into the canonical Job shape.
 *
 * The v5 search API returns objects shaped like:
 *   {
 *     id: "92996157",
 *     title: "Facility Engineer",
 *     advertiser: { id: "60960115", description: "PT YOFC International Indonesia" },
 *     companyName: "YOFC International",
 *     locations: [{ label: "Karawang, West Java", countryCode: "ID", ... }],
 *     listingDate: "2026-06-29T02:53:00Z",
 *     listingDateDisplay: "16h ago",
 *     roleId: "facilities-engineer",
 *     salaryLabel: "",
 *     teaser: "...",
 *     workTypes: ["Full time"],
 *     workArrangements: { data: [{ id: "1", label: { text: "On-site" } }] },
 *     ...
 *   }
 *
 * This parser is exported as a named export for unit tests.
 *
 * @param {any} item — raw v5 API result item
 * @param {string} origin — scheme + hostname for building job detail URLs
 * @param {string} fallbackCompany — company name fallback from the portal entry
 * @param {{appendWorkType?: boolean}} [options] - Whether to append the listing's work type to its title.
 *   title with the listing's `workTypes` (e.g. "[Part time]"); off by default
 * @returns {import('./_types.js').Job|null}
 */
export function parseJobstreetItem(
  item,
  origin,
  fallbackCompany,
  options = {},
) {
  if (!item || typeof item !== "object") return null;

  let title = (item.title || "").trim();
  if (!title) return null;

  if (options.appendWorkType) {
    const types = Array.isArray(item.workTypes)
      ? /** @type {unknown[]} */ (item.workTypes)
          .map((t) => String(t ?? "").trim())
          .filter(Boolean)
      : [];
    if (types.length) title = `${title} [${types.join(", ")}]`;
  }

  // Build job URL from the job ID — path prefix depends on the market host
  const jobId = (item.id || "").trim();
  if (!jobId) return null;
  const url = `${origin}${jobDetailPath(origin)}${jobId}`;

  // Validate URL hostname belongs to allowed set
  try {
    const parsed = new URL(url);
    if (!ALLOWED_JOBSTREET_HOSTS.has(parsed.hostname)) return null;
  } catch {
    return null;
  }

  // Prefer advertiser.description for the branded company name, fall back
  // to companyName (which can be shorter/less specific), then entry name.
  const company = (
    item.advertiser?.description ||
    item.companyName ||
    fallbackCompany ||
    ""
  ).trim();
  const location = (item.locations?.[0]?.label || "").trim();
  const postedAt = toEpochMs(item.listingDate);

  return {
    title,
    url,
    company,
    location,
    ...(postedAt != null ? { postedAt } : {}),
  };
}

/**
 * Build the v5 search URL with query parameters.
 * @param {string} origin — scheme + hostname
 * @param {{siteKey: string, keywords: string, location: string, pageSize: number, page: number}} params
 * @returns {string}
 */
function buildSearchUrl(origin, params) {
  const url = new URL(V5_SEARCH_PATH, origin);
  const { siteKey, keywords, location, pageSize, page } = params;
  if (siteKey) url.searchParams.set("siteKey", siteKey);
  if (keywords) url.searchParams.set("keywords", keywords);
  if (location) url.searchParams.set("where", location);
  url.searchParams.set("pageSize", String(pageSize || DEFAULT_PAGE_SIZE));
  url.searchParams.set("page", String(page || 1));
  return url.href;
}

/** @type {Provider} */
export default {
  id: "jobstreet",

  detect(_entry) {
    // Jobstreet is a job board aggregator, not a company ATS.
    // Auto-detection from careers_url is intentionally not supported —
    // use `provider: jobstreet` explicitly in portals.yml.
    return null;
  },

  /**
   * Fetch Jobstreet listings with bounded pagination and partial-result reporting.
   * @param {JobstreetEntry} entry - Portal configuration, including legacy options.
   * @param {import('./_types.js').Context} ctx - Provider transport and probe context.
   * @returns {Promise<JobstreetJobs>} Parsed jobs with optional truncation metadata.
   */
  async fetch(entry, ctx) {
    const apiUrl = entry.api || DEFAULT_API;
    assertJobstreetUrl(apiUrl);
    const origin = deriveOrigin(apiUrl);

    const siteKey = entry.siteKey || DEFAULT_SITE_KEY;
    const keywords = entry.searchKeywords || "";
    const searchLocation = entry.searchLocation || "";
    const pageSize = resolvePositiveInt(
      entry.pageSize,
      DEFAULT_PAGE_SIZE,
      PAGE_SIZE_CAP,
    );
    // YAML's canonical spelling is max_pages; retain maxPages for existing configs.
    const entryMaxPages = resolvePositiveInt(
      entry.max_pages ?? entry.maxPages,
      DEFAULT_MAX_PAGES,
      MAX_PAGES_CAP,
    );
    const probeCap =
      typeof ctx.maxPages === "number" &&
      Number.isSafeInteger(ctx.maxPages) &&
      ctx.maxPages > 0
        ? ctx.maxPages
        : null;
    const probing = probeCap !== null;
    const maxPages = Math.min(entryMaxPages, probeCap ?? Infinity);
    const fallbackCompany = entry.name || "";
    const appendWorkType = entry.appendWorkType === true;

    /** @type {JobstreetJobs} */
    const allJobs = [];
    let latestTotal = null;
    // A scan may keep earlier pages after a later request fails. Record why
    // results are partial so a fetch error is never confused with a page cap.
    /** @type {'complete' | 'cap' | 'fetch-error'} */
    let stopReason = "complete";

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const searchUrl = buildSearchUrl(origin, {
        siteKey,
        keywords,
        location: searchLocation,
        pageSize,
        page,
      });

      let json;
      try {
        json = /** @type {any} */ (
          await fetchJsonWithRetry(ctx, searchUrl, { redirect: "error" })
        );
      } catch (err) {
        // A health probe's budget errors must propagate unchanged. In a real
        // scan, keep earlier pages but make the partial result conspicuous.
        if (page === 1 || probing) throw err;
        console.warn(
          `jobstreet: page ${page} failed after retries — ${err instanceof Error ? err.message : String(err)}`,
        );
        stopReason = "fetch-error";
        break;
      }

      // Preserve the existing envelope behavior; response validation is a
      // separate concern from this pagination completeness fix.
      const data = Array.isArray(json?.data) ? json.data : [];
      if (data.length === 0) break;

      if (Number.isSafeInteger(json?.totalCount) && json.totalCount >= 0) {
        latestTotal = json.totalCount;
      }
      for (const item of data) {
        const job = parseJobstreetItem(item, origin, fallbackCompany, {
          appendWorkType,
        });
        if (job) allJobs.push(job);
      }

      // Use raw source rows, not successfully normalized rows. A short final
      // page is a natural stop even if the server's reported total is stale.
      if (data.length < pageSize) break;
      // A full boundary page is truncated unless totalCount says all matches
      // have been served. A total is advisory; it never drives an unbounded loop.
      if (
        !probing &&
        page === maxPages &&
        (latestTotal === null || page * pageSize < latestTotal)
      ) {
        stopReason = "cap";
      }
    }

    if (stopReason === "cap" && !probing) {
      console.warn(
        `jobstreet: stopped at max_pages=${entryMaxPages} with ${allJobs.length}${latestTotal === null ? "" : ` of ${latestTotal}`} jobs — raise max_pages on this entry for more`,
      );
    }
    if (stopReason !== "complete") {
      allJobs.jobstreetTruncated = { reason: stopReason };
    }
    return allJobs;
  },
};
