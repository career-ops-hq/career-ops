// @ts-check
// plugins/_net.mjs — SSRF egress validation for the plugin guarded fetch.
//
// Pure, side-effect-free import (no top-level work) so the engine's
// byte-identical-when-opted-out guarantee is preserved. Uses ONLY node builtins
// (node:dns, node:net) plus providers/_ip-guard.mjs, which itself needs only
// node:async_hooks and is already loaded by every scan — NOT undici (Node's
// global fetch is powered by an INTERNAL undici that is not importable as the
// `undici` module in a zero-dep install, so we never depend on it).
//
// Honest scope: this resolves a hostname and rejects private/loopback/link-
// local/metadata destinations on EVERY redirect hop. It binds an HONEST plugin
// that routes through ctx.fetch. It is tamper-evidence + a footgun guard, NOT
// containment against malicious code (which can call node:net directly). A
// residual DNS-rebinding window exists because global fetch re-resolves at
// connect time; documented plainly in plugins/README.md (no overclaim).

import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isBlockedAddress } from '../providers/_ip-guard.mjs';

/**
 * Is an IP address in a range a plugin must never reach (SSRF targets)?
 *
 * The ranges are the providers' list (providers/_ip-guard.mjs), so a plugin
 * and a provider refuse the same addresses. This file kept its own copy until
 * it fell behind: 198.18/15, the rest of fe80::/10, ff00::/8 and the
 * IPv4-compatible spellings (::127.0.0.1, ::7f00:1) all passed here while the
 * provider guard refused them.
 * @param {string} ip
 * @returns {boolean}
 */
export function isBlockedIp(ip) {
  if (isIP(ip) === 0) return true; // not a valid IP → reject (fail-closed)
  return isBlockedAddress(ip);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// How long to wait for DNS before giving up. The guarded fetch's own timeout only
// starts once the connection is attempted, so without this a resolver that never
// answers would hold a plugin call until the hook's outer timeout.
export const DEFAULT_DNS_TIMEOUT_MS = 5_000;
// setTimeout treats anything above this (2^31-1 ms, ~24.8 days) as 1 ms.
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Resolve a hostname and reject if ANY resolved address is blocked. Returns the
 * validated addresses. Throws on a blocked, unresolvable or too-slow host.
 *
 * The timeout stops WAITING; the underlying getaddrinfo call cannot be cancelled
 * and finishes in the background, which is harmless (its result is discarded).
 * @param {string} hostname
 * @param {{ allowsLocalhost?: boolean, timeoutMs?: number, lookup?: typeof dnsLookup }} [opts]
 *   `lookup` replaces the resolver (tests only).
 * @returns {Promise<string[]>}
 */
export async function resolveAndValidate(hostname, { allowsLocalhost = false, timeoutMs = DEFAULT_DNS_TIMEOUT_MS, lookup = dnsLookup } = {}) {
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

  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMER_MS ? timeoutMs : DEFAULT_DNS_TIMEOUT_MS;
  let addrs;
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`DNS lookup timed out after ${limit}ms`);
        // @ts-ignore
        err.code = 'dns_timeout';
        reject(err);
      }, limit);
    });
    // A late rejection from the abandoned lookup must not become an unhandled one.
    const pending = Promise.resolve(lookup(hostname, { all: true }));
    pending.catch(() => {});
    addrs = await Promise.race([pending, timeout]);
  } catch (err) {
    throw new Error(`plugin egress: cannot resolve ${hostname} — ${err.message}`);
  } finally {
    clearTimeout(timer);
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
