// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

// Consider provider — multi-employer board adapter for `job_boards:`.
// VC "talent network" portfolio boards built on Consider (consider.com) and
// served from each fund's own host (Founderful, Creandum, Balderton,
// Lightspeed, Notion Capital, …). The board is a JS app, but its data comes
// from a same-origin JSON endpoint we can hit directly (discovered via a
// headless capture of the board's network calls):
//
//   POST {board_origin}/api-boards/search-jobs
//   body: {"meta":{"size":N},"board":{"id":"<board_id>","isParent":true},
//          "query":{"promoteFeatured":true}}
//   -> { jobs: [ {title,url,applyUrl,companyName,locations[],timeStamp,remote} ], total }
//
// `url` is the clean destination ATS link (dedups with the ashby/greenhouse
// providers); `companyName` is the portfolio company. The board id is NOT the
// host (Founderful's is "wingman"). The board page GET that the CSRF handshake
// below needs anyway carries it, next to the token in the page's server
// state, as the same `"board":{"id":...,"isParent":...}` object the POST
// sends, so it is read from there:
//
//   - name: Founderful (portfolio)
//     provider: consider
//     careers_url: https://jobs.founderful.com/jobs
//     enabled: true
//
// The id is not kept in `ctx.idCache`: the page has to be read on every scan
// for the token (the POST answers 412 INVALID_CSRF without it), so a cached
// id would save no request. `consider_board: <id>` on the entry wins over the
// page; it is needed only when the page stops carrying the id.
//
// `consider_size` (default 500) caps how many newest/featured jobs are pulled in
// the single request. Boards larger than that are truncated (rare for VC boards).

// Consider's `timeStamp` arrives as epoch ms on some boards and an ISO string
// on others, so both shapes are handled. Non-positive values are treated as
// missing rather than as 1970 — a 0/negative stamp is a board bug, and dating
// the posting to the epoch would make it permanently stale to the age filter.
function toEpochMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    // Values below 1e12 are Unix seconds; at or above, already ms.
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) || ms <= 0 ? null : ms;
}

const ENDPOINT_PATH = '/api-boards/search-jobs';
const DEFAULT_SIZE = 500;
// Budget for the anonymous GET that seeds the session cookie and csrfToken.
// Shorter than the POST budget so a slow board page can't eat the full timeout.
const HANDSHAKE_TIMEOUT_MS = 8_000;

// SSRF guard. The POST target host is config-driven (built from the portals.yml
// careers_url), so pin it to a public HTTPS origin before fetching. Consider
// boards are always real registrable domains (jobs.founderful.com, …); reject
// non-HTTPS, IP-literal, and loopback/internal hosts so a malicious or
// misconfigured careers_url can't aim the POST at an internal target
// (127.0.0.1, 169.254.169.254 cloud-metadata, ::1, localhost, *.internal).
// Mirrors the hostname-pinning lever.mjs / weworkremotely.mjs already do; here
// the allowlist is structural (public domain) since the board host varies.
function resolveOrigin(entry) {
  let parsed;
  try {
    parsed = new URL(entry.careers_url || '');
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  let host = parsed.hostname.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1); // strip FQDN trailing dot
  if (host.startsWith('[') || host.includes(':')) return null;        // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;              // IPv4 literal (incl. metadata/private)
  if (host === 'localhost' || host === 'localhost.localdomain') return null;
  if (host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (!host.includes('.')) return null;                              // single-label / non-public
  return parsed.origin;
}

// The board page carries its server state as one JSON object on a single
// line of an inline script: `window.serverInitialData = {...};`, which ends
// that line or is followed by the script's closing tag. The CSRF token and
// the board are top-level keys of that object, so they are read from it and
// from nowhere else on the page: a "csrfToken" or "board" key in some other
// script cannot be picked up.
/**
 * @param {string} html
 * @returns {Record<string, any> | null}
 */
function extractServerData(html) {
  const m = html.match(/window\.serverInitialData\s*=\s*(\{.*?\})\s*;?\s*(?:<\/script>|$)/m);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * The CSRF token from the server state. The 8-char lower bound rules out
 * placeholder strings and short error tokens.
 * @param {Record<string, any> | null} data
 * @returns {string | null}
 */
function extractCsrfToken(data) {
  const token = data?.csrfToken;
  return typeof token === 'string' && token.length >= 8 ? token : null;
}

/**
 * The board from the server state, as { id, isParent }: the same object the
 * POST sends. Null when it has no usable id.
 * @param {Record<string, any> | null} data
 * @returns {{ id: string, isParent: boolean } | null}
 */
function extractBoard(data) {
  const board = data?.board;
  const id = typeof board?.id === 'string' ? board.id.trim() : '';
  if (!id) return null;
  return { id, isParent: typeof board.isParent === 'boolean' ? board.isParent : true };
}

// Perform the anonymous GET /jobs handshake that Consider requires before
// accepting a POST. Returns { cookie, csrfToken, board } — each is null if
// the page did not supply it. On any network failure the catch returns all
// null so the caller can still attempt the POST (it will 412, but that is a
// cleaner signal than a silent skip — and it keeps the same observable
// behaviour for boards that don't enforce CSRF).
//
// The GET goes through ctx.fetchResponse, never bare fetch. resolveOrigin()
// only vets the hostname as written; the address it resolves to is checked by
// the provider DNS guard, and that guard applies only inside the ctx fetch
// helpers (#3096). A bare fetch here left this one hop unvalidated while the
// POST right after it was covered. A ctx without fetchResponse (an older
// embedder, a test stub) degrades to all null rather than falling back to an
// unguarded request.
const NO_HANDSHAKE = Object.freeze({ cookie: null, csrfToken: null, board: null });

async function acquireCsrfHandshake(origin, ctx) {
  if (typeof ctx.fetchResponse !== 'function') return NO_HANDSHAKE;
  try {
    // redirect:'error' blocks every redirect unconditionally. A redirect-to-
    // private-IP (169.254.169.254, ::1, …) would otherwise bypass the host
    // guard in resolveOrigin() and make a request to an internal target.
    // 'manual' would refuse to follow too, and on Node's fetch (undici) a
    // manual 3xx is readable — a real non-ok response with a Location header,
    // not a browser-style opaque one (jobvite.mjs uses that to classify a
    // redirect target). This handshake never needs to look at the redirect,
    // only refuse it, so 'error' is the simpler choice — the resulting
    // TypeError is caught below as a degraded handshake (all null), which is
    // correct.
    const res = await ctx.fetchResponse(`${origin}/jobs`, {
      headers: { 'user-agent': BROWSER_LIKE_USER_AGENT, accept: 'text/html,*/*' },
      redirect: 'error',
      timeoutMs: HANDSHAKE_TIMEOUT_MS,
    });
    // ctx.fetchResponse throws on a non-2xx, so this only fires for a ctx that
    // hands one back anyway. Either way a refused GET must not be scraped.
    if (!res.ok) return NO_HANDSHAKE;
    const html = await res.text();

    // getSetCookie() returns each Set-Cookie header as its own string, avoiding
    // the comma-folding ambiguity of get('set-cookie') for values that contain
    // commas. Available since Node 18.14; project minimum is Node 22.
    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*\w+=)/).filter(Boolean);

    const cookie = setCookies
      .map(c => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ') || null;

    const data = extractServerData(html);
    return { cookie, csrfToken: extractCsrfToken(data), board: extractBoard(data) };
  } catch {
    return NO_HANDSHAKE;
  }
}

/**
 * The board the POST asks for: `consider_board` on the entry, else the one the
 * board page names.
 * @param {any} entry
 * @param {{ id: string, isParent: boolean } | null} pageBoard
 * @returns {{ id: string, isParent: boolean } | null}
 */
function resolveBoard(entry, pageBoard) {
  if (entry.consider_board) return { id: String(entry.consider_board), isParent: true };
  return pageBoard;
}

function locationString(job) {
  if (Array.isArray(job.locations) && job.locations.length) {
    return job.locations.filter(l => typeof l === 'string').join(', ');
  }
  if (Array.isArray(job.normalizedLocations) && job.normalizedLocations.length) {
    return job.normalizedLocations.map(l => l?.label || l?.value).filter(Boolean).join(', ');
  }
  return job.remote ? 'Remote' : '';
}

/** @type {Provider} */
export default {
  id: 'consider',

  // Consider boards live on vanity hosts with no common suffix, so only an
  // entry that sets consider_board is detected; any other one selects the
  // provider with `provider: consider`.
  detect(entry) {
    const origin = resolveOrigin(entry);
    return entry.consider_board && origin ? { url: origin + ENDPOINT_PATH } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`consider: ${entry.name} needs an https careers_url on a public host`);
    const size = Number.isInteger(entry.consider_size) && entry.consider_size > 0 ? entry.consider_size : DEFAULT_SIZE;

    // Perform the CSRF handshake before the POST. ctx._acquireHandshake is a
    // test seam: set it to a stub in unit tests so no real network call is made.
    const { cookie, csrfToken, board: pageBoard = null } = await (
      typeof ctx._acquireHandshake === 'function'
        ? ctx._acquireHandshake(origin)
        : acquireCsrfHandshake(origin, ctx)
    );
    const board = resolveBoard(entry, pageBoard);
    if (!board) {
      throw new Error(
        `consider: ${entry.name} — could not read the board id from ${origin}/jobs ` +
        `(set consider_board: <id> on this entry as a fallback)`,
      );
    }

    const csrfHeaders = {};
    if (cookie) csrfHeaders.cookie = cookie;
    if (csrfToken) csrfHeaders['x-csrf-token'] = csrfToken;

    const json = await ctx.fetchJson(origin + ENDPOINT_PATH, {
      method: 'POST',
      // redirect:'error' so a 3xx from the (config-driven) board host can't be
      // followed to a private/metadata IP — the host guard above pins the first hop.
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        referer: origin + '/jobs',
        ...csrfHeaders,
      },
      body: JSON.stringify({
        meta: { size },
        board: { id: board.id, isParent: board.isParent },
        query: { promoteFeatured: true },
      }),
    });

    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return jobs
      .map(j => {
        const rawUrl = j.url || j.applyUrl || '';
        if (!rawUrl) return null;
        // Normalize to an absolute URL so the dedup key matches what the
        // ashby/greenhouse providers emit (Consider returns absolute ATS links,
        // but resolve defensively in case a relative path ever appears).
        let url;
        try {
          url = new URL(rawUrl, origin).toString();
        } catch {
          return null;
        }
        return {
          title: j.title || '',
          url,
          company: j.companyName || entry.name,
          location: locationString(j),
          postedAt: toEpochMs(j.timeStamp),
        };
      })
      .filter(Boolean);
  },
};
