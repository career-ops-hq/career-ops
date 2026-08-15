import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";

/**
 * ACL for the core's tracker lock (`tracker-utils.mjs`).
 *
 * WHY A WEB ROUTE NEEDS IT. `atomicWrite` makes the WRITE atomic, not the
 * read-modify-write around it. Two writers each read the whole tracker, each
 * edit their own row, each rename their full copy back: the second discards the
 * first's change. Every call succeeds, the file is well-formed at every instant,
 * and one row silently reverts (#2900). Reproduced before fixing:
 *
 *   row 1 → Applied     (wanted Applied)
 *   row 2 → Evaluated   (wanted Interview)   ← lost, no error anywhere
 *
 * The other writer is not hypothetical: the web exists to be used ALONGSIDE the
 * CLI, and `set-status.mjs`, `mark-pdf-ready.mjs` and `reserve-report-num.mjs`
 * all take this lock already.
 *
 * NOT `run-registry`'s acquireTrackerWrite(): that is an in-memory counter which
 * tells this process whether a run is in flight. It cannot see another process.
 * Two guards, different scopes — the reason this survived review is that the
 * route looked protected.
 *
 * THE LOCK IS NOT REENTRANT (checked: no owner/pid self-check in
 * tracker-utils.mjs). So a caller holding it must never invoke a core script
 * that takes it too — that self-deadlocks until the timeout. Direct writers only.
 *
 * A crashed holder does NOT wedge the tracker: `lockCanRecover` reads the
 * owner's pid and recovers when that process is gone. But a LIVE process that
 * leaks the lock (a throw with no `finally`) keeps its pid alive, so recovery
 * waits out staleMs — hence the mandatory `finally` in withTrackerLock.
 */
type CoreLock = { release: () => void | Promise<void> };
type AcquireFn = (lockDir: string, options: Record<string, unknown>) => Promise<CoreLock>;
type LockDirFn = (trackerPath: string) => string;

/** Cached per resolved module path; failures are NEVER cached, so a repaired or
 *  newly-installed checkout is picked up on the next request (#2590). */
const modCache = new Map<string, { acquire: AcquireFn; lockDirFor: LockDirFn }>();

async function loadCoreLock() {
  const file = path.join(careerOpsRoot(), "tracker-utils.mjs");
  const cached = modCache.get(file);
  if (cached) return cached;
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(file).href);
  if (typeof mod.acquireTrackerLock !== "function" || typeof mod.trackerLockDirFor !== "function") {
    throw new Error("tracker-utils.mjs has no acquireTrackerLock/trackerLockDirFor");
  }
  const api = { acquire: mod.acquireTrackerLock as AcquireFn, lockDirFor: mod.trackerLockDirFor as LockDirFn };
  modCache.set(file, api);
  return api;
}

/** Thrown when the lock is held by someone else for longer than we will wait. */
export class TrackerBusyError extends Error {
  constructor() {
    super("tracker is being written by another process");
    this.name = "TrackerBusyError";
  }
}

/**
 * Run `fn` holding the core's tracker lock, and release it on EVERY path.
 *
 * The timeout is deliberately far shorter than the CLI's 60s: this runs inside
 * an HTTP handler, where a minute of silence is indistinguishable from a hang.
 * Failing fast lets the caller answer 409 and the user retry, which is a better
 * experience than a request that eventually succeeds after the user gave up.
 *
 * @param trackerFile absolute path to data/applications.md
 * @param fn the read-modify-write to run under the lock
 */
export async function withTrackerLock<T>(trackerFile: string, fn: () => T | Promise<T>): Promise<T> {
  const { acquire, lockDirFor } = await loadCoreLock();
  let lock: CoreLock;
  try {
    lock = await acquire(lockDirFor(trackerFile), {
      timeoutMs: Number(process.env.CAREER_OPS_WEB_LOCK_TIMEOUT_MS) || 5_000,
      retryMs: 50,
      tracker: trackerFile,
    });
  } catch {
    throw new TrackerBusyError();
  }
  try {
    return await fn();
  } finally {
    // MANDATORY. A leaked lock on a long-lived server process is worse than the
    // bug this fixes: the holder's pid stays alive, so the core's stale-recovery
    // will not reclaim it and the user's own CLI is locked out until staleMs.
    await lock.release();
  }
}
