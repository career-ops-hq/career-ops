/**
 * lib/deferred-board-retry.mjs — retry boards that were rate-limited or
 * challenged, AFTER the sweep, at reduced concurrency, with backoff.
 *
 * A board whose first request meets `429` or a Cloudflare challenge
 * (`cf-mitigated: challenge`) used to be dropped for the whole run: the
 * request-level retry in providers/_http.mjs deliberately does not repeat a
 * challenge into the same burst (#7182), and scan.mjs's transient second pass
 * only takes network/5xx failures. On 2026-11-19/20 that dropped 83-84 boards
 * per full scan although a single request minutes later returned 200.
 *
 * The edge clears with time and reduced load, so the board — not the request —
 * is the unit to retry: re-queue it, wait out the Retry-After (or an
 * exponential backoff, bounded), then run it again with only a few boards in
 * flight. A board that is still refused after the last round stays failed and
 * is reported as such by the caller. This is the AWS Builders' Library advice
 * ("Timeouts, retries, and backoff with jitter"): retry with the load reduced,
 * and honor the server's own signal of when to come back.
 */

import { isCloudflareChallenge, parseRetryAfterMs } from '../providers/_http.mjs';

export const RATE_LIMIT_RETRY_DEFAULTS = Object.freeze({
  // Rounds after the sweep. Each round waits longer than the last.
  rounds: 3,
  // First round waits this long after the board FAILED (not after the sweep):
  // the sweep itself usually covers most of it. Doubles each round.
  base_delay_s: 60,
  // Upper bound on any one wait, Retry-After included.
  max_delay_s: 300,
  // Boards in flight at once during a retry round (the sweep runs 10).
  concurrency: 2,
});

/** Whether a board failure is a rate signal worth a deferred retry. */
export function isRateLimitedError(err) {
  return err?.status === 429 || isCloudflareChallenge(err);
}

/**
 * portals.yml `rate_limit_retry` → a validated policy. Bad values fall back
 * per key with a warning; `rounds: 0` is allowed and turns the pass off.
 */
export function resolveRateLimitRetry(raw, warn = () => {}) {
  const out = { ...RATE_LIMIT_RETRY_DEFAULTS };
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warn(`rate_limit_retry must be a mapping; using defaults`);
    return out;
  }
  for (const key of Object.keys(RATE_LIMIT_RETRY_DEFAULTS)) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const n = Number(raw[key]);
    const min = key === 'rounds' ? 0 : key === 'concurrency' ? 1 : 0;
    const ok = Number.isFinite(n) && n >= min && (key === 'rounds' || key === 'concurrency' ? Number.isInteger(n) : true);
    if (ok) out[key] = n;
    else warn(`rate_limit_retry.${key} must be a ${key === 'rounds' || key === 'concurrency' ? 'whole number' : 'number'} >= ${min}, got ${JSON.stringify(raw[key])}; using ${out[key]}`);
  }
  return out;
}

/** A queue item for a board that failed on a rate signal. */
export function rateLimitedItem(company, err, failedAt = Date.now()) {
  return { company, failedAt, retryAfterMs: parseRetryAfterMs(err?.retryAfter) };
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Drain `queue` in rounds. `runBoard` re-runs one board; when it fails on a
 * rate signal again, the caller's own error path pushes it back onto `queue`
 * (that is how scan.mjs's recordError already works), so the next round picks
 * it up. Whatever is left in `queue` afterwards ended failed.
 *
 * @param {{
 *   queue: Array<{ company: any, failedAt: number, retryAfterMs: number|null }>,
 *   runBoard: (company: any, item: object) => Promise<void>,
 *   beforeRetry?: (item: object) => void,
 *   policy?: typeof RATE_LIMIT_RETRY_DEFAULTS,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   log?: (line: string) => void,
 *   nameOf?: (company: any) => string,
 * }} options
 * @returns {Promise<{ rounds: number, retried: Set<any> }>}
 */
export async function retryRateLimitedBoards({
  queue,
  runBoard,
  beforeRetry = () => {},
  policy = RATE_LIMIT_RETRY_DEFAULTS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
  nameOf = (c) => c?.name ?? String(c),
}) {
  const retried = new Set();
  let round = 0;
  const maxMs = policy.max_delay_s * 1000;
  while (queue.length > 0 && round < policy.rounds) {
    round++;
    const pending = queue.splice(0);
    const backoffMs = Math.min(policy.base_delay_s * 1000 * 2 ** (round - 1), maxMs);
    // Each board waits at least the backoff since IT failed, and at least what
    // its own Retry-After asked for; the round starts when the latest is due.
    const dueAt = Math.max(...pending.map((p) => p.failedAt + Math.min(Math.max(backoffMs, p.retryAfterMs ?? 0), maxMs)));
    const waitMs = Math.max(0, dueAt - now());
    log(`scan: ${pending.length} board(s) were rate-limited or challenged; retry round ${round} of ${policy.rounds} in ${Math.round(waitMs / 1000)}s, ${policy.concurrency} at a time: ${pending.map((p) => nameOf(p.company)).join(', ')}`);
    if (waitMs > 0) await sleep(waitMs);
    await pool(pending, policy.concurrency, async (item) => {
      retried.add(item.company);
      beforeRetry(item);
      await runBoard(item.company, item);
    });
    // A round that read NONE of its boards says the refusal is not wearing
    // off with time (measured 2026-11-20: Workday's challenge keys on the
    // client, not the rate). Further rounds would only repeat it.
    if (queue.length > 0 && queue.length >= pending.length) {
      log(`scan: retry round ${round} read none of ${pending.length} rate-limited board(s); stopping the retry rounds (the refusal is not time-based)`);
      break;
    }
  }
  return { rounds: round, retried };
}
