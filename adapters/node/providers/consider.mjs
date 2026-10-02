// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

// Consider provider — VC "talent network" portfolio boards on getconsider.com
// (Founderful, Creandum, Balderton, Lightspeed, Notion Capital, …). The board
// is a JS app, but its data comes from a same-origin JSON endpoint we can hit
// directly (discovered via a headless capture of the board's network calls):
//
//   POST {board_origin}/api-boards/search-jobs
//   body: {"meta":{"size":N},"board":{"id":"<board_id>","isParent":true},
//          "query":{"promoteFeatured":true}}
//   -> { jobs: [ {title,url,applyUrl,companyName,locations[],timeStamp,remote} ], total }
//
// `url` is the clean destination ATS link (dedups with the ashby/greenhouse
// providers); `companyName` is the portfolio company. The board id is NOT the
// host (Founderful's is "wingman"), so set it explicitly in portals.yml:
//
//   - name: Founderful (portfolio)
//     provider: consider
//     consider_board: wingman
//     careers_url: https://jobs.founderful.com/jobs
//     enabled: true
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

// Perform the anonymous GET /jobs handshake that Consider requires before
// accepting a POST. Returns { cookie, csrfToken } — either field is null if
// the server did not supply it. On any network failure the catch returns both
// null so the caller can still attempt the POST (it will 412, but that is a
// cleaner signal than a silent skip — and it keeps the same observable
// behaviour as the pre-fix code for boards that don't enforce CSRF).
async function acquireCsrfHandshake(origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HANDSHAKE_TIMEOUT_MS);
  try {
    // redirect:'error' blocks every redirect unconditionally. A redirect-to-
    // private-IP (169.254.169.254, ::1, …) would otherwise bypass the host
    // guard in resolveOrigin() and make a request to an internal target.
    // redirect:'manual' cannot be used here: the WHATWG opaque-redirect
    // response (Node ≥18 / undici) returns status 0 and empty headers, so
    // the Location value is unreadable without implementation-specific APIs.
    // redirect:'error' gives the same security outcome — zero redirects
    // followed — and the catch below treats the resulting TypeError as a
    // degraded handshake (null/null), which is correct.
    const res = await fetch(`${origin}/jobs`, {
      headers: { 'user-agent': BROWSER_LIKE_USER_AGENT, accept: 'text/html,*/*' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) return { cookie: null, csrfToken: null };
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

    // Consider embeds the CSRF token as `"csrfToken":"<value>"` inside a JSON
    // payload in a <script> tag on the board landing page. The 8-char lower
    // bound rules out placeholder strings and short error tokens.
    const m = html.match(/"csrfToken"\s*:\s*"([^"]{8,})"/);
    const csrfToken = m ? m[1] : null;

    return { cookie, csrfToken };
  } catch {
    return { cookie: null, csrfToken: null };
  } finally {
    clearTimeout(timer);
  }
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

  detect(entry) {
    const origin = resolveOrigin(entry);
    return entry.consider_board && origin ? { url: origin + ENDPOINT_PATH } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`consider: ${entry.name} needs an https careers_url on a public host`);
    if (!entry.consider_board) throw new Error(`consider: ${entry.name} needs a 'consider_board' id in portals.yml`);
    const size = Number.isInteger(entry.consider_size) && entry.consider_size > 0 ? entry.consider_size : DEFAULT_SIZE;

    // Perform the CSRF handshake before the POST. ctx._acquireHandshake is a
    // test seam: set it to a stub in unit tests so no real network call is made.
    const { cookie, csrfToken } = await (
      typeof ctx._acquireHandshake === 'function'
        ? ctx._acquireHandshake(origin)
        : acquireCsrfHandshake(origin)
    );

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
        board: { id: String(entry.consider_board), isParent: true },
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
