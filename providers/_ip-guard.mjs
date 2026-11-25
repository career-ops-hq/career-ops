// Reject a connection whose resolved address is not a public one (#3096).
//
// Every provider's host guard pins the HOSTNAME to a public registrable
// domain, but nothing checked where that name RESOLVES. A hostname with an A
// record pointing at 127.0.0.1, 169.254.169.254 (cloud metadata) or an RFC1918
// range was connected to normally. `redirect: 'error'` blocks redirect-based
// hops; it does not block a direct malicious record.
//
// WHY THE CHECK IS SCOPED, NOT GLOBAL. _dns-cache.mjs patches `dns.lookup` on
// the node:dns module object, which is process-wide. Rejecting private ranges
// there unconditionally would reject every loopback connection anything in the
// process makes by name (`localhost`).
//
// A NUMERIC host does not reach dns.lookup at all (measured on Node 20.15,
// 22.3 and 26: fetch('http://127.0.0.1:PORT') makes zero lookup calls), so
// this lookup-time check never sees a literal IP. providers/_http.mjs checks
// the literal itself before dialling; an earlier version of this comment
// claimed the opposite and the direct path shipped without that check.
//
// In this repo that is already 10+ test files that stand up a local HTTP
// server and fetch it. An env opt-out would have fixed the suite by disabling
// the guard exactly where it is most likely to regress, so instead
// providers/_http.mjs marks its own requests with the AsyncLocalStorage below
// and the patched lookup validates only inside that context.
//
// WHY AT LOOKUP TIME. The address validated has to be the address dialled, or
// a name that answers public-then-private (DNS rebinding) slips through a
// pre-flight check. Direct `net.connect` reads `dns.lookup` at call time and
// connects to what it returns, so validating there closes that window.
// With explicit trusted-proxy opt-in, only the proxy's own DNS lookup is
// exempted. The proxy resolves the destination remotely, so its operator must
// enforce the same public-address rule there; see README proxy setup.

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Set while a provider HTTP request is in flight. The patched dns.lookup
 * validates resolved addresses only when this is entered, so loopback stays
 * usable everywhere else in the process.
 *
 * @type {AsyncLocalStorage<{ url: string }>}
 */
export const providerFetchContext = new AsyncLocalStorage();

/** Is a provider request in flight on this async path? */
export function inProviderFetch() {
  return providerFetchContext.getStore() !== undefined;
}

/** Only the explicitly trusted proxy's own socket may resolve privately. */
export function isTrustedProxyLookup(hostname) {
  const context = providerFetchContext.getStore();
  return Boolean(context?.proxyHost && hostname === context.proxyHost && hostname !== context.targetHost);
}

/**
 * IPv4 ranges that must never be dialled by a provider.
 *
 * 169.254.0.0/16 is the one with teeth: 169.254.169.254 is the cloud instance
 * metadata endpoint on AWS/GCP/Azure, so it is the address an SSRF is usually
 * aimed at. The rest are the ordinary private/loopback/reserved space.
 *
 * @type {[number, number][]} [network, prefixLength]
 */
const V4_BLOCKED = [
  [0x00000000, 8],   // 0.0.0.0/8      "this network"
  [0x0A000000, 8],   // 10.0.0.0/8     RFC1918
  [0x64400000, 10],  // 100.64.0.0/10  CGNAT
  [0x7F000000, 8],   // 127.0.0.0/8    loopback
  [0xA9FE0000, 16],  // 169.254.0.0/16 link-local + cloud metadata
  [0xAC100000, 12],  // 172.16.0.0/12  RFC1918
  [0xC0000000, 24],  // 192.0.0.0/24   IETF protocol assignments
  [0xC0A80000, 16],  // 192.168.0.0/16 RFC1918
  [0xC6120000, 15],  // 198.18.0.0/15  benchmarking
  [0xE0000000, 4],   // 224.0.0.0/4    multicast
  [0xF0000000, 4],   // 240.0.0.0/4    reserved (includes 255.255.255.255)
];

/** Dotted-quad -> uint32, or null when it is not a well-formed IPv4 literal. */
function v4ToInt(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Canonical decimal octets only. A leading zero is rejected because
    // `0177.0.0.1` is octal for 127.0.0.1 in some parsers, and a form this
    // function reads as public while a connector reads as loopback is the
    // whole bypass. dns.lookup never emits a non-canonical quad, so this is
    // defence in depth rather than a live path — which is the right default
    // for a function whose job is to say "safe".
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/**
 * An IPv6 literal as its eight 16-bit groups, or null when it is not one.
 *
 * Written for the transition prefixes below: judging those by regex alone is how
 * `64:ff9b::7f00:1` reads as "some public IPv6" instead of the loopback address
 * it translates.
 *
 * @param {string} address - Lowercased address, no zone id, no brackets.
 * @returns {number[] | null}
 */
function expandV6(address) {
  if (!address.includes(':')) return null;
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const split = (part) => (part === '' ? [] : part.split(':'));
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  if (![...head, ...tail].every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  const nums = [...head, ...tail].map((group) => Number.parseInt(group, 16));
  if (halves.length === 2) {
    // `::` stands for at least one zero group, so eight-minus-one is the cap.
    if (nums.length > 7) return null;
    const headNums = head.map((g) => Number.parseInt(g, 16));
    const tailNums = tail.map((g) => Number.parseInt(g, 16));
    return [...headNums, ...new Array(8 - nums.length).fill(0), ...tailNums];
  }
  return nums.length === 8 ? nums : null;
}

/**
 * An IPv6 literal whose last colon-separated part is a dotted IPv4, rewritten
 * with that IPv4 as two hex groups. Anything else is returned unchanged.
 *
 * @param {string} address - Lowercased address, no zone id, no brackets.
 * @returns {string | null} The rewritten literal, or null when the quad is not a
 *   well-formed IPv4 address.
 */
function normalizeDottedTail(address) {
  const cut = address.lastIndexOf(':');
  if (cut === -1) return address;
  const tail = address.slice(cut + 1);
  if (!tail.includes('.')) return address;
  const quad = v4ToInt(tail);
  if (quad === null) return null;
  const high = ((quad >>> 16) & 0xffff).toString(16);
  const low = (quad & 0xffff).toString(16);
  return `${address.slice(0, cut + 1)}${high}:${low}`;
}

/**
 * Does this address belong to a range a provider must never connect to?
 *
 * Accepts both families. An IPv4-mapped or IPv4-compatible IPv6 address is
 * unwrapped and judged as IPv4 — `::ffff:127.0.0.1` is loopback however it is
 * spelled, and treating the two spellings differently is the bypass.
 *
 * The transition prefixes below are the same bypass one layer out: 6to4 and
 * NAT64 addresses carry an IPv4 address inside them, so `2002:7f00:1::` and
 * `64:ff9b::a9fe:a9fe` reach loopback and the cloud metadata endpoint on a host
 * that has a translator. They are judged by the IPv4 they carry, or blocked
 * outright where the prefix is translation-only space.
 *
 * @param {string} address - Resolved IP literal, as dns.lookup returns it.
 * @returns {boolean} True when the address is private/loopback/reserved.
 */
export function isBlockedAddress(address) {
  const raw = String(address ?? '').trim();
  if (!raw) return true; // nothing to validate is not the same as safe

  // Strip an RFC 4007 zone id (fe80::1%eth0) before parsing.
  const addr = raw.split('%')[0].toLowerCase();

  const asV4 = v4ToInt(addr);
  if (asV4 !== null) {
    return V4_BLOCKED.some(([net, bits]) => {
      const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
      return (asV4 & mask) >>> 0 === net;
    });
  }

  if (!addr.includes(':')) return true; // neither v4 nor v6 — refuse to guess

  // A trailing dotted IPv4 (`::1.2.3.4`, `2002:7f00:1::1.2.3.4`) is how an
  // address that carries an IPv4 is often written. Rewrite it as two hex groups
  // first so ONE path judges it: reading the tail on its own returned early and
  // judged a 6to4 address by the quad it ends with, never looking at the prefix
  // it starts with.
  const normalized = normalizeDottedTail(addr);
  if (normalized === null) return true; // a malformed quad is not safe to guess at

  const groups = expandV6(normalized);
  if (!groups) return true; // not a well-formed literal: refuse to guess
  {
    const v4At = (high, low) => `${groups[high] >> 8}.${groups[high] & 0xff}.${groups[low] >> 8}.${groups[low] & 0xff}`;
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d), in any
    // spelling IPv6 allows: `new URL('http://[::ffff:127.0.0.1]/').hostname` is
    // `[::ffff:7f00:1]`, and `0:0:0:0:0:ffff:127.0.0.1` is the same address
    // written out. Judging them from the groups rather than from a regex for the
    // compressed form is what makes the expanded spelling count.
    if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0
      && groups[4] === 0 && groups[5] === 0xffff) {
      return isBlockedAddress(v4At(6, 7));
    }
    if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0
      && groups[4] === 0 && groups[5] === 0 && (groups[6] !== 0 || groups[7] !== 0)) {
      return isBlockedAddress(v4At(6, 7));
    }
    // NAT64: the well-known 64:ff9b::/96, and 64:ff9b:1::/48 for local use. Both
    // are translation-only prefixes — no job board is published in either — so
    // the whole of 64:ff9b::/16 is refused without unwrapping anything.
    if (groups[0] === 0x0064 && groups[1] === 0xff9b) return true;
    // 6to4 (2002::/16) embeds the gateway's IPv4 in groups 1-2. Judge that
    // address: a 6to4 tunnel to a public host is not the threat, and blocking
    // the prefix wholesale would refuse ordinary public postings.
    if (groups[0] === 0x2002) return isBlockedAddress(v4At(1, 2));
    // IPv4-translated (::ffff:0:a.b.c.d, RFC 2765) is 0:0:0:0:ffff:0:a.b.c.d,
    // one group further left than the IPv4-mapped form handled above.
    if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0
      && groups[4] === 0xffff && groups[5] === 0) {
      return isBlockedAddress(v4At(6, 7));
    }
  }

  // The unspecified address and loopback. Judged from the groups, because `::`,
  // `::0:0`, `::0.0.0.0` and `0:0:0:0:0:0:0.0.0.0` are one address written four
  // ways: comparing the string with '::' let the other three through, and
  // `lib/egress-proxy.mjs` hands a raw CONNECT authority here without URL
  // parsing, so the spelling is the caller's to choose.
  if (groups.every((group) => group === 0) || normalized === '::1') return true;
  if (/^f[cd]/.test(normalized)) return true;                    // fc00::/7 unique local
  if (/^fe[89ab]/.test(normalized)) return true;                 // fe80::/10 link-local
  if (/^ff/.test(normalized)) return true;                       // ff00::/8 multicast
  return false;
}

// What a DNS filter answers for a name it blocks: 0.0.0.0 and ::. That is
// Pi-hole's default, and what AdGuard DNS and Control D answered for the
// trackers they blocked on 2026-10-11; hosts-file blocklists map names to
// 0.0.0.0 too, and so do sandboxed agent environments that filter egress at
// DNS. No site is published at either address, so an answer whose only
// private addresses are these is a filter at work, not a host resolving into
// private space.
export const SINKHOLE_ADDRESSES = new Set(['0.0.0.0', '::']);

/**
 * The error a blocked lookup fails with.
 *
 * Carries a `code` so it reads like any other DNS failure to callers that
 * branch on one, and is deliberately NOT in RESOLVER_FAILURE_CODES — this is a
 * verdict about one hostname, not a sick resolver, so it must not be
 * negative-cached as resolver health nor counted toward a resolver-outage
 * signal.
 *
 * When the name resolved only to sinkhole addresses, the message says so: a
 * sandbox or DNS filter blocking every board host otherwise reads like this
 * guard misfiring or a broken portals.yml entry.
 *
 * @param {string} hostname - The name that resolved.
 * @param {string} address - The address it resolved to.
 * @param {string[]} [addresses] - Every address it resolved to, when known.
 * @returns {Error}
 */
export function blockedAddressError(hostname, address, addresses = [address]) {
  // Only the private addresses decide, as for liveness-browser.mjs's
  // dns_sinkhole code: a filter that rewrites A records and passes AAAA
  // through answers 0.0.0.0 alongside a public address. A literal 0.0.0.0 in
  // a URL is not a filter's answer, so only a name gets the hint.
  const blocked = addresses.filter((a) => isBlockedAddress(a));
  const sinkholed = hostname !== address && blocked.length > 0
    && blocked.every((a) => SINKHOLE_ADDRESSES.has(String(a).toLowerCase()));
  const hint = sinkholed
    ? ' (likely a DNS filter or sandbox blocking this host; see docs/SCRIPTS.md#liveness)'
    : '';
  const err = new Error(
    `Refusing to connect to ${hostname}: resolves to non-public address ${address}${hint}`,
  );
  /** @type {any} */ (err).code = 'ECAREEROPS_BLOCKED_ADDRESS';
  /** @type {any} */ (err).hostname = hostname;
  /** @type {any} */ (err).address = address;
  return err;
}
