// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Greenhouse provider — hits the public boards-api JSON endpoint.
// Handles both explicit `api:` URLs and auto-detection from `careers_url`.
// Requests the board with `content=true` (#3175) so each posting carries its
// full body as plain-text `description`; scan.mjs's content_filter,
// country_eligibility filter and visa_filter all read that field, and without
// it every Greenhouse board passed those filters blind.

import { htmlToText } from './_html-to-text.mjs';
import { coerceId } from './_ids.mjs';
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { intInRange } from './_config-utils.mjs';

// A board too big to read with every body inline (content=true) is read as the
// plain list instead (#6560). With the entry's opt-in
// (`greenhouse: { fetchDetails: true, detailLimit: 25 }`, the same shape as
// eploy.mjs), bodies are then fetched one posting at a time for just the
// postings this scan keeps (ctx.titleWanted), up to detailLimit, and never
// during a health probe (ctx.maxPages). Greenhouse documents both
// shapes: "GET /v1/boards/{board_token}/jobs" lists jobs, `?content=true`
// adds each job's full description, and "GET /v1/boards/{board_token}/jobs/{id}"
// returns one job with its content
// (https://developers.greenhouse.io/job-board.html#list-jobs, #retrieve-a-job).
// Anduril, 2026-11-07: 2,600 jobs; 45.7 MB with content=true, 2.7 MB without,
// ~10 KB per posting detail. The inline body grows with board size times
// description length, so the response cap is a board-size limit in disguise;
// the plain list and one detail per kept posting stay small at any size.
const DETAIL_DELAY_MS = 200; // ADDING_A_PROVIDER.md: 150-250 ms between sequential requests

/** @param {any} entry */
function parseDetailConfig(entry) {
  const cfg = entry?.greenhouse || {};
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, 25, 1, 100),
  };
}

const LEGACY_BOARD_HOSTS = new Set(['boards.greenhouse.io', 'boards.eu.greenhouse.io']);
const JOB_BOARD_HOSTS = new Set(['job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io']);

const ALLOWED_GREENHOUSE_HOSTS = new Set([
  'boards-api.greenhouse.io',
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io',
]);

/** @param {string} url */
function assertGreenhouseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`greenhouse: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`greenhouse: URL must use HTTPS: ${url}`);
  if (!ALLOWED_GREENHOUSE_HOSTS.has(parsed.hostname))
    throw new Error(`greenhouse: untrusted hostname "${parsed.hostname}" — must be one of: ${[...ALLOWED_GREENHOUSE_HOSTS].join(', ')}`);
  return url;
}

/** @param {import('./_types.js').PortalEntry} entry */
function resolveApiUrl(entry) {
  if (entry.api) {
    assertGreenhouseUrl(entry.api);
    return entry.api;
  }
  const url = entry.careers_url || '';
  // job-boards[.eu].greenhouse.io/<slug>, and the legacy boards[.eu] host that
  // still 301s there with the same slug. Both are read from the PARSED url,
  // never a regex over the raw string. That one found
  // "boards.greenhouse.io/acme" inside the path of a boards-api URL and
  // returned acme's board, and its job-boards twin did the same for any
  // careers_url that merely mentioned a board: a redirect wrapper
  // (`?next=https://job-boards.greenhouse.io/othercorp`) or a path segment on
  // another site scanned othercorp's board under this entry's name.
  // http: is still accepted on the job-boards host, as the regex accepted it;
  // the API call below is https either way.
  let slug = null;
  try {
    const parsed = new URL(url);
    const boardHost = (JOB_BOARD_HOSTS.has(parsed.hostname) && (parsed.protocol === 'https:' || parsed.protocol === 'http:'))
      || (LEGACY_BOARD_HOSTS.has(parsed.hostname) && parsed.protocol === 'https:');
    if (boardHost) slug = parsed.pathname.split('/').find(Boolean) ?? null;
  } catch {
    // unparseable url: no board to read
  }
  // Embed boards carry the token in ?for= (e.g. /embed/job_board?for=stripe).
  // The path segment is literally "embed", which resolves to a nonexistent
  // board and 404s — the token is the only usable slug.
  if (!slug || slug === 'embed') {
    try {
      // Only a Greenhouse URL names a board in ?for=: on any other site the param
      // is unrelated (example.com/jobs?for=stripe) and must not select a board.
      slug = new URL(assertGreenhouseUrl(url)).searchParams.get('for');
    } catch {
      // unparseable, non-HTTPS or non-Greenhouse URL: no board to read
    }
  }
  if (!slug || slug === 'embed') return null;
  return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// The documented envelope is { jobs: [...] }. Only that container, present and
// empty, is an empty board; anything else ({}, { error }, { jobs: null }, a bare
// string) is an API change or an error served with a 200, and returning [] for
// it would read as "no open roles" on every scan (ADDING_A_PROVIDER.md,
// "Defensive parsing").
/** @param {any} json @param {{ name: string }} entry @returns {any[]} */
function boardJobs(json, entry) {
  if (json && Array.isArray(json.jobs)) return json.jobs;
  const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : json === null ? 'null' : typeof json;
  throw new Error(`greenhouse: unexpected response for ${entry.name} — expected jobs[], got: [${got}]`);
}

// ── Office enrichment ───────────────────────────────────────────────
// Some Greenhouse boards put the *work model* ("Hybrid", "In-Office",
// "Distributed") in location.name and keep the actual city in the separate
// offices[] array — which the /jobs list endpoint does not return. For those
// boards scan.mjs's location_filter never sees a city, so every role is
// evaluated against the string "Hybrid" and silently dropped. Same bug class
// as #1073 (Ashby dropping secondaryLocations), different provider.
//
// The city is recoverable from /v1/boards/{slug}/offices, which nests
// offices → departments → jobs and costs one extra request. That request is
// only worth making for boards that actually exhibit the pattern: boards
// already reporting real cities pay nothing (Datadog's /offices is 2.8MB).

// /offices gets its own ceiling. It repeats the board's job list once per
// office in the nested tree, so it outgrows the shared 10 MB / 10 s defaults
// long before /jobs does: Stripe's was 29.2 MB on 2026-11-09 for a 769-job
// board, and every run aborted, leaving each Stripe role as a bare "Hybrid"
// the location filter cannot place. 64 MB / 60 s leaves 2x headroom on the
// largest board seen while still bounding a hostile endpoint.
export const OFFICES_MAX_BYTES = 64 * 1024 * 1024;
export const OFFICES_TIMEOUT_MS = 60_000;

const WORK_MODEL = /^(?:hybrid|in[-\s]?office|on[-\s]?site|distributed|remote|flexible)$/i;

/**
 * True when a location string carries a work model but no geography at all
 * ("Hybrid", "Distributed; Hybrid"). Anything with a place in it
 * ("Hybrid - London", "Remote (Canada)") is already filterable and is left
 * alone, so enrichment can never rewrite a location that was working.
 * @param {unknown} name
 */
export function isWorkModelOnly(name) {
  if (typeof name !== 'string') return false;
  const parts = name.split(';').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(p => WORK_MODEL.test(p));
}

/**
 * boards/{slug}/jobs → boards/{slug}/offices. Returns null for any other
 * shape (e.g. a single-job URL), which disables enrichment rather than
 * guessing at an endpoint.
 * @param {string} apiUrl
 */
export function officesUrlFor(apiUrl) {
  const m = apiUrl.match(/^(https:\/\/[^/]+\/v1\/boards\/[^/]+)\/jobs(?:$|[?#])/);
  return m ? `${m[1]}/offices` : null;
}

/**
 * Build jobId → Set(office names) by walking offices → departments → jobs.
 * A job listed under several offices collects all of them, which is how a
 * genuinely multi-site role keeps every city it is open to.
 * @param {any} json
 */
export function buildOfficeMap(json) {
  /** @type {Map<any, Set<string>>} */
  const map = new Map();
  /** @param {any} offices */
  const walk = (offices) => {
    if (!Array.isArray(offices)) return;
    for (const office of offices) {
      if (!office || typeof office !== 'object') continue;
      const name = typeof office.name === 'string' ? office.name.trim() : '';
      if (name) {
        for (const dept of Array.isArray(office.departments) ? office.departments : []) {
          for (const job of Array.isArray(dept?.jobs) ? dept.jobs : []) {
            if (!job || job.id == null) continue;
            if (!map.has(job.id)) map.set(job.id, new Set());
            map.get(job.id).add(name);
          }
        }
      }
      walk(office.children);
    }
  };
  walk(json?.offices);
  return map;
}

// ── Posting body → plain text ────────────────────────────────────────
// With content=true the list response embeds each posting's body as
// DOUBLE-encoded HTML: the JSON string carries entity-escaped markup
// (`&lt;p&gt;`), so the first decode pass reveals the real tags, and
// text-level entities (`&amp;`, `&#39;`) only become decodable once those
// tags are gone. That pipeline (and its rationale) now lives in
// _html-to-text.mjs, shared with the providers added in #3175's phase 2;
// this wrapper keeps greenhouse's tested export name.

/**
 * Entity-decoded markup → stripped plain text. Exported for tests.
 * @param {unknown} content
 */
export function contentToText(content) {
  return htmlToText(content);
}

/** @type {Provider} */
export default {
  id: 'greenhouse',

  detect(entry) {
    try {
      const apiUrl = resolveApiUrl(entry);
      return apiUrl ? { url: apiUrl } : null;
    } catch {
      return null;
    }
  },

  // Titles, URLs and dates only: the same list without content=true, and no
  // /offices lookup. A fraction of fetch()'s bytes (5 live boards sampled
  // 2026-10-07: 99 KB against 1.67 MB). scan-ats-full.mjs uses it to rule a
  // board out before paying for fetch(); nothing here is filtered on.
  async fetchListing(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`greenhouse: cannot derive API URL for ${entry.name}`);
    assertGreenhouseUrl(apiUrl);
    // An entry.api that pins content=true must not turn this back into the
    // expensive request.
    const listUrl = new URL(apiUrl);
    listUrl.searchParams.delete('content');
    const json = /** @type {any} */ (await ctx.fetchJson(assertGreenhouseUrl(listUrl.href), { redirect: 'error' }));
    const jobs = boardJobs(json, entry);
    return jobs
      .filter(/** @param {any} j */ j => j.absolute_url)
      .map(/** @param {any} j */ j => ({ title: j.title || '', url: j.absolute_url, postedAt: toEpochMs(j.first_published) }));
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`greenhouse: cannot derive API URL for ${entry.name}`);
    assertGreenhouseUrl(apiUrl);
    // content=true embeds each posting's body in the list response (one
    // request, no per-job detail fetches). searchParams.set is idempotent, so
    // an entry.api that already pins the param can't end up with a duplicate.
    const listUrl = new URL(apiUrl);
    listUrl.searchParams.set('content', 'true');
    // Re-validate the final href: the guard chain runs on the exact string
    // that goes over the wire, not just the pre-param base.
    const listHref = assertGreenhouseUrl(listUrl.href);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertGreenhouseUrl above it guarantees the final hostname stays in the allowlist.
    /** @type {any} */
    let json;
    let bodiesInline = true;
    try {
      json = await ctx.fetchJson(listHref, { redirect: 'error' });
    } catch (err) {
      // A board with thousands of postings (SpaceX, Anduril) exceeds the body cap
      // once every posting body is embedded. Fall back to titles, URLs and dates:
      // the same list without content=true. Only an oversized body changes the
      // plan; every other failure is the board's, and stays loud.
      if (/** @type {any} */ (err)?.code !== 'response_too_large') throw err;
      const bare = new URL(apiUrl);
      bare.searchParams.delete('content');
      json = await ctx.fetchJson(assertGreenhouseUrl(bare.href), { redirect: 'error' });
      bodiesInline = false;
    }
    const jobs = boardJobs(json, entry);
    const usable = jobs.filter(/** @param {any} j */ j => j.absolute_url);
    const boardSlug = new URL(apiUrl).pathname.match(/^\/v1\/boards\/([^/]+)\/jobs\/?$/)?.[1] || '';

    if (!bodiesInline) {
      const { fetchDetails, detailLimit } = parseDetailConfig(entry);
      const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
      const titleWanted = typeof ctx?.titleWanted === 'function' ? ctx.titleWanted : null;
      if (!fetchDetails || probing || !titleWanted || !boardSlug) {
        // No opt-in, a probe, or no title filter to narrow the reads to: the
        // board stays readable, but description-based filters (content_filter,
        // visa, country eligibility) cannot judge these postings. Say so.
        if (!probing) console.warn(`[greenhouse] ${entry.name}: board too large for content=true; read without descriptions, so description-based filters (content_filter, visa, country eligibility) cannot judge these postings.${fetchDetails ? '' : ' Set greenhouse.fetchDetails: true on this entry to fetch bodies for title-matched postings.'}`);
      } else {
        const wanted = usable.filter(/** @param {any} j */ j => j.id != null && titleWanted(j.title || ''));
        const candidates = wanted.slice(0, detailLimit);
        let attempted = 0;
        let filled = 0;
        for (const j of candidates) {
          // Paced on attempts, not successes, so a run of failures is no burst.
          if (attempted > 0) await sleep(DETAIL_DELAY_MS, ctx);
          attempted++;
          try {
            // Built on the list URL's own path, so a board slug that arrived
            // percent-encoded stays encoded once rather than twice.
            const detailRef = new URL(apiUrl);
            detailRef.search = '';
            detailRef.pathname = `${detailRef.pathname.replace(/\/+$/, '')}/${encodeURIComponent(String(j.id))}`;
            const detailUrl = assertGreenhouseUrl(detailRef.href);
            const detail = /** @type {any} */ (await fetchJsonWithRetry(ctx, detailUrl, { redirect: 'error' }));
            if (detail && typeof detail.content === 'string') { j.content = detail.content; filled++; }
          } catch {
            // One posting's body is enrichment: after the retries, keep the
            // posting without it rather than lose it, and never the board.
          }
        }
        console.error(`ℹ️  greenhouse: ${entry.name} board too large to read with bodies inline; read the plain list (${usable.length} jobs) and fetched bodies for ${filled} of ${wanted.length} title-matched${wanted.length > detailLimit ? ` (capped at detailLimit ${detailLimit})` : ''}`);
      }
    }

    // Only pay for /offices when this board actually hides its cities there.
    let officeMap = null;
    if (usable.some(/** @param {any} j */ j => isWorkModelOnly(j.location?.name))) {
      const officesUrl = officesUrlFor(apiUrl);
      if (officesUrl) {
        try {
          assertGreenhouseUrl(officesUrl);
          officeMap = buildOfficeMap(await ctx.fetchJson(officesUrl, { redirect: 'error', maxBytes: OFFICES_MAX_BYTES, timeoutMs: OFFICES_TIMEOUT_MS }));
        } catch (err) {
          // No /offices on this board, or it failed — fall back to the bare
          // work-model string. Enrichment is best-effort; a scan must never
          // fail because the secondary lookup did. Logged so a persistent
          // regression is distinguishable from a board that simply has no
          // /offices, which is expected and harmless.
          // `err` is not guaranteed to be an Error — a promise may reject with
          // anything, and reading .message off null would throw *inside* the
          // catch, defeating the guarantee above.
          const cause = err instanceof Error ? err.message : String(err);
          console.error(`⚠️  greenhouse: ${entry.name} /offices enrichment failed — ${cause} (keeping work-model-only locations)`);
          officeMap = null;
        }
      }
    }

    return usable.map(/** @param {any} j */ (j) => {
      let location = j.location?.name || '';
      if (officeMap && isWorkModelOnly(location)) {
        const offices = officeMap.get(j.id);
        // Sorted, not in /offices traversal order. The set is built by walking
        // the office tree, so the order is Greenhouse's, and it is not promised
        // to be stable between responses. Unsorted, a board that re-orders its
        // offices rewrites this string, which changes the posting's location
        // dedupe key (scan.mjs `normalizeLocationForDedup`) and the row already
        // written to scan-history.tsv — so a posting nothing changed about
        // reads as new. Sorting costs nothing and removes the dependency.
        if (offices && offices.size > 0) location = [location, ...[...offices].sort()].join(' · ');
      }
      const description = contentToText(j.content);
      return {
        title: j.title || '',
        url: j.absolute_url,
        company: entry.name,
        listingIdentity: boardSlug && (typeof j.id === 'string' || (typeof j.id === 'number' && Number.isSafeInteger(j.id)))
          ? { ats_provider: 'greenhouse', board_slug: boardSlug, posting_id: String(j.id) }
          : undefined,
        // Native identifiers, captured verbatim at ingest. `requisition_id` is the
        // employer's own req id and is what survives a repost or an ATS host move
        // (schema.org/JobPosting `identifier`); `id` is the board-post id.
        externalId: coerceId(j.id),
        requisitionId: coerceId(j.requisition_id),
        location,
        // Omitted entirely when the board ships no body — same shape as
        // cryptocurrencyjobs/remotli, so "no signal" stays distinguishable
        // from an empty string downstream.
        ...(description ? { description } : {}),
        postedAt: toEpochMs(j.first_published),
      };
    });
  },
};
