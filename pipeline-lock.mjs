// pipeline-lock.mjs — a cross-process advisory lock for data/pipeline.md.
//
// appendToPipeline() (scan.mjs) is a plain read-modify-write: readFileSync,
// mutate the string, writeFileSync. It's exported and called from three
// places — scan.mjs itself, scan-ats-full.mjs, and plugins.mjs (pipeline
// mode) — so any two of them running concurrently (a scheduled scan
// overlapping a manual `/career-ops pipeline` run, or two plugin jobs) can
// silently drop one side's offers: whichever write lands second overwrites
// the first's in-memory read, with no error and no trace anything was lost.
//
// Protocol — deliberately the same shape as the tracker lock in
// tracker-utils.mjs, so there is one lock idiom in the codebase:
//   - the lock is a directory ("<path>.lock"); a mkdir is atomic.
//   - the holder records owner.json — pid, a unique token, started_at — so
//     both stale-reclaim and release can verify who actually owns the lock
//     before deleting anything.
//   - staleness is judged by owner-PID liveness first, falling back to
//     directory age only when the metadata is missing or unreadable. An old
//     lock whose owner is still running is NOT stale, and an ownerless
//     directory gets a fixed grace period (OWNERLESS_GRACE_MS) before age
//     alone can condemn it, so a directory created microseconds ago is never
//     reclaimable no matter how aggressive the caller's staleMs.
//   - stale reclamation is serialized behind a second atomic guard directory
//     ("<path>.lock.recover"). Without it, reclamation is itself a TOCTOU
//     race: two callers that both judge the same lock stale can have the
//     second one's rmSync delete the first one's freshly created lock, after
//     which both believe they hold it — reintroducing the very race this
//     module exists to close, just gated behind a crash + contention window.
//
// Timing is caller-configurable (with these defaults) so tests can exercise
// contention in milliseconds instead of waiting out a multi-second constant.

import { mkdirSync, rmSync, statSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

const DEFAULT_STALE_MS = 30_000;
export const OWNERLESS_GRACE_MS = 1_000;
const DEFAULT_RETRY_MS = 80;
const DEFAULT_TIMEOUT_MS = 8_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LockTimeoutError extends Error {
  constructor(lockDir, timeoutMs) {
    super(`pipeline lock timeout: ${lockDir} held > ${timeoutMs}ms`);
    this.name = 'LockTimeoutError';
    this.lockDir = lockDir;
  }
}

export function lockDirFor(pipelinePath) {
  return `${pipelinePath}.lock`;
}

/** Owner metadata for a lock directory, or null when missing/unreadable. */
function readLockOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
  } catch {
    return null;
  }
}

// Identity of a directory, so a lock that was removed and recreated by another
// process is never mistaken for the one this caller created.
function sameLockDirectory(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && (left.ino !== 0 || left.birthtimeMs === right.birthtimeMs);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM'; // exists, just not signalable by this user
  }
}

// Conservative: a lock whose recorded owner is still running is never stale,
// however old it is. Age is the fallback only when there's no readable owner.
//
// That fallback needs a floor. Two directories are ownerless by construction,
// not by accident: a lock between its mkdir and its owner.json write, and the
// recover guard, which never carries owner.json at all. Judging those on
// `age > staleMs` alone lets a caller with an aggressive staleMs delete a
// directory created microseconds ago — either stealing a winner's lock inside
// its acquisition window, or evicting a live guard and putting two callers
// inside the decide-then-delete window the guard exists to serialize.
// OWNERLESS_GRACE_MS is a lower bound on that patience, never a cap: a larger
// caller staleMs still wins, and a genuinely abandoned directory still ages
// out, so a crash while holding the guard cannot disable recovery for good.
function lockCanRecover(lockDir, staleMs) {
  const owner = readLockOwner(lockDir);
  if (owner?.pid) return !processIsAlive(owner.pid);
  try {
    return Date.now() - statSync(lockDir).mtimeMs > Math.max(staleMs, OWNERLESS_GRACE_MS);
  } catch {
    return true; // vanished — nothing to recover, retry acquisition
  }
}

/**
 * Blocks until the lock on `pipelinePath` is held, then returns a handle whose
 * release() frees it. Throws LockTimeoutError if the lock stays busy.
 *
 * @param {string} pipelinePath - File the lock guards.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=8000] - Max time to wait for the lock.
 * @param {number} [options.retryMs=80] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=30000] - Age threshold for a lock with no readable owner, floored at OWNERLESS_GRACE_MS.
 */
export async function acquirePipelineLock(pipelinePath, options = {}) {
  // Env overrides let a caller several frames up the stack (a test driving
  // appendToPipeline, say) tune contention timing without threading options
  // through every signature — same escape hatch the tracker lock provides.
  const timeoutMs = options.timeoutMs ?? (Number(process.env.CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const retryMs = options.retryMs ?? (Number(process.env.CAREER_OPS_PIPELINE_LOCK_RETRY_MS) || DEFAULT_RETRY_MS);
  const staleMs = options.staleMs ?? (Number(process.env.CAREER_OPS_PIPELINE_LOCK_STALE_MS) || DEFAULT_STALE_MS);
  const lockDir = lockDirFor(pipelinePath);
  const recoverGuardDir = `${lockDir}.recover`;
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;

  // A fresh install may not have data/ yet — plugins.mjs's cmdRun calls
  // appendToPipeline with no directory pre-creation, so create it here rather
  // than letting mkdirSync(lockDir) throw a raw ENOENT.
  mkdirSync(dirname(lockDir), { recursive: true });

  for (;;) {
    try {
      mkdirSync(lockDir);
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;

      // Serialize stale-reclaim behind a second atomic guard so only one
      // caller can be inside the decide-then-delete window at a time.
      let hasRecoverGuard = false;
      try {
        mkdirSync(recoverGuardDir);
        hasRecoverGuard = true;
      } catch (guardErr) {
        if (guardErr?.code !== 'EEXIST') throw guardErr;
        // A process killed between taking the guard and cleaning it up would
        // otherwise disable stale recovery forever. The guard normally lives
        // for milliseconds, so an old one is judged by the same age rule.
        if (lockCanRecover(recoverGuardDir, staleMs)) {
          rmSync(recoverGuardDir, { recursive: true, force: true });
        }
      }

      if (hasRecoverGuard) {
        try {
          if (lockCanRecover(lockDir, staleMs)) {
            rmSync(lockDir, { recursive: true, force: true });
            continue; // retry acquisition immediately, still holding the guard's decision
          }
        } finally {
          rmSync(recoverGuardDir, { recursive: true, force: true });
        }
      }

      if (Date.now() > deadline) throw new LockTimeoutError(lockDir, timeoutMs);
      await sleep(retryMs);
      continue;
    }

    // Acquired. Record ownership; an owner-less lock would block every future
    // acquirer until the age-out, so clean up if the stamp can't be written.
    try {
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
        pid: process.pid,
        token,
        started_at: new Date().toISOString(),
        pipeline: pipelinePath,
      }, null, 2));
    } catch (ownerErr) {
      rmSync(lockDir, { recursive: true, force: true });
      throw ownerErr;
    }

    let released = false;
    return {
      lockDir,
      release() {
        if (released) return;
        released = true;
        // Verify this caller still owns the lock before removing anything: if
        // our operation outlived staleMs and another process legitimately
        // reclaimed the lock, deleting it here would free someone else's
        // critical section.
        let before;
        try {
          before = statSync(lockDir);
        } catch {
          return; // already gone
        }
        const owner = readLockOwner(lockDir);
        if (owner?.token !== token) return; // reclaimed by someone else — leave it alone
        let after;
        try {
          after = statSync(lockDir);
        } catch {
          return;
        }
        if (!sameLockDirectory(before, after)) return; // swapped underneath us
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {
          /* best-effort; a stale-reclaim will recover it */
        }
      },
    };
  }
}

/** Acquires the lock on `pipelinePath`, runs fn, and always releases it. */
export async function withPipelineLock(pipelinePath, fn, options = {}) {
  const lock = await acquirePipelineLock(pipelinePath, options);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
