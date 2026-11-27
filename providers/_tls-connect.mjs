// Direct TCP/TLS connector for undici Agents without forced ALPN.
//
// undici's built-in buildConnector() unconditionally passes
// `ALPNProtocols: allowH2 ? ['http/1.1', 'h2'] : ['http/1.1']` to tls.connect().
// Cloudflare WAFs on Workday CXS endpoints challenge ClientHellos that
// advertise `ALPNProtocols: ['http/1.1']` with HTTP 429, while standard
// node:https (which omits ALPNProtocols) receives 200 OK (#7785).
//
// Zero npm dependencies: built solely on node:net and node:tls so callers that
// run without undici never fail to import this helper.

import net from 'node:net';
import tls from 'node:tls';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_KEEP_ALIVE_DELAY_MS = 60_000;

function stripHostBracketsAndPort(value) {
  if (!value) return '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  if (net.isIP(value)) return value;
  return value.replace(/:\d+$/, '');
}

function resolveServerName(servername, configuredServername, host, hostname) {
  const explicit = servername || configuredServername;
  if (explicit) {
    const bare = stripHostBracketsAndPort(explicit);
    return !bare || net.isIP(bare) ? undefined : bare;
  }
  if (host) {
    const bare = stripHostBracketsAndPort(host);
    if (bare && !net.isIP(bare)) return bare;
  }
  if (hostname && !net.isIP(hostname)) return hostname;
  return undefined;
}

/**
 * Create an undici-compatible `connect(opts, callback)` function that omits
 * `ALPNProtocols` on TLS connections so Cloudflare does not flag the client
 * fingerprint.
 *
 * @param {Record<string, any>} [connectOpts]
 * @returns {(opts: Record<string, any>, callback: (err: Error | null, socket: any) => void) => any}
 */
export function createDirectConnect(connectOpts = {}) {
  const {
    ALPNProtocols: _ignoredUpper,
    alpnProtocols: _ignoredLower,
    timeout,
    keepAlive,
    keepAliveInitialDelay,
    servername: configuredServername,
    socketPath,
    path: configuredPath,
    ...tlsBaseOpts
  } = connectOpts ?? {};
  const ipcPath = configuredPath !== undefined ? configuredPath : socketPath;

  const timeoutMs = timeout === 0 || timeout === false
    ? 0
    : (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
      ? timeout
      : DEFAULT_CONNECT_TIMEOUT_MS);
  const keepAliveEnabled = keepAlive == null ? true : Boolean(keepAlive);
  const keepAliveDelay = keepAliveInitialDelay === undefined
    ? DEFAULT_KEEP_ALIVE_DELAY_MS
    : keepAliveInitialDelay;

  return function directConnect({ hostname, host, protocol, port, servername, localAddress, httpSocket }, callback) {
    const isHttps = protocol === 'https:';
    const portNum = Number(port) || (isHttps ? 443 : 80);

    let cb = typeof callback === 'function' ? callback : null;
    let timer = null;
    const done = (err, sock) => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (!cb) return;
      const fn = cb;
      cb = null;
      fn(err, sock);
    };

    if (!isHttps && httpSocket) {
      const err = new Error('httpSocket can only be sent on TLS upgrade');
      queueMicrotask(() => done(err, null));
      return httpSocket;
    }

    const socket = isHttps
      ? (() => {
        const resolvedServername = resolveServerName(servername, configuredServername, host, hostname);
        const tlsOpts = {
          highWaterMark: 16384,
          ...tlsBaseOpts,
          ...(ipcPath !== undefined ? { path: ipcPath } : { host: hostname, port: portNum }),
          ...(resolvedServername ? { servername: resolvedServername } : {}),
          ...(localAddress ? { localAddress } : {}),
          ...(httpSocket ? { socket: httpSocket } : {}),
        };
        return tls.connect(tlsOpts);
      })()
      : net.connect({
        highWaterMark: 64 * 1024,
        ...tlsBaseOpts,
        ...(ipcPath !== undefined ? { path: ipcPath } : { host: hostname, port: portNum }),
        ...(localAddress ? { localAddress } : {}),
      });

    if (keepAliveEnabled && typeof socket.setKeepAlive === 'function') {
      socket.setKeepAlive(true, keepAliveDelay);
    }
    if (typeof socket.setNoDelay === 'function') {
      socket.setNoDelay(true);
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const err = new Error(`Connect Timeout Error (attempted address: ${hostname}:${portNum}, timeout: ${timeoutMs}ms)`);
        /** @type {any} */ (err).code = 'UND_ERR_CONNECT_TIMEOUT';
        done(err, null);
        socket.destroy(err);
      }, timeoutMs);
    }

    socket.once(isHttps ? 'secureConnect' : 'connect', () => done(null, socket));
    socket.on('error', (err) => done(err, null));

    return socket;
  };
}

export const directConnect = createDirectConnect();
