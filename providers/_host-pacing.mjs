/**
 * providers/_host-pacing.mjs — one request budget per HOST FAMILY.
 *
 * Why a family and not a hostname: every Workday tenant has its own hostname
 * (`visa.wd5.myworkdayjobs.com`, `adobe.wd5.myworkdayjobs.com`, ...), but all
 * of them sit behind one shared Cloudflare edge that rate-limits the CLIENT,
 * not the tenant. scan.mjs's HOST_CONCURRENCY caps one hostname, so ten
 * Workday boards in parallel were ten separate buckets adding up to one burst
 * against one limit. On 2026-11-19/20 two full scans each had 83-84 of 91
 * Workday boards answer `429 cf-mitigated: challenge` within the first ~30 s
 * of the sweep, while a single request to the same endpoint minutes later
 * returned 200: rate-triggered edge mitigation, not a block.
 *
 * The fix is to pace the family as a whole: every request to any host in the
 * family takes a slot from ONE scheduler, so the edge sees a steady rate no
 * matter how many tenants the sweep runs at once. The scheduler is a
 * token bucket of capacity 1 (a minimum interval between request starts),
 * the same shape as providers/_dns-cache.mjs's resolver pacing.
 *
 * It is also adaptive, the AIMD pattern TCP congestion control uses: a 429 or
 * a Cloudflare challenge anywhere in the family doubles the family's interval
 * (bounded) and holds every request until the Retry-After, or a default
 * cooldown, has passed; a run of successes halves it back toward the
 * configured rate. One tenant's rate signal therefore slows the whole family,
 * which is exactly what a shared edge limit calls for.
 *
 * Polite by construction: pacing only ever waits. It never retries a
 * challenge, never alters headers, never rotates anything.
 *
 * OFF unless portals.yml `host_pacing` sets a rate for a family (scan.mjs
 * passes that block in), so unit tests that stub fetch for Workday hosts and
 * the other entry points keep their current timing. See
 * SUGGESTED_REQUESTS_PER_MINUTE for why it is not on by default.
 */

import { currentAbortSignal } from './_connection-scope.mjs';

/**
 * Families of hosts that share one upstream rate limit.
 * `myworkdaysite.com` is Workday's alternate public host for the same CXS API.
 */
export const HOST_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'workday',
    test: (host) => /(^|\.)myworkdayjobs\.com$/i.test(host) || /(^|\.)myworkdaysite\.com$/i.test(host),
  }),
]);

/**
 * Suggested request rate per family, requests per minute — NOT applied unless
 * portals.yml `host_pacing.<family>.requests_per_minute` sets a rate.
 *
 * Measured 2026-11-20: pacing does not cure the Workday challenges seen on
 * 2026-11-19/20. A run of page 0 of all 90 Workday boards through this pacer
 * at <= 60/min (the adaptive backoff took it down to 7.5/min) still had 83
 * of 90 answer `429 cf-mitigated: challenge`, the same 83 the unpaced scan
 * lost, while at the same moment `curl` and Node's `node:https` got 200 from
 * the same endpoint and IP. The challenge keys on how Node's built-in fetch
 * (undici) presents the request, not on the rate. So pacing is opt-in: it
 * costs minutes per scan and buys nothing against that, but it is the right
 * tool if a family is ever shown to be rate-triggered.
 */
export const SUGGESTED_REQUESTS_PER_MINUTE = Object.freeze({ workday: 60 });

// Cooldown applied to the whole family after a 429/challenge without a usable
// Retry-After. The edge was measured clear "minutes later"; 30 s is the floor,
// the doubled interval does the rest, and deferred board retry (scan.mjs)
// covers the boards that failed in the meantime.
const DEFAULT_COOLDOWN_MS = 30_000;
// A hostile or misconfigured Retry-After must not stall a scan for an hour.
const MAX_COOLDOWN_MS = 5 * 60_000;
// The adaptive interval never grows past base x this.
const MAX_BACKOFF_FACTOR = 8;
// Consecutive successes before the interval halves back toward base.
const RECOVER_AFTER = 20;

function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', done);
      resolve();
    }
    signal?.addEventListener?.('abort', done, { once: true });
  });
}

/**
 * A minimum-interval scheduler with adaptive backoff.
 *
 * @param {{
 *   requestsPerMinute: number,
 *   now?: () => number,
 *   sleep?: (ms: number, signal?: AbortSignal|null) => Promise<void>,
 *   cooldownMs?: number,
 *   maxCooldownMs?: number,
 *   maxBackoffFactor?: number,
 *   recoverAfter?: number,
 * }} options
 */
export function createPacer({
  requestsPerMinute,
  now = () => Date.now(),
  sleep = defaultSleep,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  maxCooldownMs = MAX_COOLDOWN_MS,
  maxBackoffFactor = MAX_BACKOFF_FACTOR,
  recoverAfter = RECOVER_AFTER,
}) {
  if (!(requestsPerMinute > 0)) throw new RangeError(`requestsPerMinute must be > 0, got ${requestsPerMinute}`);
  const baseIntervalMs = 60_000 / requestsPerMinute;
  let intervalMs = baseIntervalMs;
  let nextAt = -Infinity;
  let successStreak = 0;
  let holdUntil = -Infinity;
  const stats = { requests: 0, delayed: 0, waitedMs: 0, rateLimited: 0, maxIntervalMs: baseIntervalMs };

  return {
    baseIntervalMs,
    get intervalMs() { return intervalMs; },
    /**
     * Reserve the next slot and wait for it. Reservations are taken
     * synchronously, so concurrent callers queue in call order.
     *
     * @param {AbortSignal|null} [signal] - Resolve early if aborted (board watchdog).
     * @returns {Promise<number>} Milliseconds waited.
     */
    async acquire(signal = null) {
      const t = now();
      const slot = Math.max(t, nextAt);
      nextAt = slot + intervalMs;
      stats.requests++;
      const wait = slot - t;
      if (wait > 0) {
        stats.delayed++;
        stats.waitedMs += wait;
        await sleep(wait, signal);
      }
      return wait;
    },
    /** A request in the family succeeded. */
    onSuccess() {
      successStreak++;
      if (successStreak >= recoverAfter && intervalMs > baseIntervalMs) {
        intervalMs = Math.max(baseIntervalMs, intervalMs / 2);
        successStreak = 0;
      }
    },
    /**
     * A request in the family got a 429 or a challenge: slow the family down
     * and hold it until the cooldown has passed.
     *
     * @param {number|null} [retryAfterMs]
     */
    onRateLimited(retryAfterMs = null) {
      stats.rateLimited++;
      // A signal that lands while the family is already held came from a
      // request sent before the hold; it must not stack a second hold.
      if (now() < holdUntil) return;
      successStreak = 0;
      intervalMs = Math.min(intervalMs * 2, baseIntervalMs * maxBackoffFactor);
      stats.maxIntervalMs = Math.max(stats.maxIntervalMs, intervalMs);
      const hold = Number.isFinite(retryAfterMs) && retryAfterMs >= 0
        ? Math.min(Math.max(retryAfterMs, intervalMs), maxCooldownMs)
        : cooldownMs;
      holdUntil = now() + hold;
      nextAt = Math.max(nextAt, holdUntil);
    },
    stats() { return { ...stats, intervalMs }; },
  };
}

/** @type {Map<string, ReturnType<typeof createPacer>>} */
let pacers = new Map();

/**
 * Validate one `requests_per_minute` value from portals.yml. Unset means the
 * family is not paced; a bad value warns and leaves it unpaced.
 */
export function resolveRequestsPerMinute(raw, warn = () => {}, family = '') {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  warn(`host_pacing.${family}.requests_per_minute must be a positive number, got ${JSON.stringify(raw)}; ${family} is NOT paced this run`);
  return null;
}

/**
 * Turn pacing on for every known family. Called once by scan.mjs before the
 * sweep. Replaces any earlier configuration.
 *
 * @param {Record<string, { requests_per_minute?: number }>|null|undefined} config - portals.yml `host_pacing`.
 * @param {{ now?: () => number, sleep?: Function, warn?: (msg: string) => void }} [deps]
 */
export function configureHostPacing(config = {}, deps = {}) {
  const { warn = () => {}, ...clock } = deps;
  pacers = new Map();
  for (const family of HOST_FAMILIES) {
    const rpm = resolveRequestsPerMinute(config?.[family.id]?.requests_per_minute, warn, family.id);
    if (rpm !== null) pacers.set(family.id, createPacer({ requestsPerMinute: rpm, ...clock }));
  }
  return Object.fromEntries([...pacers].map(([id, p]) => [id, 60_000 / p.baseIntervalMs]));
}

/** Turn pacing off (tests). */
export function resetHostPacing() {
  pacers = new Map();
}

/** @returns {string|null} The family id a hostname belongs to. */
export function hostFamily(host) {
  const h = String(host || '').toLowerCase();
  for (const family of HOST_FAMILIES) if (family.test(h)) return family.id;
  return null;
}

/** @returns {ReturnType<typeof createPacer>|null} The active pacer for a hostname, if pacing is on. */
export function pacerForHost(host) {
  const id = hostFamily(host);
  return id ? pacers.get(id) ?? null : null;
}

/** Wait for a slot if `host` is in a paced family. No-op otherwise. */
export async function paceHost(host) {
  const pacer = pacerForHost(host);
  if (pacer) await pacer.acquire(currentAbortSignal());
  return pacer;
}

/** @returns {Record<string, object>} Per-family pacing counters for the run summary. */
export function hostPacingStats() {
  return Object.fromEntries([...pacers].map(([id, p]) => [id, p.stats()]));
}
