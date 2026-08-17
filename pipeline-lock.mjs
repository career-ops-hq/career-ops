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

// mkdir's "someone else already has this" answer is NOT portable. POSIX gives
// EEXIST; Windows gives EEXIST *sometimes* and EPERM/EACCES when the target is
// mid-flight — being created, or being removed, by another process at that
// instant. That is not an error condition here, it is the contention this loop
// exists to handle, and it is precisely what a burst of concurrent writers
// manufactures.
//
// Treating it as fatal is how an item gets LOST. Measured on windows-latest
// (#2777, run 31745798742): one of 30 concurrent `agent-inbox add` processes
// died with `EPERM: operation not permitted, mkdir '…agent-inbox.md.lock.recover'`
// and its line was never appended. The two budget increases before this one
// (#2506 jitter, #2825's 30s) both moved the symptom without touching this,
// because a starving writer and a writer killed by EPERM produce the same
// `kept=29 of 30` and only the second is a crash.
//
// A genuine permissions problem still surfaces: it simply stops being an
// instant throw and becomes a timeout that names the last error it saw, which
// is the correct trade when the alternative is silent data loss.
export function isMkdirContention(err) {
  return err?.code === 'EEXIST' || err?.code === 'EPERM' || err?.code === 'EACCES';
}

// rm's Windows answer under contention mirrors mkdir's. Removing a directory
// another process is inside of — mid-mkdir, mid-scan (antivirus, indexer), or
// mid-rm — fails with EPERM/EACCES/EBUSY/ENOTEMPTY, and `force: true` only
// silences ENOENT. Measured on windows-latest (#2777, run 32044401225): two of
// 30 concurrent `agent-inbox add` processes died on
// `EPERM … agent-inbox.md.lock.recover` thrown by a bare rmSync of the recover
// guard, and their items were never appended — the same loss the mkdir half of
// this handling removed, resurfacing one call later.
export function isRmContention(err) {
  return err?.code === 'EPERM' || err?.code === 'EACCES' || err?.code === 'EBUSY' || err?.code === 'ENOTEMPTY';
}

// Best-effort removal of a lock artifact (the lock dir or the recover guard).
// Contention is swallowed and reported via the return value; anything else
// (EROFS/ENOSPC-class breakage) still throws. Never fatal on contention
// because every lock artifact ages out: an abandoned guard or lock is
// reclaimed by lockCanRecover on a later attempt, so the worst case of
// leaving one behind is one extra retry for some caller. Killing the writer
// loses its item; waiting does not.
export function rmLockArtifactSync(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (err) {
    if (isRmContention(err)) return false;
    throw err;
  }
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
  } catch (err) {
    // Only a genuinely vanished directory is "nothing to recover". Any other
    // stat failure — Windows EPERM/EBUSY while the directory is mid-flight —
    // is "could not look", and answering "recoverable" to that hands the
    // caller an rmSync of a LIVE lock created microseconds ago: its winner
    // then dies with ENOENT writing owner.json (#2777, third face — measured
    // after the rm-contention fix exposed it).
    return err?.code === 'ENOENT';
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
  // The last mkdir error this caller treated as contention. On POSIX it is
  // always EEXIST and says nothing; on Windows an EPERM/EACCES that persists
  // to the deadline is the difference between "crowded" and "this process
  // cannot create directories here at all", and without it a real permissions
  // problem would present as a plain, unexplained timeout.
  let lastContentionError = null;

  // Built at the throw site so the diagnosis reflects the moment it gave up.
  // A timeout on a critical section that is a single sub-millisecond append
  // has more than one explanation, and the owner record separates them:
  //   - no owner, or an owner whose PID is dead: real contention, and the
  //     structural answer is a fair queue rather than a bigger budget.
  //   - an owner reported ALIVE after tens of seconds: the directory outlived
  //     its holder, because release()'s rmSync can fail on Windows while a
  //     handle is open and is swallowed by design.
  // Diagnostic only: it never changes whether the error is thrown.
  const buildTimeoutError = () => {
    const err = new LockTimeoutError(lockDir, timeoutMs);
    try {
      const owner = readLockOwner(lockDir);
      err.owner = owner
        ? { pid: owner.pid, alive: processIsAlive(owner.pid), started_at: owner.started_at, heldMs: Date.parse(owner.started_at) ? Date.now() - Date.parse(owner.started_at) : null }
        : { pid: null, alive: null, note: existsSync(lockDir) ? 'lock exists with no readable owner.json' : 'lock vanished before it could be read' };
      err.message += ` — owner=${JSON.stringify(err.owner)}`;
      if (lastContentionError && lastContentionError.code !== 'EEXIST') {
        err.lastMkdirError = lastContentionError.code;
        err.message += `, last mkdir error=${lastContentionError.code} on ${lastContentionError.path ?? '?'}`;
      }
    } catch { /* diagnosis must never mask the timeout it describes */ }
    return err;
  };

  // A fresh install may not have data/ yet — plugins.mjs's cmdRun calls
  // appendToPipeline with no directory pre-creation, so create it here rather
  // than letting mkdirSync(lockDir) throw a raw ENOENT.
  mkdirSync(dirname(lockDir), { recursive: true });

  for (;;) {
    try {
      mkdirSync(lockDir);
    } catch (err) {
      if (!isMkdirContention(err)) throw err;
      lastContentionError = err;

      // Serialize stale-reclaim behind a second atomic guard so only one
      // caller can be inside the decide-then-delete window at a time.
      let hasRecoverGuard = false;
      try {
        mkdirSync(recoverGuardDir);
        hasRecoverGuard = true;
      } catch (guardErr) {
        if (!isMkdirContention(guardErr)) throw guardErr;
        lastContentionError = guardErr;
        // An EPERM/EACCES here says the guard directory is mid-flight, not that
        // it is sitting there abandoned, so the age check below would be
        // reasoning about a directory it cannot even stat reliably. Back off to
        // the retry loop instead of judging it.
        if (guardErr.code !== 'EEXIST') {
          if (Date.now() > deadline) throw buildTimeoutError();
          await sleep(retryMs * (0.5 + Math.random()));
          continue;
        }
        // A process killed between taking the guard and cleaning it up would
        // otherwise disable stale recovery forever. The guard normally lives
        // for milliseconds, so an old one is judged by the same age rule.
        if (lockCanRecover(recoverGuardDir, staleMs)) {
          rmLockArtifactSync(recoverGuardDir);
        }
      }

      if (hasRecoverGuard) {
        try {
          if (lockCanRecover(lockDir, staleMs)) {
            if (rmLockArtifactSync(lockDir)) {
              continue; // retry acquisition immediately, still holding the guard's decision
            }
            // rm hit contention: another process is touching the stale lock at
            // this instant, so fall through to the normal backoff instead of
            // treating the collision as fatal.
          }
        } finally {
          rmLockArtifactSync(recoverGuardDir);
        }
      }

      if (Date.now() > deadline) throw buildTimeoutError();
      // Jitter, because a FIXED retry makes every waiter wake at the same
      // instant and re-race, and whoever loses is picked at random rather than
      // queued. With N waiters that is the coupon-collector problem: serving
      // all of them takes about N·H(N) rounds, so 30 concurrent adds need ~120
      // and the default budget only affords 8000/80 = 100. The starving writer
      // then times out and its item is LOST — the exact failure #2777 removed
      // from the silent path, reappearing as a loud one under contention.
      // Spreading wake-ups over [0.5x, 1.5x) breaks the herd so waiters stop
      // colliding on every round. It does not make the lock fair; it makes
      // unfairness cost a retry instead of an item.
      //
      // Measured, 20 runs per arm alternated on the same machine with the
      // budget forced to 220ms (2.75 rounds for 30 writers, short by
      // construction so the effect is visible without waiting out 8s):
      //   with jitter    2 of 20 runs lose an item
      //   without jitter 12 of 20
      // So this is a ~6x reduction, NOT a cure: a starving writer is still
      // possible, and the structural fix is a fair queue rather than a retry
      // lottery. Left as a lottery because fairness needs an ordered wait and
      // that is a different lock; recorded here so nobody reads the jitter as
      // "the race is gone".
      await sleep(retryMs * (0.5 + Math.random()));
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
      // ENOENT writing owner.json means the just-won lock directory is gone:
      // another caller (mis)judged it reclaimable and deleted it. That is a
      // lost race, not a failure — re-enter the loop and compete again.
      // Dying here loses the caller's queued write (#2777, third face).
      if (ownerErr?.code === 'ENOENT') {
        if (Date.now() > deadline) throw buildTimeoutError();
        continue;
      }
      // Best-effort: a contended rm here must not mask ownerErr, and an
      // orphaned owner-less lock ages out via lockCanRecover anyway.
      rmLockArtifactSync(lockDir);
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
