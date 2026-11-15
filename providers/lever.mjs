// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { coerceId } from './_ids.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { workplaceField } from './_workplace-type.mjs';
import { isWorkModelOnly } from './greenhouse.mjs';

// Lever provider — hits the public postings endpoint.
// Auto-detects from careers_url via jobs.(eu.)?lever.co/<slug>.
// Handles both explicit `api:` URLs and auto-detection from `careers_url`.

const ALLOWED_LEVER_HOSTS = new Set(['api.lever.co', 'api.eu.lever.co']);

// The v0 postings endpoint returns the whole board in one response, with every
// description inlined, so a large board outgrows _http.mjs's 10s default:
// jobgether is 42.8 MB and aborted at 10s on its own (#4177). Same value and
// reasoning as ASHBY_TIMEOUT_MS, the other one-response board-wide ATS feed.
// verify-portals.mjs probes Lever boards with it too, so both read the same board.
export const LEVER_TIMEOUT_MS = 30_000;

/** @param {string} url */
function assertLeverUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`lever: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`lever: URL must use HTTPS: ${url}`);
  if (!ALLOWED_LEVER_HOSTS.has(parsed.hostname))
    throw new Error(`lever: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_LEVER_HOSTS].join(', ')}`);
  return url;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveApiUrl(entry) {
  // Explicit api: wins — lets an entry keep a human-facing corporate
  // careers_url (e.g. https://www.coalfire.com/careers) while still pinning
  // the Lever postings board (mirrors greenhouse's api: precedence).
  if (entry.api) {
    assertLeverUrl(entry.api);
    return entry.api;
  }
  let url;
  try {
    url = new URL(entry.careers_url || '');
  } catch {
    return null;
  }
  const host = url.hostname.match(/^jobs\.((?:eu\.)?lever\.co)$/);
  if (!host) return null;
  const slug = url.pathname.split('/').filter(Boolean)[0];
  if (!slug) return null;
  return `https://api.${host[1]}/v0/postings/${slug}`;
}

// Same word edges as scan.mjs compileLocationKeyword, so "Remotely in Europe"
// does not count as already saying Remote.
const REMOTE_WORD_RE = /(?<![\p{L}\p{M}\p{N}])remote(?![\p{L}\p{M}\p{N}])/iu;

function resolveRawPlaces(categories) {
  const primary = typeof categories?.location === 'string' ? categories.location.trim() : '';
  const all = Array.isArray(categories?.allLocations)
    ? categories.allLocations.filter(l => typeof l === 'string' && l.trim()).map(l => l.trim())
    : [];
  const merged = [];
  for (const l of [primary, ...all]) {
    if (l && !merged.some(m => m.toLowerCase() === l.toLowerCase())) merged.push(l);
  }
  return merged;
}

/**
 * Deduplicated individual places from `categories.location` and `categories.allLocations`,
 * in order, case-insensitively deduped, without appended "Remote" or work models.
 * Exported for tests.
 * @param {any} categories
 * @returns {string[]}
 */
export function resolvePlaces(categories) {
  return resolveRawPlaces(categories).filter(l => !isWorkModelOnly(l));
}

/** Fold `categories.location` together with any extra `categories.allLocations`
 *  into one string. Lever puts a SINGLE primary city in `location`, and exposes
 *  the full set on multi-location postings in `allLocations` — reading only the
 *  former silently hides every other eligible location from scan.mjs's
 *  location_filter (e.g. a req open in Barcelona AND Montevideo looks
 *  Barcelona-only). Mirrors resolveLocation() in providers/remotli.mjs.
 *
 *  `workplaceType` is a top-level posting flag (`remote` | `hybrid` | `onsite`),
 *  not a location. A remote role whose city is "London" never contains the word
 *  Remote, so a filter that allows Remote drops it. Hybrid stays city-only:
 *  the office is still the place. Append once, and skip when a segment already
 *  says remote ("Remote — Europe").
 *  @param {any} categories
 *  @param {unknown} workplaceType */
function resolveLocation(categories, workplaceType) {
  const merged = resolveRawPlaces(categories);
  const remote = typeof workplaceType === 'string' && workplaceType.trim().toLowerCase() === 'remote';
  if (remote && !merged.some(m => REMOTE_WORD_RE.test(m))) merged.push('Remote');
  return merged.join('; ');
}

/**
 * The text the description filters (content_filter, its by_title_keyword
 * gates, visa_filter) match against: the same three parts browser-extract's
 * normalizeLeverJob() builds a JD from, in page order. `descriptionPlain` alone
 * is the intro only; the requirements live in `lists` and the trailing copy in
 * `additionalPlain`, both already in this board-wide payload. Lever also leaves
 * `descriptionPlain` empty while `description` holds the HTML (3817 of 3933
 * jobgether postings on 2026-10-10), so the intro falls back to that HTML.
 *
 * Exported for tests.
 *
 * @param {any} j - one posting from the v0 postings list
 * @returns {string}
 */
export function leverDescription(j) {
  const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : '');
  const intro = str(j?.descriptionPlain) || htmlToText(j?.description);
  const lists = Array.isArray(j?.lists)
    ? j.lists.map((/** @type {any} */ l) => [str(l?.text), htmlToText(l?.content)].filter(Boolean).join('\n'))
    : [];
  return [intro, ...lists, str(j?.additionalPlain)].filter(Boolean).join('\n\n');
}

// Annualization multipliers for Lever's salaryRange.interval values
// (lever/postings-api: salaryRange is { currency, interval, min, max }).
// Observed live on real boards: 'per-year-salary', 'per-hour-wage'. The
// rest follow Lever's per-{period}-{salary|wage} naming; an interval not
// in this table leaves salary off rather than guessing (same rule as
// ashby.mjs's INTERVAL_MULTIPLIERS lookup). Same annualization basis as
// Ashby: 40 h/week, 52 weeks/year, 5 days/week.
const LEVER_INTERVAL_MULTIPLIERS = {
  'per-hour-wage': 2080,
  'per-day-wage': 260,
  'per-week-wage': 52,
  'per-month-salary': 12,
  'per-year-salary': 1,
};

/**
 * Map a Lever posting's salaryRange to the Job.salary shape
 * ({ min, max, currency }, annualized), or undefined when the posting
 * carries no usable range. Follows parseCompensation() in ashby.mjs:
 * only a real number counts, a one-sided range fills the missing bound
 * from the other, bounds are ordered, and an unrecognised interval
 * leaves salary off.
 *
 * Exported for tests.
 *
 * @param {any} j - one posting from the v0 postings list
 * @returns {{min: number, max: number, currency: string} | undefined}
 */
export function leverSalary(j) {
  const range = j?.salaryRange;
  if (!range || typeof range !== 'object') return undefined;
  // An interval naming an inherited Object property (e.g. 'constructor')
  // resolves to a truthy non-number, which would annualize to NaN in
  // Job.salary. Require a string interval that is an own property of the
  // table, the way ashby.mjs guards its INTERVAL_MULTIPLIERS lookup.
  if (typeof range.interval !== 'string' || !Object.hasOwn(LEVER_INTERVAL_MULTIPLIERS, range.interval)) return undefined;
  const multiplier = LEVER_INTERVAL_MULTIPLIERS[/** @type {keyof typeof LEVER_INTERVAL_MULTIPLIERS} */ (range.interval)];
  if (!multiplier) return undefined;
  /** @param {unknown} v */
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const minValue = num(range.min);
  const maxValue = num(range.max);
  if (minValue === undefined && maxValue === undefined) return undefined;
  const annualizedMin = minValue !== undefined ? minValue * multiplier : undefined;
  const annualizedMax = maxValue !== undefined ? maxValue * multiplier : undefined;
  const resolvedMin = /** @type {number} */ (annualizedMin ?? annualizedMax);
  const resolvedMax = /** @type {number} */ (annualizedMax ?? annualizedMin);
  const currency = typeof range.currency === 'string' ? range.currency.trim().toUpperCase() : '';
  return {
    min: Math.min(resolvedMin, resolvedMax),
    max: Math.max(resolvedMin, resolvedMax),
    currency,
  };
}

/** @type {Provider} */
export default {
  id: 'lever',

  detect(entry) {
    try {
      const apiUrl = resolveApiUrl(entry);
      return apiUrl ? { url: apiUrl } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`lever: cannot derive API URL for ${entry.name}`);
    assertLeverUrl(apiUrl);
    // A very large board (Shield AI: 10.7 MB with full descriptions) exceeds the
    // body cap in one response. The v0 API pages with limit/skip, so read it in
    // slices instead of giving the board up. A one-page probe (ctx.maxPages === 1)
    // goes straight to a single bounded page rather than downloading the full
    // response first.
    const readPaged = async () => {
      /** @type {any[]} */
      const all = [];
      const PAGE = 100;
      const MIN_PAGE = 10;
      // Per-response cap: a smaller page may use the whole 4 MiB, so a board of uniformly
      // large postings still fits once the page is small enough (60 KiB x 50 < 4 MiB).
      // The aggregate bytes buffered across pages are bounded separately below.
      const PAGE_BYTES = 4 * 1024 * 1024;
      const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
      let totalBytes = 0;
      const probing = ctx.maxPages === 1;
      // Bounded: at most 30 pages' worth (3,000 postings), each response
      // capped at 4 MiB and the total at 64 MiB, so the fallback cannot buffer more however
      // the server behaves. A page over the 4 MiB cap is retried with a smaller limit, so
      // `requests` also bounds those shrink retries.
      const maxPages = Math.min(30, ctx.maxPages ?? 30);
      const maxPostings = maxPages * PAGE;
      const maxRequests = maxPages * 4;
      let pageSize = PAGE;
      let requests = 0;
      let lastPageFull = false;
      /** @type {'cap' | 'fetch-error' | null} */
      let truncated = null;
      // The board ended on its own (an empty or short page), as opposed to a stop
      // forced by the posting ceiling, the request budget or a failed page.
      let ended = false;
      /** @type {unknown} */
      let lastTooLarge = null;
      while (all.length < maxPostings && requests < maxRequests) {
        if (requests > 0) await sleep(250, ctx);
        requests++;
        const skip = all.length;
        const limit = Math.min(pageSize, maxPostings - skip);
        const pageUrl = new URL(apiUrl);
        pageUrl.searchParams.set('limit', String(limit));
        pageUrl.searchParams.set('skip', String(skip));
        let page;
        try {
          page = await fetchJsonWithRetry(ctx, assertLeverUrl(pageUrl.href), { redirect: 'error', timeoutMs: LEVER_TIMEOUT_MS, maxBytes: PAGE_BYTES });
        } catch (err) {
          // A page over the body cap: retry the same offset with a smaller limit.
          if (/** @type {any} */ (err)?.code === 'response_too_large' && pageSize > MIN_PAGE && requests < maxRequests) {
            lastTooLarge = err;
            pageSize = Math.max(MIN_PAGE, Math.floor(pageSize / 2));
            continue;
          }
          // First page, or a probe: propagate, so a dead board still reads as broken.
          // A later page that fails after retries keeps the postings already read,
          // flagged as truncated.
          if (skip === 0 || probing) throw err;
          console.warn(`[lever] ${entry.name}: page at skip=${skip} failed (${/** @type {any} */ (err)?.message || err}); keeping the ${all.length} posting(s) already read.`);
          truncated = 'fetch-error';
          lastPageFull = false;
          break;
        }
        if (!Array.isArray(page)) throw new Error(`lever: ${entry.name} returned a non-array page (${typeof page}) for skip=${skip}`);
        lastTooLarge = null;
        if (page.length === 0) { lastPageFull = false; ended = true; break; }
        // A server that ignores `limit` must not amplify the total: refuse the page.
        if (page.length > limit) throw new Error(`lever: ${entry.name} returned ${page.length} postings for limit=${limit}`);
        // UTF-8 bytes of the serialized page, checked before the page is retained, so the
        // aggregate bound is never exceeded by the page that crosses it.
        const pageBytes = Buffer.byteLength(JSON.stringify(page), 'utf8');
        if (totalBytes + pageBytes > MAX_TOTAL_BYTES) {
          console.warn(`[lever] ${entry.name}: stopped at the ${MAX_TOTAL_BYTES / (1024 * 1024)} MiB aggregate size bound (${all.length} postings); the board may have more.`);
          truncated = 'cap';
          lastPageFull = false;
          break;
        }
        for (const posting of page) all.push(posting);
        totalBytes += pageBytes;
        lastPageFull = page.length === limit;
        if (!lastPageFull) { ended = true; break; }
        if (probing) break;
        if (totalBytes >= MAX_TOTAL_BYTES) {
          console.warn(`[lever] ${entry.name}: stopped at the ${MAX_TOTAL_BYTES / (1024 * 1024)} MiB aggregate size bound (${all.length} postings); the board may have more.`);
          truncated = 'cap';
          lastPageFull = false;
          break;
        }
      }
      // Out of requests with nothing accepted: the board is unreadable, not empty.
      if (all.length === 0 && lastTooLarge) throw lastTooLarge;
      // Request budget spent (shrink retries included) before the board ended: a cap
      // stop, so warn and mark it. A probe asks for one page by design.
      if (!ended && !truncated && !probing && all.length < maxPostings && requests >= maxRequests) {
        console.warn(`[lever] ${entry.name}: stopped at the ${maxRequests}-request budget (${all.length} postings); the board may have more.`);
        truncated = 'cap';
      }
      // Cap stop, not completion: a full last page at the ceiling may mean more
      // postings exist. A probe (maxPages === 1) asks for one page by design.
      if (lastPageFull && !probing && all.length >= maxPostings) {
        console.warn(`[lever] ${entry.name}: stopped at the ${maxPages}-page ceiling (${all.length} postings); the board may have more.`);
        truncated = 'cap';
      }
      // leverTruncated carries why the walk stopped: 'cap' (ceiling or request budget)
      // or 'fetch-error' (a later page failed), so a caller can tell a truncated
      // healthy board from a broken one.
      if (truncated) /** @type {any} */ (all).leverTruncated = truncated;
      return all;
    };
    let json;
    if (ctx.maxPages === 1) {
      json = await readPaged();
    } else {
      try {
        json = await ctx.fetchJson(apiUrl, { redirect: 'error', timeoutMs: LEVER_TIMEOUT_MS });
      } catch (err) {
        if (/** @type {any} */ (err)?.code !== 'response_too_large') throw err;
        json = await readPaged();
      }
    }
    // [] is an empty board; any other body is a changed or failing API and must
    // not read as "no open roles" (ADDING_A_PROVIDER.md, "Defensive parsing").
    // readPaged() already throws on a non-array page.
    if (!Array.isArray(json)) {
      const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : json === null ? 'null' : typeof json;
      throw new Error(`lever: unexpected response for ${entry.name} — expected an array of postings, got: [${got}]`);
    }
    const boardSlug = new URL(apiUrl).pathname.match(/^\/v0\/postings\/([^/]+)\/?$/)?.[1] || '';
    const mapped = json.map(j => {
      const places = resolvePlaces(j.categories);
      const country = typeof j.country === 'string' && j.country.trim() ? j.country.trim() : undefined;
      return {
        title: j.text || '',
        url: j.hostedUrl || '',
        company: entry.name,
        listingIdentity: boardSlug && typeof j.id === 'string' && j.id.trim()
          ? { ats_provider: 'lever', board_slug: boardSlug, posting_id: j.id }
          : undefined,
        location: resolveLocation(j.categories, j.workplaceType),
        ...(places.length > 0 ? { locations: places } : {}),
        ...(country ? { country } : {}),
        // Lever's v0 postings list ships the full description for free (same
        // payload, no per-job request) — enables scan.mjs content_filter.
        description: leverDescription(j),
        postedAt: typeof j.createdAt === 'number' ? j.createdAt : undefined,
        // Lever's salaryRange ({ currency, interval, min, max }) maps to
        // Job.salary annualized; an unknown interval or no usable number
        // leaves salary off rather than guessing (#6907).
        salary: leverSalary(j),
        // Lever's posting uuid; the v0 board API exposes no employer requisition
        // field, so requisitionId stays unset rather than being inferred.
        externalId: coerceId(j.id),
        ...workplaceField(j.workplaceType),
      };
    });
    if (/** @type {any} */ (json).leverTruncated) /** @type {any} */ (mapped).leverTruncated = /** @type {any} */ (json).leverTruncated;
    return mapped;
  },
};
