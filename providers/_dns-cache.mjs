// @ts-check
/**
 * _dns-cache.mjs — in-process DNS memoization for the scanners.
 *
 * Node's `fetch()` resolves the hostname once per *connection* it opens, and
 * keeps no DNS cache of its own. Sequential requests are cheap — undici's
 * keep-alive reuses the socket — but the sweeps run their requests in
 * parallel, and every concurrent connection resolves independently. Measured
 * against a local server (30 requests to one hostname):
 *
 *     sequential           2 lookups
 *     30 in parallel      29 lookups   <-- one per connection
 *
 * Scaled across a full directory sweep that reached ~37k lookups for a single
 * hostname in one run. On a host whose resolver rate-limits per client (a
 * Pi-hole's default is 1000/min) that trips the limit and breaks DNS for the
 * whole machine, not just the scan.
 *
 * Because the driver is concurrency rather than request count, coalescing
 * in-flight misses is the load-bearing part of this file — a plain TTL cache
 * would still let a cold parallel burst through. With both, the 29 above
 * becomes 1.
 *
 * Why patch `dns.lookup` rather than configure the HTTP client: career-ops
 * depends on no HTTP library — providers call the global `fetch()`. Node
 * exposes no supported way to give `fetch()` a custom resolver without
 * taking on `undici` as a direct dependency to build an `Agent` with a
 * `connect.lookup` option. Patching the `node:dns` module object keeps the
 * dependency list untouched: `net.connect` reads `dns.lookup` at call time,
 * so importing this file once (`_http.mjs` does) covers every provider and
 * every direct `fetch()` in the process.
 *
 * Scope of the patch — deliberately narrow:
 *   - Only the callback-style `dns.lookup` on the `node:dns` module object.
 *   - `dns/promises` has its own independent `lookup` and is NOT affected.
 *     That matters: the SSRF egress guard in `upskill.mjs` resolves through
 *     `dns/promises` (`dns.resolve` + `dns.promises.lookup`), so its
 *     validation still hits the resolver every time and cannot be poisoned
 *     by this cache. Verify with:
 *       node -e "const d=require('dns'),p=require('dns/promises');let n=0; \
 *         const r=d.lookup; d.lookup=(...a)=>{n++;return r(...a)}; \
 *         p.lookup('example.com').then(()=>console.log('promises hit patch:',n>0))"
 *   - Failed resolutions are never cached, so an outage cannot be pinned in.
 *
 * Opt out entirely with `CAREER_OPS_NO_DNS_CACHE=1`.
 */

import dns from 'node:dns';

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 512;

/**
 * Build a caching wrapper around a callback-style `dns.lookup`.
 *
 * Exported for the test suite, which drives it with a stub resolver so the
 * cache semantics can be asserted without touching the network.
 *
 * @param {Function} realLookup - The underlying `dns.lookup` to memoize.
 * @param {object} [options] - Cache tuning.
 * @param {number} [options.ttlMs] - How long a successful result stays fresh.
 * @param {number} [options.maxEntries] - Cap on distinct cached keys.
 * @param {() => number} [options.now] - Clock source, injectable for tests.
 * @returns {Function} A drop-in replacement for `dns.lookup`.
 */
export function createCachedLookup(realLookup, options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;

  /** @type {Map<string, { expires: number, args: any[] }>} */
  const cache = new Map();
  /** @type {Map<string, Function[]>} */
  const inflight = new Map();

  function cachedLookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    // dns.lookup accepts a bare family number in place of an options object.
    const opts = typeof options === 'number' ? { family: options } : (options ?? {});
    const key = `${hostname}|${opts.family ?? 0}|${opts.all ? 1 : 0}|${opts.hints ?? 0}|${opts.verbatim ?? ''}`;

    const hit = cache.get(key);
    if (hit && hit.expires > now()) {
      // Stay asynchronous on a hit: callers (net.connect among them) assume
      // the callback never fires before lookup() returns.
      process.nextTick(callback, ...hit.args);
      return;
    }

    // Coalesce concurrent misses. Without this the cache is useless against
    // the burst it exists to stop: a sweep opens its workers in parallel, so
    // on a cold key every one of them would miss and hit the resolver before
    // the first result lands.
    const waiting = inflight.get(key);
    if (waiting) {
      waiting.push(callback);
      return;
    }
    inflight.set(key, [callback]);

    realLookup(hostname, opts, (err, ...rest) => {
      const callbacks = inflight.get(key) ?? [];
      inflight.delete(key);

      // Never cache failures — a transient resolver blip must not be pinned
      // in for the whole TTL window.
      if (!err) {
        // Oldest-first eviction; insertion order is good enough for a cap
        // this size, and avoids tracking per-entry access times.
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
        cache.set(key, { expires: now() + ttlMs, args: [null, ...rest] });
      }

      for (const cb of callbacks) cb(err, ...rest);
    });
  }

  // dns.lookup carries an internal symbol telling util.promisify which
  // callback arguments to collect. Copy it across or promisify(dns.lookup)
  // silently starts yielding only the address, dropping the family.
  for (const sym of Object.getOwnPropertySymbols(realLookup)) {
    cachedLookup[sym] = realLookup[sym];
  }

  return cachedLookup;
}

if (process.env.CAREER_OPS_NO_DNS_CACHE !== '1') {
  dns.lookup = createCachedLookup(dns.lookup);
}
