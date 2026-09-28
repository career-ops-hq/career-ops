// Same-origin / loopback guard for the local dashboard's API surface.
//
// The dashboard is local-first: its /api routes spawn child processes and read
// and write the user's files. A route that answers an unauthenticated request
// is therefore a remote-code-execution primitive, reachable two ways:
//
//   F1 — drive-by: any web page the user visits can POST to
//        http://localhost:3000/api/... in the background (classic CSRF).
//   F2 — LAN: if the dev server is bound to 0.0.0.0, anyone on the same
//        network can hit those routes directly.
//
// This module is the pure decision logic behind `proxy.ts`. It is kept free of
// node/next imports so it runs on the edge runtime and is unit testable in
// isolation. Two independent layers, both must pass:
//
//   Origin layer (F1): trust Sec-Fetch-Site when the browser sends it, fall
//     back to comparing Origin against Host for older/non-browser clients.
//     An opt-in allowlist of extra origins (CAREER_OPS_ALLOWED_ORIGINS, empty
//     by default) passes this layer regardless of Sec-Fetch-Site: the browser
//     sets Origin itself and a page cannot forge it, so naming an origin is as
//     sound a signal as same-origin is. That is what a local companion client
//     needs — a browser extension speaks from a chrome-extension:// origin,
//     which is always "cross-site" to Fetch Metadata and so blocked outright.
//   Host layer (F2): only answer on a loopback Host by default; extra hosts
//     require an explicit opt-in (CAREER_OPS_WEB_ALLOWED_HOSTS).

/** Lowercase a Host/authority, drop the port, unwrap a bracketed IPv6 literal. */
export function normalizeHost(hostHeader) {
  if (!hostHeader) return "";
  const host = String(hostHeader).trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host.slice(1) : host.slice(1, end);
  }
  // A single colon is host:port; two or more is a bare IPv6 literal (no port).
  const colon = host.indexOf(":");
  if (colon === -1 || host.indexOf(":", colon + 1) !== -1) return host;
  return host.slice(0, colon);
}

/** True for localhost, the whole 127.0.0.0/8 range, and the IPv6 loopback. */
export function isLoopbackHost(host) {
  const h = normalizeHost(host);
  if (h === "localhost" || h === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * An origin in the one spelling the allowlist compares on.
 *
 * Lowercased, stripped of trailing slashes, and — for http(s) — of a port that
 * is the scheme's default. The browser never sends one: a page served from
 * http://localhost:80 sets `Origin: http://localhost`. Comparing raw strings
 * therefore rejected an allowlist entry that spelled the port out, which is a
 * spelling someone writing the entry by hand has every reason to choose.
 *
 * Anything the URL parser refuses falls back to the plain string form, so an
 * unparseable entry still matches itself rather than vanishing from the list.
 */
export function normalizeOrigin(origin) {
  if (!origin) return "";
  const plain = String(origin).trim().replace(/\/+$/, "").toLowerCase();
  if (!plain) return "";
  let url;
  try {
    url = new URL(plain);
  } catch {
    return plain;
  }
  // url.host drops a port that is the scheme's default, which is the whole
  // point here; scheme and host are also all an origin is, so a stray path or
  // query in a hand-written entry cannot smuggle itself into the comparison.
  return url.host ? `${url.protocol}//${url.host}` : plain;
}

/**
 * Parse the origin allowlist ("chrome-extension://abc, http://localhost:3000")
 * into a Set. Unset or blank means an empty Set: no extra origin is trusted
 * unless the user names it, so the guard's default behaviour is unchanged.
 */
export function parseAllowedOrigins(envValue) {
  const out = new Set();
  if (!envValue) return out;
  for (const token of String(envValue).split(/[\s,]+/)) {
    const o = normalizeOrigin(token);
    if (o) out.add(o);
  }
  return out;
}

/** Parse the opt-in env value ("host1, host2:port host3") into a Set of hosts. */
export function parseAllowedHosts(envValue) {
  const out = new Set();
  if (!envValue) return out;
  for (const token of String(envValue).split(/[\s,]+/)) {
    const h = normalizeHost(token);
    if (h) out.add(h);
  }
  return out;
}

function block(reason) {
  return { ok: false, status: 403, reason };
}

/**
 * Decide whether an /api request may proceed.
 * @param {object} req
 * @param {string|null} req.secFetchSite  Sec-Fetch-Site header, if any
 * @param {string|null} req.origin        Origin header, if any
 * @param {string|null} req.host          Host header
 * @param {Set<string>} req.allowedHosts  extra non-loopback hosts opted in
 * @param {Set<string>} [req.allowedOrigins] extra origins allowed to call the API
 * @returns {{ok: true} | {ok: false, status: number, reason: string}}
 */
export function checkRequest({ secFetchSite, origin, host, allowedHosts, allowedOrigins }) {
  // Host layer (F2): must be loopback, or an explicitly opted-in host.
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return block("missing Host header");
  const hostAllowed = isLoopbackHost(normalizedHost) || (allowedHosts && allowedHosts.has(normalizedHost));
  if (!hostAllowed) {
    return block(
      "this host is not allowed; the dashboard serves loopback only unless CAREER_OPS_WEB_ALLOWED_HOSTS opts it in",
    );
  }

  // Origin layer (F1), allowlist: an explicitly named origin passes before
  // Fetch Metadata is consulted, because a legitimate non-page client is
  // always "cross-site" to the browser. "null" is an opaque origin (sandboxed
  // iframe, data: URL), never a real client, so it can never be allowlisted.
  if (origin != null && origin !== "null" && allowedOrigins && allowedOrigins.size > 0) {
    if (allowedOrigins.has(normalizeOrigin(origin))) return { ok: true };
  }

  // Origin layer (F1), primary: the Fetch Metadata signal, when present.
  //   same-origin — the app's own fetch()          → allow
  //   none         — a direct navigation/bookmark   → allow (not attacker-forgeable)
  //   same-site / cross-site — another origin        → block
  if (secFetchSite) {
    if (secFetchSite === "same-origin" || secFetchSite === "none") return { ok: true };
    return block(`cross-origin request refused (Sec-Fetch-Site: ${secFetchSite})`);
  }

  // Origin layer, fallback: no Fetch Metadata (old browser / non-browser).
  // If an Origin is present it must match Host; absent Origin (curl, server
  // fetch) cannot be a browser CSRF, so allow it.
  if (origin == null) return { ok: true };
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return block("invalid Origin header"); // includes the opaque "null" origin
  }
  if (originHost !== String(host).trim().toLowerCase()) {
    return block("cross-origin request refused (Origin does not match Host)");
  }
  return { ok: true };
}
