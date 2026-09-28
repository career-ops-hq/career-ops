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
 * Two env knobs, both read at import time:
 *   - `CAREER_OPS_NO_DNS_CACHE=1` opts out entirely — no memoization AND no
 *     pacing, since both live inside this patched lookup.
 *   - `CAREER_OPS_DNS_LOOKUPS_PER_MIN` caps resolver-bound lookups
 *     (default 400; `0` disables pacing but keeps the cache).
 */

import dns from 'node:dns';
import { inProviderFetch, isBlockedAddress, blockedAddressError } from './_ip-guard.mjs';

/**
 * DNS failures that mean *the resolver itself refused or failed*, as opposed
 * to answering "no such host". Only these are safe to negative-cache and to
 * treat as a resolver-health signal.
 *
 * ENOTFOUND is deliberately absent: it is NXDOMAIN, a legitimate per-host
 * answer that must stay uncached so a tenant appearing later is picked up.
 * ETIMEOUT is also absent: a query timeout is ambiguous between a slow
 * resolver and a refusing one, and #2229 scoped this to refusals.
 */
export const RESOLVER_FAILURE_CODES = new Set([
  'ENOTIMP',    // dns.NOTIMP   — what a rate-limiting Pi-hole replies with
  'EREFUSED',   // dns.REFUSED  — resolver refused the query outright
  'ESERVFAIL',  // dns.SERVFAIL — resolver failed to produce an answer
  'EAI_AGAIN',  // getaddrinfo temporary failure
]);

/**
 * Is this error (or anything it wraps) a resolver-level failure?
 *
 * Walks the `cause` chain because Node's `fetch()` reports every transport
 * error as `TypeError: fetch failed` and hangs the real error off `.cause`.
 * The walk is depth-bounded so a self-referential cause can't spin.
 *
 * @param {unknown} err - Error to inspect.
 * @returns {boolean} True when a resolver refusal/failure code is present.
 */
export function isResolverFailure(err) {
  for (let e = err, depth = 0; e && typeof e === 'object' && depth < 5; e = e.cause, depth++) {
    if (RESOLVER_FAILURE_CODES.has(/** @type {any} */ (e).code)) return true;
  }
  return false;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 512;
// Short by design: long enough to break the retry storm that a refusing
// resolver otherwise feeds (see #2229), short enough that a resolver coming
// back is picked up almost immediately.
const DEFAULT_NEGATIVE_TTL_MS = 30_000;
// Pacing defaults. The ceiling counts *lookups*; Node ≥20's autoSelectFamily
// turns each one into an A and an AAAA query, so 400 lookups/min is ~800
// upstream queries/min — comfortably under a stock Pi-hole's 1000/min, with
// headroom left for the rest of the machine (#2229).
const DEFAULT_LOOKUPS_PER_MIN = 400;
// One sweep worker per token, so a cold start of CONCURRENCY=20 workers
// (scan-ats-full.mjs) is admitted at once and pacing only bites afterwards.
// Small runs against a handful of hostnames are therefore never slowed.
const DEFAULT_BURST = 20;
// setTimeout clamps anything larger to 1ms (and warns), which would turn a
// long refill wait into a 1ms spin that never gains a token. Cap instead and
// re-arm: a rate that slow simply wakes, finds no token, and waits again.
const MAX_TIMER_MS = 2_147_483_647;

/**
 * A token bucket: `capacity` calls may run at once, refilling at `ratePerMin`.
 *
 * The cache in this file collapses *repeat* lookups of one hostname, which is
 * total for greenhouse/lever/ashby (1 host each) and structurally inert for
 * workday and icims, where every tenant has its own hostname. Those lookups
 * are all genuinely distinct — nothing to deduplicate — so the only remaining
 * lever is how fast they are issued (#2229).
 *
 * Clock and timer are injectable so the tests are deterministic and offline.
 *
 * @param {object} [options] - Bucket tuning.
 * @param {number} [options.ratePerMin] - Sustained calls per minute. Must be > 0.
 * @param {number} [options.capacity] - Burst size, in tokens.
 * @param {() => number} [options.now] - Clock source, injectable for tests.
 * @param {(fn: Function, ms: number) => void} [options.setTimer] - Timer, injectable for tests.
 * @returns {{ take: (fn: Function) => void, pending: number, stats: () => { delayed: number, waitedMs: number } }}
 */
export function createTokenBucket(options = {}) {
  const ratePerMin = options.ratePerMin ?? DEFAULT_LOOKUPS_PER_MIN;
  const capacity = options.capacity ?? DEFAULT_BURST;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;

  // Caller-supplied, so validate rather than assert: a zero or negative rate
  // would make the refill interval Infinity and hang every queued lookup.
  if (!Number.isFinite(ratePerMin) || ratePerMin <= 0) {
    throw new RangeError(`ratePerMin must be a finite number > 0, got ${ratePerMin}`);
  }
  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new RangeError(`capacity must be a finite number >= 1, got ${capacity}`);
  }

  const tokensPerMs = ratePerMin / 60_000;
  let tokens = capacity;
  let lastRefill = now();
  /** @type {{ fn: Function, queuedAt: number }[]} */
  const queue = [];
  let timerPending = false;
  let delayed = 0;
  let waitedMs = 0;

  function refill() {
    const t = now();
    tokens = Math.min(capacity, tokens + (t - lastRefill) * tokensPerMs);
    lastRefill = t;
  }

  function schedule() {
    if (timerPending || queue.length === 0) return;
    timerPending = true;
    // At least 1ms: a fractional token left over must not schedule a 0ms spin.
    // At most MAX_TIMER_MS: past that setTimeout clamps to 1ms and spins.
    setTimer(pump, Math.min(MAX_TIMER_MS, Math.max(1, Math.ceil((1 - tokens) / tokensPerMs))));
  }

  function pump() {
    timerPending = false;
    refill();
    try {
      // Bounded by queue length and by the tokens available this tick — both
      // finite, so this cannot spin.
      while (queue.length > 0 && tokens >= 1) {
        tokens -= 1;
        const { fn, queuedAt } = /** @type {{ fn: Function, queuedAt: number }} */ (queue.shift());
        delayed++;
        waitedMs += now() - queuedAt;
        fn();
      }
    } finally {
      schedule();
    }
  }

  return {
    /**
     * Run `fn` as soon as a token allows. FIFO: a queued call is never
     * overtaken by a later one, so no hostname can be starved.
     *
     * The queue needs no cap of its own — it holds at most one entry per
     * in-flight connection, and the sweep's own CONCURRENCY bounds that.
     *
     * @param {Function} fn - Work to admit.
     * @returns {void}
     */
    take(fn) {
      refill();
      if (queue.length === 0 && tokens >= 1) {
        tokens -= 1;
        fn();
        return;
      }
      queue.push({ fn, queuedAt: now() });
      schedule();
    },
    /** @returns {number} Calls queued but not yet run. */
    get pending() { return queue.length; },
    /** @returns {{ delayed: number, waitedMs: number }} Counters for operator reporting. */
    stats() { return { delayed, waitedMs }; },
  };
}

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
 * @param {number} [options.lookupsPerMin] - Ceiling on resolver-bound lookups; 0 disables pacing.
 * @param {number} [options.burst] - Tokens available at once before pacing bites.
 * @param {(fn: Function, ms: number) => void} [options.setTimer] - Timer, injectable for tests.
 * @returns {Function} A drop-in replacement for `dns.lookup`.
 */
export function createCachedLookup(realLookup, options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const lookupsPerMin = options.lookupsPerMin ?? DEFAULT_LOOKUPS_PER_MIN;
  // No bucket at all when pacing is off, so the disabled path costs nothing.
  const bucket = lookupsPerMin > 0
    ? createTokenBucket({
      ratePerMin: lookupsPerMin,
      capacity: options.burst ?? DEFAULT_BURST,
      now,
      setTimer: options.setTimer,
    })
    : null;

  /** @type {Map<string, { expires: number, args: any[] }>} */
  const cache = new Map();
  /** @type {Map<string, Function[]>} */
  const inflight = new Map();

  /**
   * Wrap a lookup callback so a non-public address never reaches the connector
   * (#3096).
   *
   * Applied at ENTRY, so it covers all three ways a result is delivered: a
   * fresh resolver answer, a cache HIT, and a coalesced waiter. Validating
   * only the resolver path would leave the cache as the hole — a hostname
   * resolved outside a provider fetch is cached unvalidated, and the next
   * provider fetch for that name would be served the private address from
   * memory without ever reaching the check.
   *
   * Only inside a provider request: this lookup is patched process-wide, and
   * loopback has to keep working for everything else (see _ip-guard.mjs).
   */
  function guarded(hostname, callback) {
    if (!inProviderFetch()) return callback;
    return (err, ...rest) => {
      if (err) return callback(err, ...rest);
      // all:true yields one array of {address, family}; otherwise (address, family).
      const addresses = Array.isArray(rest[0])
        ? rest[0].map((entry) => entry && entry.address)
        : [rest[0]];
      const bad = addresses.find((address) => isBlockedAddress(address));
      if (bad !== undefined) return callback(blockedAddressError(hostname, bad));
      return callback(err, ...rest);
    };
  }

  function cachedLookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    callback = guarded(hostname, callback);
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

    // Only the leader of a coalesced group reaches the resolver, so only the
    // leader spends a token: cache hits and queued waiters are free. That is
    // what keeps pacing proportional to *distinct hostnames* rather than to
    // request volume — greenhouse's 8,333 boards still cost one lookup, while
    // workday's 3,781 tenants and icims's 10,108 are metered (#2229).
    //
    // The key stays in `inflight` while the thunk waits for a token, so a
    // later caller for the same hostname coalesces onto it instead of queueing
    // a second one.
    const resolve = () => realLookup(hostname, opts, (err, ...rest) => {
      const callbacks = inflight.get(key) ?? [];
      inflight.delete(key);

      // Successes cache for the full TTL. Resolver-level refusals cache for a
      // much shorter one: not caching them at all is what turns a rate-limited
      // resolver into a self-sustaining flood, because every worker retries a
      // refusal that costs the resolver another query to reject (#2229).
      // Everything else — NXDOMAIN above all — stays uncached as before, so a
      // transient blip is never pinned in for the whole TTL window.
      const ttl = err ? (isResolverFailure(err) ? negativeTtlMs : 0) : ttlMs;
      if (ttl > 0) {
        // Oldest-first eviction; insertion order is good enough for a cap
        // this size, and avoids tracking per-entry access times.
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
        cache.set(key, { expires: now() + ttl, args: err ? [err] : [null, ...rest] });
      }

      for (const cb of callbacks) cb(err, ...rest);
    });

    if (bucket) bucket.take(resolve); else resolve();
  }

  // dns.lookup carries an internal symbol telling util.promisify which
  // callback arguments to collect. Copy it across or promisify(dns.lookup)
  // silently starts yielding only the address, dropping the family.
  for (const sym of Object.getOwnPropertySymbols(realLookup)) {
    cachedLookup[sym] = realLookup[sym];
  }

  /** @returns {{ delayed: number, waitedMs: number }} How much pacing cost this process. */
  cachedLookup.pacingStats = () => (bucket ? bucket.stats() : { delayed: 0, waitedMs: 0 });

  return cachedLookup;
}

/**
 * Read the pacing ceiling from the environment.
 *
 * Unparseable values warn and fall back rather than throwing: this runs at
 * import time inside every scanner, and a typo in an env var must not take
 * the whole run down.
 *
 * @param {Record<string, string | undefined>} [env] - Environment to read.
 * @returns {number} Lookups per minute; 0 disables pacing.
 */
export function lookupsPerMinFromEnv(env = process.env) {
  const raw = env.CAREER_OPS_DNS_LOOKUPS_PER_MIN;
  // Trim before the blank check: Number(' ') is 0, and 0 is the documented
  // "pacing off" value, so a whitespace-only setting would silently disable
  // the limiter rather than fall back like any other unusable value.
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_LOOKUPS_PER_MIN;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(
      `⚠ CAREER_OPS_DNS_LOOKUPS_PER_MIN=${raw} is not a non-negative number — `
      + `using the default ${DEFAULT_LOOKUPS_PER_MIN} lookups/min`,
    );
    return DEFAULT_LOOKUPS_PER_MIN;
  }
  return n;
}

/** @type {{ pacingStats: () => { delayed: number, waitedMs: number } } | null} */
let patched = null;

/**
 * Pacing counters for the process-wide patched lookup.
 *
 * Zeroes when the patch is opted out, so callers never need to branch.
 *
 * @returns {{ delayed: number, waitedMs: number }} Delayed lookup count and total wait.
 */
export function dnsPacingStats() {
  return patched ? patched.pacingStats() : { delayed: 0, waitedMs: 0 };
}

if (process.env.CAREER_OPS_NO_DNS_CACHE !== '1') {
  patched = createCachedLookup(dns.lookup, { lookupsPerMin: lookupsPerMinFromEnv() });
  dns.lookup = patched;
}
