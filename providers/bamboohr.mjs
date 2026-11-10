// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { safeEncodeURIComponent } from './_safe-url.mjs';

// BambooHR provider — hits the public per-tenant careers list API.
// Auto-detects from careers_url pattern `https://<tenant>.bamboohr.com[/...]`.
// Per-tenant subdomains are the variable part, so SSRF defence uses a regex
// match on `<safe-tenant>.bamboohr.com` rather than a static allowlist
// (same approach as the recruitee provider).
//
// The list endpoint (`/careers/list`) returns lightweight metadata — enough for
// the Job contract (title, url, location) at zero token cost. The full JD lives
// behind a second `/careers/<id>/detail` request, which fetch() deliberately
// skips to stay zero-token (so `description`/`postedAt` are omitted from the
// list pass). scan-ats-full.mjs's reverse sweep needs a date to apply its
// freshness window, so this also exports `enrichDate(job, ctx)` — called only
// for jobs that already passed the cheap title/location filters (same
// contract as providers/icims.mjs), so a full directory sweep pays the detail
// request for real candidates only, never for noise.
//
// fetch() uses redirect:'manual' on /careers/list (never auto-follows, so no
// SSRF exposure — same guarantee as redirect:'error') so a 3xx is
// diagnosable via err.status/err.location instead of a bare TypeError.
// Redirect signatures observed live (2026-09-21, sampled against 2,720
// BambooHR tenants with no public /careers/list): a bounce to bamboohr.com's
// own marketing site (92% of the sample) means the slug is not a real
// tenant; a bounce to an account-restriction path
// (/settings/account/suspended, /settings/account/temporarily_suspended,
// /offline.php, or an absolute .../expired.php) means the account is
// restricted — whenever the embed-widget feed below still lists jobs for
// one of these, its detail/apply pages (<origin>/careers/<id>) answer with
// BambooHR's employee-login page rather than the posting, for every sampled
// case with any listed job; a bounce to /login.php means the tenant's own
// bare-subdomain career page isn't public (its embed-widget feed answers
// with zero open positions, every sampled case), while some other
// integration (a customer-branded domain embedding the same tenant's
// widget, e.g. alessa.com for alessasatuit) may still be.
//
// A redirect therefore needs one more signal before it counts as absence:
// the marketing-site bounce is skipped straight to a synthetic 404 (it is
// 92% of a full sweep's volume, and confirmed dead by both signals every
// time sampled — the second request would be pure waste). Any other
// redirect probes <tenant>.bamboohr.com/jobs/embed2.php, the same public
// feed the embed widget calls: an empty `departments` array there means a
// live board with nothing open right now, kept out of dead-boards.mjs's
// cache so it gets re-probed every sweep instead of skipped for 30 days; a
// non-empty array carries the account-restriction signature (real job
// records, unreachable pages) and is mapped to the same synthetic 404 as a
// tenant that fails the probe outright, so dead-boards.mjs's cross-run
// cache (which only trusts a literal 404) treats it as dead — BambooHR never
// answers one itself for a redirected tenant, so without this remap the
// cache never engages.

const BAMBOOHR_HOST_RE = /^[a-z0-9][a-z0-9-]*\.bamboohr\.com$/;

/** @param {string} url */
function assertBambooHRUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`bamboohr: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`bamboohr: URL must use HTTPS: ${url}`);
  if (!BAMBOOHR_HOST_RE.test(parsed.hostname)) {
    throw new Error(`bamboohr: untrusted hostname "${parsed.hostname}" — must match <tenant>.bamboohr.com`);
  }
  return url;
}

/**
 * Resolve the tenant origin (`https://<tenant>.bamboohr.com`) from an entry.
 * Honours an explicit `api:` URL, else parses `careers_url`.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveOrigin(entry) {
  const rawApi = typeof entry.api === 'string' ? entry.api : '';
  const rawCareers = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  const raw = (rawApi || rawCareers).trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!BAMBOOHR_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}`;
}

/** @type {Provider} */
export default {
  id: 'bamboohr',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}/careers/list` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`bamboohr: cannot derive API URL for ${entry.name}`);
    const apiUrl = `${origin}/careers/list`;
    assertBambooHRUrl(apiUrl);
    // redirect:'manual' never auto-follows — the host check above still pins
    // the final hostname (SSRF) — and surfaces a 3xx as a normal response
    // (err.status/err.location, from _http.mjs's !res.ok branch) so the
    // catch below can read the redirect target instead of seeing a bare
    // TypeError.
    try {
      const json = /** @type {any} */ (await ctx.fetchJson(apiUrl, { redirect: 'manual' }));
      return parseBambooHRResponse(json, entry.name, origin);
    } catch (err) {
      if (typeof err?.status === 'number' && err.status >= 300 && err.status < 400) {
        // The marketing-site bounce is 92% of a full sweep's redirected
        // tenants and confirmed dead by the probe below every time sampled —
        // skip that extra request for this one well-confirmed target.
        if (/^https?:\/\/(www\.)?bamboohr\.com\/?$/i.test(String(err.location || ''))) {
          const deadErr = new Error(`bamboohr: /careers/list redirected (${err.status} -> ${err.location}) — no such tenant`);
          deadErr.status = 404;
          throw deadErr;
        }
        // Any other redirect (suspended account, login wall, ...) is not by
        // itself proof of absence — probe the embed-widget feed.
        if (await isLiveWithNoOpenings(origin, ctx)) return [];
        // Unreachable there too, or reachable with a populated board (the
        // suspended-account signature — see the header comment) — either
        // way, map to 404 so dead-boards.mjs's cache (which only trusts a
        // literal 404) treats this as dead, same as every other provider's
        // real 404.
        const deadErr = new Error(`bamboohr: /careers/list redirected (${err.status} -> ${err.location}) — no usable public postings`);
        deadErr.status = 404;
        throw deadErr;
      }
      throw err;
    }
  },

  /**
   * Enrich an undated job with its publish date from the detail endpoint.
   * job.url is the public share URL (`<origin>/careers/<id>`, built in
   * parseBambooHRResponse); the detail API lives one path segment further,
   * at `<origin>/careers/<id>/detail` (documented in modes/scan.md), so no
   * separate id needs to be threaded through the Job contract.
   *
   * Never throws on a missing/malformed date — the caller (scan-ats-full.mjs)
   * wraps this in try/catch and leaves the job undated on any failure, same
   * as providers/icims.mjs's enrichDate.
   *
   * @param {{url: string, postedAt?: number}} job
   * @param {import('./_types.js').ProviderCtx} ctx
   */
  async enrichDate(job, ctx) {
    const detailUrl = `${job.url}/detail`;
    assertBambooHRUrl(detailUrl);
    const json = /** @type {any} */ (await ctx.fetchJson(detailUrl, { redirect: 'error' }));
    const ts = Date.parse(json?.result?.jobOpening?.datePosted || '');
    if (!Number.isNaN(ts)) job.postedAt = ts;
  },
};

/**
 * Probe used when /careers/list redirects to anything other than the
 * marketing-site bounce. Calls the same public `/jobs/embed2.php` JSON feed
 * BambooHR's own embeddable Careers Page widget uses. Only ever used to
 * decide aliveness for dead-boards.mjs's cache — never to source job data:
 * a populated `departments` array here carries the account-restriction
 * signature, whose job.url (`<origin>/careers/<id>`, the same host
 * /careers/list already failed on) answers with BambooHR's employee-login
 * page rather than the posting — every one of the 8 tenants with any listed
 * job, out of the full 212-tenant population sampled live 2026-09-21, opened
 * that login page — so this is unusable for a scanner regardless of how many
 * jobs the feed reports, and is treated the same as no answer at all.
 *
 * @param {string} origin
 * @param {import('./_types.js').ProviderCtx} ctx
 * @returns {Promise<boolean>} true only for a confirmed-live, currently-empty board
 */
async function isLiveWithNoOpenings(origin, ctx) {
  const url = `${origin}/jobs/embed2.php?version=1.0.0&format=json`;
  try {
    const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error' }));
    return json?.success === true && Array.isArray(json.departments) && json.departments.length === 0;
  } catch {
    return false; // no parseable answer — not confirmed alive
  }
}

/**
 * Parse a BambooHR `/careers/list` response. Exported for unit tests.
 *
 * BambooHR returns:
 *   { meta: {...}, result: [{ id, jobOpeningName,
 *       location: { city?, state? }, isRemote?, employmentStatusLabel? }] }
 *
 * - url: built as `<origin>/careers/<id>` — matches the public
 *   `jobOpeningShareUrl`. Rows without a non-empty `id` are dropped (no stable
 *   URL, and url is the scanner's dedup key — a blank id would emit
 *   `/careers/` and collapse distinct postings together).
 * - location: join `city` + `state`; append "Remote" when `isRemote` is truthy.
 *   BambooHR's `isRemote` is `1`/`true` when set and `null` otherwise.
 *
 * @param {any} json
 * @param {string} companyName
 * @param {string} origin  e.g. "https://acme.bamboohr.com"
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseBambooHRResponse(json, companyName, origin) {
  const rows = json?.result;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(j => j && j.jobOpeningName && String(j.id ?? '').trim().length > 0)
    .map(j => {
      const loc = j.location || {};
      const remote = j.isRemote ? 'Remote' : '';
      const location = [loc.city, loc.state, remote].filter(Boolean).join(', ');
      const id = String(j.id).trim();
      // A lone surrogate in id throws URIError out of encodeURIComponent and
      // aborts this .map(), losing every job on the page. Drop this one on a
      // null; the trailing .filter(Boolean) removes it.
      const encodedId = safeEncodeURIComponent(id);
      if (encodedId === null) return null;
      return {
        title: String(j.jobOpeningName),
        url: `${origin}/careers/${encodedId}`,
        company: companyName,
        location,
      };
    })
    .filter(Boolean);
}
