import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";

/**
 * ACL for the core's follow-ups file lock (`followup-seed.mjs`).
 *
 * WHY A WEB ROUTE NEEDS IT. `data/follow-ups.md` is a read-modify-write from
 * two directions: the web's log/override routes AND the core's cadence seeder
 * (`followup-seed.mjs`, which takes this same lock). `atomicWrite` makes the
 * WRITE atomic, not the read-modify-write around it — two writers each read the
 * whole file, each edit, each rename their full copy back, and one change
 * silently reverts. Same failure family as the tracker (#2900), same cure.
 *
 * NOT `withLogLock` (followups-server.ts): that is an in-process promise queue.
 * It serializes THIS process's own requests and is blind to the user's CLI —
 * "no cross-process lock needed" is true for web-vs-web and false for
 * web-vs-seeder. Two guards, different scopes; they compose (see
 * `withFollowupsWrite`), neither substitutes for the other.
 *
 * WE DO NOT DERIVE THE LOCK DIRECTORY. The core computes it from a sha256 of the
 * resolved path, entirely inside `followup-seed.mjs`. We import `withFollowupsLock`
 * and pass our path; the core resolves the path and the lockDir. Recomputing the
 * hash web-side would birth a second body of the same truth that has to stay in
 * sync forever — the exact class of bug this whole change closes (#3034).
 *
 * THE LOCK IS NOT REENTRANT (no owner/pid self-check in the core). A caller
 * holding it must never orchestrate a core script that also takes it — that
 * self-deadlocks until the timeout. Our two routes write the file DIRECTLY, so
 * this is safe today; it is a rule for any future followups writer that shells
 * out.
 *
 * `finally`-release lives in the core export, so it cannot be forgotten here.
 * The web timeout is deliberately far shorter than the CLI's 60s default: a
 * minute of silence inside an HTTP handler is indistinguishable from a hang, so
 * we fail fast and answer the caller "busy, retry" (→ 409) instead.
 */

type CoreWithFollowupsLock = (
  followupsPath: string,
  fn: () => unknown,
  options?: Record<string, unknown>,
) => Promise<unknown>;

/** Cached per resolved module path; failures are NEVER cached, so a repaired or
 *  newly-installed checkout is picked up on the next request. */
const modCache = new Map<string, CoreWithFollowupsLock>();

/** Resolve the core export, or null when this root has data but no scripts.
 *  A data-only root cannot host the seeder either, so there is nothing to
 *  exclude cross-process and the in-process queue alone is correct — see
 *  `withFollowupsLock` below. */
async function loadCoreLock(): Promise<CoreWithFollowupsLock | null> {
  const file = path.join(careerOpsRoot(), "followup-seed.mjs");
  const cached = modCache.get(file);
  if (cached) return cached;
  if (!fs.existsSync(file)) return null;
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(file).href);
  if (typeof mod.withFollowupsLock !== "function") {
    throw new Error("followup-seed.mjs has no withFollowupsLock export");
  }
  const api = mod.withFollowupsLock as CoreWithFollowupsLock;
  modCache.set(file, api);
  return api;
}

/** Thrown when the lock is held by someone else for longer than we will wait. */
export class FollowupsBusyError extends Error {
  constructor() {
    super("follow-ups file is being written by another process");
    this.name = "FollowupsBusyError";
  }
}

/**
 * Run `fn` holding the core's follow-ups lock, releasing it on EVERY path.
 *
 * When the core scripts are absent (data-only root), runs `fn` with no file
 * lock: without the core there is no seeder to race, and `withLogLock` still
 * serializes this process. When the lock is contended past the web timeout,
 * throws `FollowupsBusyError` so the route can answer 409 rather than hang.
 *
 * @param followupsPath absolute path to data/follow-ups.md (the core resolves
 *   and normalizes it; do not pre-derive anything from it)
 * @param fn the read-modify-write to run under the lock
 */
export async function withFollowupsLock<T>(followupsPath: string, fn: () => T | Promise<T>): Promise<T> {
  const core = await loadCoreLock();
  if (!core) return await fn();
  try {
    return (await core(followupsPath, fn as () => unknown, {
      timeoutMs: Number(process.env.CAREER_OPS_WEB_FOLLOWUPS_LOCK_TIMEOUT_MS) || 5_000,
    })) as T;
  } catch (e) {
    // The core throws SeedError('LOCK_TIMEOUT') only from the lock acquire,
    // which runs BEFORE fn — and our fn does fs I/O, never mints a SeedError —
    // so this match is unambiguous: it means "couldn't get the lock", not "the
    // write failed". Anything else (a real fs error from fn) propagates as-is.
    const err = e as { name?: string; code?: string } | null;
    if (err && err.name === "SeedError" && err.code === "LOCK_TIMEOUT") {
      throw new FollowupsBusyError();
    }
    throw e;
  }
}
