// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Eightfold AI provider — hits the public per-tenant Talent Acquisition JSON
// API (zero-auth GET, no token or cookie). Eightfold hosts branded career
// sites for large enterprises (Bayer, Vodafone, PepsiCo, Autodesk, Micron, …).
//
// Host pattern (per-tenant):
//   <tenant>.eightfold.ai        e.g. bayer.eightfold.ai
//
// Career page URL:
//   https://<tenant>.eightfold.ai/careers[?domain=<domain>]
// Many tenants also front the same board on a branded CNAME
// (careers.<company>.com). That host is deliberately NOT accepted: the API is
// host-pinned to *.eightfold.ai, so an entry must point at the canonical
// tenant host. Set `careers_url` (or `api`) to the eightfold.ai form.
//
// JSON API (GET, zero-auth):
//   https://<tenant>.eightfold.ai/api/apply/v2/jobs
//   ?domain=<domain>&start=<n>&num=<n>
//   `domain` is OPTIONAL — the server infers it from the tenant host and
//   echoes it back as `domain` in the response, so omitting it still returns
//   that tenant's board. It is still sent when the entry supplies one,
//   because multi-brand tenants scope their board by it.
//   Response: { positions: [...], count: <total>, domain: "<domain>" }.
//   Per position: id, name, posting_name, location, locations[], department,
//   business_unit, t_create/t_update (epoch SECONDS), canonicalPositionUrl,
//   display_job_id.
//
// PAGE SIZE IS SERVER-CAPPED AT 10. Requesting num=25/50/100/200 all return
// exactly 10 rows (measured against a 616-posting tenant). So a large board
// costs count/10 requests; the page cap below is what keeps that bounded, and
// `max_pages` on the entry raises it for a genuinely huge tenant.
//
// Known limitation: several tenants front the API with a WAF that 403s
// datacenter/cloud egress IPs. That is an environment/IP issue, not a provider
// bug — the same request succeeds from a residential IP. A browser-like
// User-Agent is sent to reduce (not eliminate) the friction.

import { BROWSER_LIKE_USER_AGENT, fetchJsonWithRetry } from './_http.mjs';
import { coerceId } from './_ids.mjs';

const EIGHTFOLD_HOST_RE = /^[a-z0-9-]+\.eightfold\.ai$/i;

// The API refuses to return more than 10 rows per request regardless of `num`.
const PAGE_SIZE = 10;
// Safety cap on pagination, applied regardless of what `count` claims, so a
// misbehaving or compromised API cannot drive an unbounded request loop.
// 200 pages = 2,000 postings; override with `max_pages` on the portal entry.
const DEFAULT_MAX_PAGES = 200;
// Hard ceiling even for an explicit override (10,000 postings).
const MAX_PAGES_CAP = 1000;
// Same-host pacing between pages inside one tenant's own pagination loop.
// Eightfold's edge rate-limits bursts, and a 616-job board is 62 requests.
const INTER_PAGE_DELAY_MS = 250;

const RETRY_POLICY = { retries: 3, baseDelayMs: 500, maxDelayMs: 8_000 };

/**
 * SSRF guard — every request URL passes through here before it is fetched.
 *
 * @param {string} url
 * @returns {string} the same URL, when it is a trusted Eightfold endpoint.
 */
function assertEightfoldUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`eightfold: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`eightfold: URL must use HTTPS: ${url}`);
  if (!EIGHTFOLD_HOST_RE.test(parsed.hostname)) {
    throw new Error(`eightfold: untrusted hostname "${parsed.hostname}" — must match *.eightfold.ai`);
  }
  return url;
}

/** @param {number} ms @param {any} ctx */
function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Eightfold reports timestamps as epoch SECONDS (`t_create`, `t_update`), not
 * the ISO strings every other provider gets. Converted here; anything
 * non-finite or non-positive is dropped rather than guessed at.
 *
 * @param {unknown} value
 * @returns {number|undefined} epoch ms, or undefined.
 */
function epochSecondsToMs(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 1000);
}

/**
 * Resolve the tenant host from a portal entry. `entry.api` takes precedence
 * over `entry.careers_url` (mirrors greenhouse/ashby/oraclecloud) so a branded
 * careers page can stay as careers_url while the tenant host is pinned via
 * api:. An explicit `entry.domain` overrides any `?domain=` in the URL.
 *
 * @param {import('./_types.js').PortalEntry & {domain?: string}} entry
 * @returns {{host: string, domain: (string|null)}|null}
 */
export function resolveTenant(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    if (!EIGHTFOLD_HOST_RE.test(parsed.hostname)) continue;

    const override = typeof entry.domain === 'string' && entry.domain.trim()
      ? entry.domain.trim()
      : null;
    const fromUrl = parsed.searchParams.get('domain');
    const domain = override || (fromUrl && fromUrl.trim() ? fromUrl.trim() : null);

    return { host: parsed.hostname.toLowerCase(), domain };
  }
  return null;
}

/**
 * Build the jobs API URL for one page.
 *
 * @param {{host: string, domain?: (string|null)}} tenant
 * @param {number} [start] - Row offset (0-based).
 * @param {number} [num]   - Requested page size; the server caps it at 10.
 * @returns {string}
 */
export function buildApiUrl(tenant, start = 0, num = PAGE_SIZE) {
  const params = new URLSearchParams();
  if (tenant.domain) params.set('domain', tenant.domain);
  params.set('start', String(start));
  params.set('num', String(num));
  return `https://${tenant.host}/api/apply/v2/jobs?${params.toString()}`;
}

/**
 * Build the PCSX jobs URL for one page, on the SAME pinned tenant host.
 *
 * Eightfold is migrating tenants from `/api/apply/v2/jobs` to `/api/pcsx/search`.
 * A tenant serves exactly one of the two and says so in a 403 body:
 *   v2 on a migrated tenant   -> {"message": "Not authorized for PCSX"}
 *   pcsx on a classic tenant  -> {"message": "PCSX is not enabled for this user."}
 * Both paths are explicitly allowed by tenant robots.txt (`Allow: /api/apply`,
 * `Allow: /api/pcsx`), and both live on the same `*.eightfold.ai` host this
 * module already pins, so no new trust surface is introduced.
 *
 * @param {{host: string, domain?: (string|null)}} tenant
 * @param {number} [start] - Row offset (0-based).
 * @returns {string}
 */
export function buildPcsxUrl(tenant, start = 0) {
  const params = new URLSearchParams();
  if (tenant.domain) params.set('domain', tenant.domain);
  params.set('start', String(start));
  return `https://${tenant.host}/api/pcsx/search?${params.toString()}`;
}

/**
 * Normalize one `/api/pcsx/search` page into the same envelope the v2 parser
 * consumes: PCSX nests the payload one level deeper under `data`.
 *
 * Shape detection, NOT message matching. Eightfold returns only a free-text
 * `message` on its 403s, and text like that is not a contract: the day they
 * reword it, a string match silently stops working. A well-formed
 * `data.positions` array is the capability check that cannot drift
 * (the reason Google's own API guidance, AIP-193, tells clients to key on a
 * machine-readable reason rather than on `message`).
 *
 * @param {any} json
 * @returns {{positions: any[], count: (number|undefined)} | null} null when the
 *   body is not a recognizable PCSX page.
 */
export function normalizePcsxPage(json) {
  const data = json && typeof json === 'object' ? /** @type {any} */ (json).data : null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.positions)) return null;
  return { positions: data.positions, count: typeof data.count === 'number' ? data.count : undefined };
}

/**
 * Fallback posting URL for a position with no `canonicalPositionUrl`.
 *
 * @param {{host: string, domain?: (string|null)}} tenant
 * @param {string} pid
 * @returns {string}
 */
export function buildJobUrl(tenant, pid) {
  const params = new URLSearchParams();
  params.set('pid', pid);
  if (tenant.domain) params.set('domain', tenant.domain);
  return `https://${tenant.host}/careers?${params.toString()}`;
}

/**
 * Assemble a location string. Prefers the flat `location` field, else joins
 * the `locations[]` array. Deduped, joined with " · " like ashby's
 * secondaryLocations handling so scan.mjs's location_filter sees every city
 * a multi-site role is open to.
 *
 * @param {any} p
 * @returns {string}
 */
function assembleLocation(p) {
  const parts = [];
  if (typeof p.location === 'string' && p.location.trim()) parts.push(p.location.trim());
  if (Array.isArray(p.locations)) {
    for (const loc of p.locations) {
      if (typeof loc === 'string' && loc.trim()) parts.push(loc.trim());
    }
  }
  return [...new Set(parts)].join(' · ');
}

/**
 * Pure normalizer for one `/api/apply/v2/jobs` response. Exported for unit
 * tests. Returns [] for null / {} / non-array / {positions: null}.
 *
 * Drop rules (a dropped row is silently omitted, never emitted half-formed):
 *   - no title (`name`, falling back to `posting_name`)
 *   - no usable https URL — `canonicalPositionUrl` must parse as https:, and
 *     when it is absent/unusable there must be an `id` to build the tenant
 *     fallback URL from. The URL is the dedup key downstream.
 *
 * `canonicalPositionUrl` frequently points at a branded host
 * (talent.bayer.com), not eightfold.ai. That is accepted: these URLs are
 * display-only — written to pipeline/history, never fetched by the scanner —
 * exactly as jobvite.mjs treats its applyURLs. Host-pinning applies to
 * endpoints WE request, not to links we merely record.
 *
 * @param {unknown} json
 * @param {{host: string, domain?: (string|null)}} tenant
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseEightfoldResponse(json, tenant, companyName) {
  if (!json || typeof json !== 'object') return [];
  const positions = /** @type {any} */ (json).positions;
  if (!Array.isArray(positions)) return [];

  const out = [];
  for (const p of positions) {
    if (!p || typeof p !== 'object') continue;

    const title = (typeof p.name === 'string' && p.name.trim())
      ? p.name.trim()
      : (typeof p.posting_name === 'string' ? p.posting_name.trim() : '');
    if (!title) continue;

    let url = '';
    const canonical = typeof p.canonicalPositionUrl === 'string' ? p.canonicalPositionUrl.trim() : '';
    if (canonical) {
      try {
        const parsed = new URL(canonical);
        if (parsed.protocol === 'https:') url = parsed.href;
      } catch {
        // malformed — fall through to the tenant fallback
      }
    }
    if (!url) {
      const pid = p.id != null && `${p.id}`.trim() ? `${p.id}`.trim() : '';
      if (pid) url = buildJobUrl(tenant, pid);
    }
    if (!url) continue;

    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = {
      title,
      url,
      company: companyName,
      location: assembleLocation(p),
    };
    const postedAt = epochSecondsToMs(p.t_create) ?? epochSecondsToMs(p.t_update);
    if (postedAt !== undefined) job.postedAt = postedAt;

    // ATS-native identifier capture. Eightfold's own position id, plus
    // the customer's upstream-ATS id when the tenant exposes one. Type-guarded
    // like every other provider here — an unguarded String() coerced a tenant
    // returning an object into the literal "[object Object]" and wrote that
    // into the req: segment as though it were an id.
    // ats_job_id is deliberately NOT in this chain. It is the customer's upstream
    // REQ id, which is many-to-one with postings (see requisitionId in _types.js),
    // so falling back to it would hand a consumer asking for per-posting identity a
    // key that two sibling postings share. No posting id is better than a wrong one.
    // Coerce each candidate on its own: `p.id ?? p.position_id` hands coerceId a
    // present-but-unusable `id` (an object, an empty string) and never reaches the
    // valid sibling, so the posting loses an id it had (CodeRabbit, #4076).
    const ext = coerceId(p.id) ?? coerceId(p.position_id);
    if (ext) job.externalId = ext;
    const req = coerceId(p.ats_job_id);
    if (req) job.requisitionId = req;

    out.push(job);
  }
  return out;
}

/**
 * Resolve the page cap: a positive integer `max_pages` on the entry, capped
 * at MAX_PAGES_CAP; then narrowed further by ctx.maxPages when the caller is
 * only probing (verify-portals.mjs's health check passes 1).
 *
 * @param {any} entry
 * @param {any} ctx
 * @returns {number}
 */
function resolveMaxPages(entry, ctx) {
  const v = entry?.max_pages;
  const fromEntry = Number.isInteger(v) && v > 0 ? Math.min(v, MAX_PAGES_CAP) : DEFAULT_MAX_PAGES;
  const hint = Number(ctx?.maxPages);
  return Number.isFinite(hint) && hint > 0 ? Math.min(fromEntry, Math.floor(hint)) : fromEntry;
}

/** @type {Provider} */
export default {
  id: 'eightfold',

  detect(entry) {
    try {
      const tenant = resolveTenant(entry);
      return tenant ? { url: buildApiUrl(tenant, 0, PAGE_SIZE) } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) throw new Error(`eightfold: cannot derive API URL for ${entry.name}`);

    const maxPages = resolveMaxPages(entry, ctx);
    const all = [];
    /** @type {number|null} */
    let total = null;
    // Which API this tenant serves, decided once per fetch and reused for every
    // page: 'v2' until a 403 proves otherwise, then 'pcsx' if the PCSX endpoint
    // answers with a well-formed page.
    let api = 'v2';
    let rateLimited = false;

    for (let page = 0; page < maxPages; page++) {
      const start = page * PAGE_SIZE;
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);

      /** One request on whichever API this tenant is on. */
      const request = async (/** @type {string} */ which) => {
        const url = which === 'pcsx' ? buildPcsxUrl(tenant, start) : buildApiUrl(tenant, start, PAGE_SIZE);
        assertEightfoldUrl(url); // SSRF guard before every fetch
        return /** @type {any} */ (await fetchJsonWithRetry(
          /** @type {any} */ (ctx),
          url,
          {
            // redirect:'error' prevents SSRF via a server-side redirect; with
            // assertEightfoldUrl above it guarantees the final hostname stays
            // inside *.eightfold.ai.
            redirect: 'error',
            headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, Accept: 'application/json' },
          },
          RETRY_POLICY,
        ));
      };

      let json;
      try {
        json = await request(api);
      } catch (err) {
        const status = /** @type {any} */ (err)?.status;
        // A 403 on the classic endpoint is how a migrated tenant announces
        // itself. It is deterministic, never retried (RFC 9110 §15.5.4, and
        // _http.mjs's isRetryableError agrees), so it is a safe point to switch
        // APIS ONCE rather than to give up: before this, every PCSX tenant read
        // as the WAF case below and the board silently returned zero postings.
        if (api === 'v2' && status === 403) {
          let pcsxJson = null;
          try {
            pcsxJson = await request('pcsx');
          } catch (probeErr) {
            // PCSX refusing too (403) makes the original 403 the real story: a
            // WAF or datacenter-IP block. Any other probe failure — a 429, a 5xx,
            // a network error — is its own problem, and reporting the v2 403 in
            // its place would read as a deterministic block when the tenant is
            // only busy or down.
            if (/** @type {any} */ (probeErr)?.status === 403) throw err;
            throw probeErr;
          }
          const page0 = normalizePcsxPage(pcsxJson);
          if (!page0) {
            // A 200 that is not a PCSX page means the endpoint moved again.
            // Fail loudly with the 403 attached rather than returning nothing.
            throw new Error(
              `eightfold: ${entry.name} answered 403 on /api/apply/v2/jobs and an unrecognized body on /api/pcsx/search — neither API is readable`,
              { cause: err },
            );
          }
          api = 'pcsx';
          json = { positions: page0.positions, ...(page0.count === undefined ? {} : { count: page0.count }) };
        } else if (status === 429 && all.length > 0) {
          // Large PCSX tenants rate-limit a sustained walk (measured: Microsoft
          // 429s after ~20 pages at 1 req/s even with backoff). Keep the pages
          // already collected and say the board is partial — never silently.
          rateLimited = true;
          break;
        } else {
          throw err;
        }
      }

      // `in` throws on null or a primitive, so shape-check first: a PCSX page
      // that decodes to `null` must reach the descriptive error below.
      if (api === 'pcsx' && !(json && typeof json === 'object' && 'positions' in json)) {
        const normalized = normalizePcsxPage(json);
        if (!normalized) {
          throw new Error(`eightfold: ${entry.name} returned an unrecognized /api/pcsx/search body at start=${start}`);
        }
        json = { positions: normalized.positions, ...(normalized.count === undefined ? {} : { count: normalized.count }) };
      }

      all.push(...parseEightfoldResponse(json, tenant, entry.name));

      const positions = Array.isArray(json?.positions) ? json.positions : [];
      if (total === null && typeof json?.count === 'number' && Number.isFinite(json.count)) {
        total = json.count;
      }

      // Stop conditions, in the order they can be trusted:
      //   - an empty or short page is the end of the board;
      //   - once we have paged past `count` there is nothing left to ask for.
      // `count` alone is not enough: it is the pre-filter total on some
      // tenants, so a short page has to win.
      if (positions.length === 0 || positions.length < PAGE_SIZE) break;
      if (total !== null && start + PAGE_SIZE >= total) break;
    }

    if (rateLimited) {
      console.error(`⚠️  eightfold: ${entry.name} stopped early on HTTP 429 (${all.length}${total === null ? '' : ` of ${total}`} jobs) — the board is partial, not empty`);
    } else if (total !== null && all.length < total && maxPages * PAGE_SIZE < total) {
      console.error(`⚠️  eightfold: ${entry.name} truncated at max_pages=${maxPages} (${all.length} of ${total} jobs) — raise max_pages on this entry for more`);
    }

    return all;
  },
};
