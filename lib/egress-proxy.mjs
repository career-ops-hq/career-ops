// lib/egress-proxy.mjs — the egress filter every Chromium launch that loads
// third-party pages goes through.
//
// WHY A PROXY. The route() guards (liveness-browser.mjs installLivenessRouteGuard,
// archive-posting.mjs installEgressGuard, the apply session's
// installApplyEgressGuard) only ever see the FIRST url of a redirected request.
// Playwright documents it: the handler "will only be called for the first url if
// the response is a redirect". A public page that answered 302 to
// http://169.254.169.254/ was loaded, and every hop after the first was invisible
// to the guard. Those guards also resolve a name separately from Chromium, so a
// name that answers public to the guard and private to the browser got through.
//
// A browser launched with --proxy-server hands every http(s) and ws(s)
// connection to the proxy: the first request, each redirect hop, subresources
// and service workers alike. This proxy is the one place that sees all of them.
// It resolves the name itself, refuses when any answer is not a public address
// (providers/_ip-guard.mjs isBlockedAddress, the same list the provider layer
// uses), and dials exactly the addresses it checked, so nothing can change
// between the check and the connection.
//
// Playwright already sends loopback through a configured proxy (it adds
// `<-loopback>` to Chromium's bypass list); egressLaunchOptions sets that rule
// itself, so PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK cannot turn it
// off.
//
// A PROXY THE USER ALREADY HAS. Chromium on Linux honours http_proxy and
// https_proxy, and sandboxed agent environments route all egress through one.
// When such a proxy applies to the destination, the connection is opened
// through it. Literal private addresses are still refused here. A name is
// still checked when it resolves locally. A name that does not resolve locally
// is left to that proxy, which resolves it: the same trust rule as
// providers/_http.mjs under CAREER_OPS_TRUST_PROXY_EGRESS.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { isBlockedAddress, SINKHOLE_ADDRESSES } from '../providers/_ip-guard.mjs';

const DNS_TTL_MS = 30_000;          // same TTL as providers/_dns-cache.mjs
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_REFUSALS_KEPT = 100;

// Headers that describe one hop, never the end-to-end message (RFC 9110 §7.6.1),
// plus the proxy-addressed ones Chromium sends to us and no origin should see.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'proxy-authorization',
  'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

/** Lowercase, strip IPv6 brackets and a trailing FQDN dot. */
export function normalizeHost(rawHost) {
  let h = String(rawHost ?? '').trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

// Names that never mean a public site: this machine (localhost and
// *.localhost, RFC 6761 §6.3, which Chromium answers itself without DNS) or a
// private network (mDNS .local, RFC 6762; .home.arpa, RFC 8375; .internal,
// reserved by ICANN for private use). Refused by name, before any lookup:
// whatever they resolve to belongs to someone's private network.
const PRIVATE_USE_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

/** @param {string} host - Normalized host (see normalizeHost). */
export function isPrivateUseName(host) {
  return host === 'localhost' || host === 'localhost.localdomain'
    || PRIVATE_USE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

async function lookupAll(host) {
  const answers = await dns.promises.lookup(host, { all: true, verbatim: true });
  return answers.map((a) => a.address);
}

/**
 * Decide whether a destination may be dialled.
 *
 * @param {string} hostname - Host as it appears in the URL or CONNECT line.
 * @param {{ resolve?: (host: string) => Promise<string[]>, allowUnresolved?: boolean }} [opts]
 *   `allowUnresolved`: an upstream proxy resolves the name, so a name that does
 *   not resolve here is not a refusal.
 * @returns {Promise<{ ok: true, host: string, addresses: string[] } | { ok: false, host: string, reason: string, sinkhole?: boolean, unresolved?: boolean }>}
 */
export async function vetDestination(hostname, { resolve = lookupAll, allowUnresolved = false } = {}) {
  const host = normalizeHost(hostname);
  if (!host) return { ok: false, host, reason: 'no host' };
  if (net.isIP(host)) {
    return isBlockedAddress(host)
      ? { ok: false, host, reason: `${host} is not a public address` }
      : { ok: true, host, addresses: [host] };
  }
  if (isPrivateUseName(host)) return { ok: false, host, reason: `${host} is a local or private-use name` };
  let addresses;
  try {
    addresses = await resolve(host);
  } catch (err) {
    if (allowUnresolved) return { ok: true, host, addresses: [] };
    return { ok: false, host, reason: `${host} does not resolve (${err?.code || err?.message || err})`, unresolved: true };
  }
  if (!addresses?.length) {
    if (allowUnresolved) return { ok: true, host, addresses: [] };
    return { ok: false, host, reason: `${host} resolves to no address`, unresolved: true };
  }
  // Any non-public answer refuses the name, the rule validateUrlSecurity in
  // liveness-browser.mjs applies: a name that answers both ways is the shape of
  // DNS rebinding, and a DNS filter's 0.0.0.0 next to a public address is the
  // user's own filter saying no.
  const blocked = addresses.filter((a) => isBlockedAddress(a));
  if (blocked.length > 0) {
    return {
      ok: false,
      host,
      reason: `${host} resolves to non-public address ${blocked[0]}`,
      sinkhole: blocked.every((a) => SINKHOLE_ADDRESSES.has(String(a).toLowerCase())),
    };
  }
  return { ok: true, host, addresses };
}

// A name's verdict is kept for DNS_TTL_MS so a page with forty requests to one
// host costs one lookup. Only successful verdicts are kept: a refusal is cheap
// to repeat and must not outlive a fixed DNS record.
function cachedVetter(resolve) {
  const cache = new Map();
  return async (host, allowUnresolved) => {
    const key = `${normalizeHost(host)}\0${allowUnresolved ? 1 : 0}`;
    const hit = cache.get(key);
    if (hit && Date.now() < hit.expiresAt) return hit.verdict;
    const verdict = await vetDestination(host, { resolve, allowUnresolved });
    if (verdict.ok) cache.set(key, { verdict, expiresAt: Date.now() + DNS_TTL_MS });
    else cache.delete(key);
    return verdict;
  };
}

// A lookup that hands net.connect the addresses already checked, so the socket
// dials exactly those and never asks DNS again.
function pinnedLookup(addresses) {
  const entries = addresses.map((address) => ({ address, family: net.isIP(address) }));
  return (_hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : (options ?? {});
    if (opts.all) return cb(null, entries);
    return cb(null, entries[0].address, entries[0].family);
  };
}

function noProxyMatches(host, port, noProxy) {
  if (!noProxy) return false;
  for (const raw of noProxy.split(/[\s,]+/)) {
    let entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '*') return true;
    let entryPort = null;
    const portMatch = /^(.*):(\d+)$/.exec(entry);
    if (portMatch && !net.isIP(entry)) { entry = portMatch[1]; entryPort = Number(portMatch[2]); }
    entry = normalizeHost(entry.replace(/^\*?\./, ''));
    if (entryPort !== null && entryPort !== port) continue;
    if (host === entry || host.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/**
 * The user's own proxy for a destination, from the environment, or null.
 * Only http:// and https:// proxies can carry the tunnel; any other scheme
 * (socks5://) is not used. A proxy URL with credentials must use https://
 * unless the proxy is on loopback, the rule providers/_http.mjs applies: the
 * credentials would otherwise cross the network in clear text. Such a URL
 * throws, and the connection is refused rather than sent without the proxy.
 *
 * @param {'http:' | 'https:'} protocol - http: for a plain request, https: for a CONNECT tunnel.
 * @throws {Error} When the proxy URL carries credentials over plain http to a non-loopback host.
 */
export function upstreamProxyFor(protocol, host, port, env = process.env) {
  const pick = (...names) => names.map((n) => env[n]).find((v) => v != null && String(v).trim() !== '');
  const raw = protocol === 'https:'
    ? pick('https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY')
    : pick('http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY');
  if (!raw) return null;
  if (noProxyMatches(normalizeHost(host), port, pick('no_proxy', 'NO_PROXY'))) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const proxyHost = normalizeHost(url.hostname);
  const loopback = proxyHost === 'localhost' || proxyHost === '::1'
    || (net.isIP(proxyHost) === 4 && proxyHost.startsWith('127.'));
  if ((url.username || url.password) && url.protocol !== 'https:' && !loopback) {
    throw new Error('Proxy URLs containing credentials must use HTTPS to protect proxy authentication.');
  }
  return url;
}

function proxyAuthHeader(upstream) {
  if (!upstream.username && !upstream.password) return null;
  const creds = `${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`;
  return `Basic ${Buffer.from(creds).toString('base64')}`;
}

function authority(host, port) {
  return net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
}

function dialDirect(host, port, addresses) {
  return net.connect({ host, port, lookup: pinnedLookup(addresses), autoSelectFamily: true });
}

// Open a CONNECT tunnel to host:port through the user's proxy and resolve with
// the raw socket once the proxy answers 200.
function dialThroughUpstream(upstream, host, port) {
  return new Promise((resolve, reject) => {
    const upHost = normalizeHost(upstream.hostname);
    const upPort = Number(upstream.port) || (upstream.protocol === 'https:' ? 443 : 80);
    const socket = upstream.protocol === 'https:'
      ? tls.connect({ host: upHost, port: upPort, servername: net.isIP(upHost) ? undefined : upHost })
      : net.connect({ host: upHost, port: upPort });
    const target = authority(host, port);
    const auth = proxyAuthHeader(upstream);
    let head = Buffer.alloc(0);
    const fail = (err) => { socket.destroy(); reject(err); };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => fail(new Error(`upstream proxy timed out opening ${target}`)));
    socket.once('error', fail);
    socket.once(upstream.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`);
    });
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) {
        if (head.length > 16_384) fail(new Error('upstream proxy sent an oversized CONNECT response'));
        return;
      }
      socket.off('data', onData);
      socket.off('error', fail);
      socket.setTimeout(0);
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(head.subarray(0, end).toString('latin1'))?.[1];
      if (status !== '200') return fail(new Error(`upstream proxy refused ${target} (${status ?? 'no status'})`));
      const rest = head.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    socket.on('data', onData);
  });
}

function waitConnected(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('connect timed out')); }, CONNECT_TIMEOUT_MS);
    socket.once('connect', () => { clearTimeout(timer); socket.off('error', onError); resolve(socket); });
    const onError = (err) => { clearTimeout(timer); reject(err); };
    socket.once('error', onError);
  });
}

function splice(a, b) {
  const close = () => { a.destroy(); b.destroy(); };
  a.on('error', close);
  b.on('error', close);
  a.on('close', close);
  b.on('close', close);
  a.pipe(b);
  b.pipe(a);
}

function endToEndHeaders(headers) {
  const out = {};
  const listed = new Set(String(headers.connection ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key) || listed.has(key)) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Start a filtering proxy on 127.0.0.1 with an ephemeral port.
 *
 * @param {{
 *   resolve?: (host: string) => Promise<string[]>,
 *   vet?: (host: string, allowUnresolved: boolean, port: number) => Promise<any>,
 *   env?: Record<string, string | undefined>,
 *   warn?: (message: string) => void,
 * }} [opts] - `resolve` and `vet` are test seams (DNS answers; the whole verdict,
 *   so a test can let one loopback server stand in for a public site);
 *   `env` supplies the user's proxy settings.
 * @returns {Promise<{ server: string, port: number, refusals: Array<{ host: string, port: number, reason: string, at: number }>, close: () => Promise<void> }>}
 */
export async function startEgressProxy({ resolve = lookupAll, vet = cachedVetter(resolve), env = process.env, warn = (m) => console.warn(m) } = {}) {
  const refusals = [];
  const warned = new Set();

  const refuse = (host, port, verdict) => {
    refusals.push({ host, port, reason: verdict.reason, at: Date.now() });
    if (refusals.length > MAX_REFUSALS_KEPT) refusals.shift();
    // A DNS filter's sinkhole and a name that does not exist are the user's own
    // network at work, and a page full of blocked trackers would otherwise print
    // a line per tracker. A private address is a finding: it says so, once.
    if (verdict.sinkhole || verdict.unresolved || warned.has(host)) return;
    warned.add(host);
    warn(`[egress] refused a browser connection to ${authority(host, port)}: ${verdict.reason}`);
  };

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('career-ops egress filter: absolute URL required\n');
      return;
    }
    if (url.protocol !== 'http:') {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('career-ops egress filter: only http:// is forwarded; https goes through CONNECT\n');
      return;
    }
    const host = normalizeHost(url.hostname);
    const port = Number(url.port) || 80;
    let upstream;
    try {
      upstream = upstreamProxyFor('http:', host, port, env);
    } catch (err) {
      refuse(host, port, { reason: err.message });
      req.socket.destroy();
      return;
    }
    const verdict = await vet(host, Boolean(upstream), port);
    if (!verdict.ok) {
      refuse(host, port, verdict);
      // No response at all, so no caller reads a refusal page as the posting:
      // the hop fails like any connection that never answered.
      req.socket.destroy();
      return;
    }
    const headers = endToEndHeaders(req.headers);
    const auth = upstream ? proxyAuthHeader(upstream) : null;
    const forward = upstream
      ? (upstream.protocol === 'https:' ? https : http).request({
        host: normalizeHost(upstream.hostname),
        port: Number(upstream.port) || (upstream.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: url.href,
        headers: auth ? { ...headers, 'proxy-authorization': auth } : headers,
        agent: false,
      })
      : http.request({
        host,
        port,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
        lookup: verdict.addresses.length ? pinnedLookup(verdict.addresses) : undefined,
        setHost: false,
        agent: false,
      });
    forward.setTimeout(CONNECT_TIMEOUT_MS * 4, () => forward.destroy(new Error('origin timed out')));
    forward.on('response', (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, endToEndHeaders(upRes.headers));
      upRes.pipe(res);
      upRes.on('error', () => res.destroy());
    });
    forward.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }).end();
      else res.destroy();
    });
    req.pipe(forward);
  });

  server.on('connect', async (req, clientSocket, head) => {
    clientSocket.on('error', () => clientSocket.destroy());
    const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(req.url ?? '');
    const port = match ? Number(match[2]) : 0;
    if (!match || port < 1 || port > 65_535) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    const host = normalizeHost(match[1]);
    let upstream;
    try {
      upstream = upstreamProxyFor('https:', host, port, env);
    } catch (err) {
      refuse(host, port, { reason: err.message });
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    const verdict = await vet(host, Boolean(upstream), port);
    if (!verdict.ok) {
      refuse(host, port, verdict);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    let remote;
    try {
      remote = upstream
        ? await dialThroughUpstream(upstream, host, port)
        : await waitConnected(dialDirect(host, port, verdict.addresses));
    } catch {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    if (clientSocket.destroyed) { remote.destroy(); return; }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) remote.write(head);
    splice(clientSocket, remote);
  });

  // Chromium carries WebSockets through CONNECT; a plain-HTTP upgrade is not a
  // request it makes, so nothing is forwarded for one.
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.on('clientError', (_err, socket) => socket.destroy());

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => { server.off('error', rejectListen); resolveListen(); });
  });
  // The browser holds the proxy open while it runs; the proxy must not hold the
  // process open once the browser is gone.
  server.unref();
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    server: `http://127.0.0.1:${port}`,
    port,
    refusals,
    close: () => new Promise((done) => {
      server.close(() => done());
      server.closeAllConnections?.();
    }),
  };
}

let shared = null;

/** The process-wide egress proxy, started on first use. */
export function sharedEgressProxy() {
  if (!shared) {
    shared = startEgressProxy().catch((err) => {
      shared = null;
      throw err;
    });
  }
  return shared;
}

/**
 * Playwright launch options that send all of the browser's traffic through the
 * egress filter. A caller that already set `proxy` keeps it: a deliberate
 * choice wins, the rule browserLaunchOptions applies to executablePath.
 *
 * @template {Record<string, any>} T
 * @param {T} [options]
 * @param {{ proxy?: Promise<{ server: string }> | { server: string } }} [seam] - Test seam: the proxy to use.
 * @returns {Promise<T & { proxy: { server: string, bypass: string } }>}
 */
export async function egressLaunchOptions(options = /** @type {any} */ ({}), seam = {}) {
  if (options?.proxy) return /** @type {any} */ (options);
  const proxy = await (seam.proxy ?? sharedEgressProxy());
  return { ...options, proxy: { server: proxy.server, bypass: '<-loopback>' } };
}
