// @ts-check
// plugins/_net.mjs — SSRF egress validation for the plugin guarded fetch.
//
// Pure, side-effect-free import (no top-level work) so the engine's
// byte-identical-when-opted-out guarantee is preserved. Uses ONLY node builtins
// (node:dns, node:net) — NOT undici (Node's global fetch is powered by an
// INTERNAL undici that is not importable as the `undici` module in a zero-dep
// install, so we never depend on it).
//
// Honest scope: this resolves a hostname and rejects private/loopback/link-
// local/metadata destinations on EVERY redirect hop. It binds an HONEST plugin
// that routes through ctx.fetch. It is tamper-evidence + a footgun guard, NOT
// containment against malicious code (which can call node:net directly). A
// residual DNS-rebinding window exists because global fetch re-resolves at
// connect time; documented plainly in plugins/README.md (no overclaim).

import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

/**
 * Is an IP address in a range a plugin must never reach (SSRF targets)?
 * Rejects loopback, RFC1918 private, link-local + cloud metadata (169.254.x,
 * incl. 169.254.169.254), CGNAT (100.64/10), unspecified, IPv6 ULA/link-local,
 * and IPv4-mapped-IPv6 of all the above.
 * @param {string} ip
 * @returns {boolean}
 */
export function isBlockedIp(ip) {
  const fam = isIP(ip);
  if (fam === 0) return true; // not a valid IP → reject (fail-closed)

  if (fam === 4) return isBlockedV4(ip);

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;            // loopback / unspecified
  if (lower.startsWith('fe80:')) return true;                    // link-local
  if (/^f[cd][0-9a-f][0-9a-f]:/.test(lower)) return true;        // fc00::/7 ULA
  // IPv4-mapped (::ffff:a.b.c.d) → validate the embedded v4
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  // ::ffff:hex:hex form
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const a = parseInt(mappedHex[1], 16), b = parseInt(mappedHex[2], 16);
    return isBlockedV4([(a >> 8) & 255, a & 255, (b >> 8) & 255, b & 255].join('.'));
  }
  return false;
}

function isBlockedV4(ip) {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 0) return true;                       // 0.0.0.0/8
  if (a === 10) return true;                      // 10/8 private
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true;        // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0/24
  if (a >= 224) return true;                      // multicast / reserved
  return false;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Resolve a hostname and reject if ANY resolved address is blocked. Returns the
 * validated addresses. Throws on a blocked or unresolvable host.
 * @param {string} hostname
 * @param {{ allowsLocalhost?: boolean }} [opts]
 * @returns {Promise<string[]>}
 */
export async function resolveAndValidate(hostname, { allowsLocalhost = false } = {}) {
  // An IP literal host: validate directly (no DNS).
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      if (allowsLocalhost && isLoopbackLiteral(hostname)) return [hostname];
      throw new Error(`plugin egress to ${hostname} is blocked (private/loopback/metadata range)`);
    }
    return [hostname];
  }

  if (allowsLocalhost && LOOPBACK_HOSTS.has(hostname.toLowerCase())) {
    // Local-AI providers (Ollama/LM Studio). Resolve but allow loopback through.
    return ['127.0.0.1'];
  }

  let addrs;
  try {
    addrs = await dnsLookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`plugin egress: cannot resolve ${hostname} — ${err.message}`);
  }
  if (!addrs.length) throw new Error(`plugin egress: ${hostname} resolved to no addresses`);
  for (const { address } of addrs) {
    if (isBlockedIp(address)) {
      if (allowsLocalhost && isLoopbackLiteral(address)) continue;
      throw new Error(`plugin egress: ${hostname} resolves to a blocked address (${address}) — possible SSRF/rebinding`);
    }
  }
  return addrs.map(a => a.address);
}

function isLoopbackLiteral(ip) {
  if (ip === '::1') return true;
  if (isIP(ip) === 4) return ip.split('.')[0] === '127';
  return false;
}
