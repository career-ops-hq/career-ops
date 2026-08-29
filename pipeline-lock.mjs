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
// Ceiling on progress-extended waiting (see the deadline logic in
// acquirePipelineLock). A multiple of timeoutMs rather than a constant, so a
// caller that tunes one tunes both.
const DEFAULT_MAX_WAIT_FACTOR = 10;

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

/**
 * Owner metadata for a lock directory, plus whether its ABSENCE is a fact.
 *
 * `inspected` is the half that matters for safety, and it is the same
 * distinction #2984 drew for `statSync` one line further down — applied to the
 * read that happens first. ENOENT is a FACT: there is genuinely no stamp, which
 * happens by construction for a lock between its mkdir and its owner.json
 * write, and for the recover guard, which never carries one. The age rule is
 * the right judge for both.
 *
 * Any other code is not a fact. On Windows a live holder's stamp is momentarily
 * unreadable while the directory is churning under concurrent waiters, and
 * collapsing that into the same `null` as "no stamp" lets the age rule condemn
 * a lock that is very much alive. Absence we established, versus absence we
 * merely failed to observe.
 */
function readLockOwner(lockDir) {
  let raw;
  try {
    raw = readFileSync(join(lockDir, 'owner.json'), 'utf-8');
  } catch (err) {
    return { inspected: err?.code === 'ENOENT', owner: null };
  }
  try {
    return { inspected: true, owner: JSON.parse(raw) };
  } catch {
    // A torn or corrupt stamp is readable but meaningless. Fall through to the
    // age rule rather than pinning the lock as unrecoverable for ever.
    return { inspected: true, owner: null };
  }
}

// stat, or null when the path is gone or unreadable. Callers that are deciding
// whether to DELETE something need "I could not establish this" and "it is not
// there" to arrive as the same cautious answer.
function statOrNull(dir) {
  try {
    return statSync(dir);
  } catch {
    return null;
  }
}

// Identity of a directory, so a lock that was removed and recreated by another
// process is never mistaken for the one this caller created.
export function sameLockDirectory(left, right) {
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
//
// The answer is a VERDICT, not a boolean, because "recoverable" was two
// different answers wearing one hat and only one of them licenses a delete:
//
//   STALE    — a directory is THERE and its holder is gone. Deleting it IS the
//              recovery, and it is the only case that should reach rmSync.
//   VANISHED — there was nothing there when we looked. Also "not blocked", but
//              emphatically NOT a licence to delete: the caller acts on this
//              verdict microseconds later, and by then the path may be owned by
//              a process that legitimately created it in between. Deleting on
//              this answer is how an acquirer destroys a live lock it never
//              observed (see the caller).
//   LIVE     — someone holds it, or we could not establish otherwise. Wait.
export const RECOVER_STALE = 'stale';
export const RECOVER_VANISHED = 'vanished';
export const RECOVER_LIVE = 'live';

export function lockRecoveryVerdict(lockDir, staleMs) {
  const { inspected, owner } = readLockOwner(lockDir);
  // Unreadable is not ownerless. A stamp this process could not read proves
  // nothing about whether its holder is alive, and falling through to the age
  // rule on that basis is how a LIVE lock gets condemned — the same reasoning
  // #2984 applied to the stat below, one step earlier in the same function.
  if (!inspected) return RECOVER_LIVE;
  if (owner?.pid) return processIsAlive(owner.pid) ? RECOVER_LIVE : RECOVER_STALE;
  try {
    return Date.now() - statSync(lockDir).mtimeMs > Math.max(staleMs, OWNERLESS_GRACE_MS)
      ? RECOVER_STALE
      : RECOVER_LIVE;
  } catch (err) {
    // Any stat failure other than ENOENT — Windows EPERM/EBUSY while the
    // directory is mid-flight — is "could not look", and answering
    // "recoverable" to that hands the caller an rmSync of a LIVE lock created
    // microseconds ago: its winner then dies with ENOENT writing owner.json
    // (#2777, third face — measured after the rm-contention fix exposed it).
    return err?.code === 'ENOENT' ? RECOVER_VANISHED : RECOVER_LIVE;
  }
}

// A cheap identity for "which holder currently has this lock". Used only to
// tell a lock that is CHANGING HANDS (the system is making progress; this
// caller is merely unlucky) from one that is WEDGED (a single holder is not
// letting go, which is what the timeout exists to escape).
/**
 * The waiting half of the protocol, as one definition the copies can import.
 *
 * Both rules here were bought with measured failures in `pipeline-lock`, and
 * neither reached `followup-seed.mjs`, `portal-health-lock.mjs` or
 * `tracker-utils.mjs`, which still slept a FIXED `retryMs` and timed out on a
 * plain elapsed check:
 *
 *   - jitter (#2506). A fixed retry wakes every waiter at the same instant to
 *     re-race, which is the coupon-collector problem: serving N waiters takes
 *     about N·H(N) rounds, and the loser's write is lost. Measured at 20 runs
 *     per arm, a fixed retry lost an item in 12 of 20 against 2 of 20 jittered.
 *   - the progress rule (#2835). An expired deadline only means "give up" when
 *     the lock has NOT changed hands since we last looked. Without it a caller
 *     waiting on a healthy, briskly handed-round lock is killed for being
 *     unlucky rather than for anything being stuck.
 *
 * Returned as closures over one caller's state because both rules are
 * stateful: the backoff needs the ceiling, and the progress rule needs the
 * previous fingerprint and a re-armable window.
 *
 * @param {string} lockDir - The lock directory this caller is waiting on.
 * @param {{timeoutMs: number, retryMs: number, deadline: number, hardDeadline: number}} timing
 * @returns {{backoffMs: () => number, holderStillWedged: () => boolean}}
 */
export function createLockWaitPolicy(lockDir, { timeoutMs, retryMs, deadline, hardDeadline }) {
  let perHolderDeadline = deadline;
  let lastFingerprint;

  // Jittered backoff, never sleeping past the ceiling. An uncapped sleep can
  // cross hardDeadline and let the NEXT mkdir succeed, returning a lock after
  // the documented absolute limit — an overshoot of up to 1.5x retryMs. Waking
  // exactly at the ceiling means the check at the top of the loop is what
  // decides, rather than whichever of the two happened to be later.
  const backoffMs = () => Math.max(0, Math.min(
    retryMs * (0.5 + Math.random()),
    hardDeadline - Date.now(),
  ));

  // The per-holder deadline, evaluated the SAME way everywhere: an expired
  // deadline only means "give up" when the lock has not changed hands since we
  // last looked. Otherwise the window is re-armed and the caller waits again.
  //
  // A helper rather than inline code because three separate paths can time a
  // caller out — the main retry, a non-EEXIST guard refusal, and an ENOENT
  // owner-write retry — and the progress rule holding on one while the other
  // two throw directly is the same bug in two more places: a healthy lock
  // being handed round briskly could still kill a caller through them.
  const holderStillWedged = () => {
    if (Date.now() <= perHolderDeadline) return false;
    const fingerprint = lockFingerprint(lockDir);
    // Only a lock we can SEE, unchanged across a full window, is evidence that
    // waiting longer is futile. A fingerprint that moved means the lock is
    // being handed round. A null one means it was free or unobservable at the
    // instant we looked — no evidence either way, and not to be mistaken for a
    // wedged holder.
    if (fingerprint !== null && fingerprint === lastFingerprint) return true;
    lastFingerprint = fingerprint;
    perHolderDeadline = Date.now() + timeoutMs;
    return false;
  };

  // Sampled lazily on the first failed acquisition, not at construction, so the
  // very first window is measured against the state the caller actually started
  // waiting on. Without it the first expiry compares against `undefined`,
  // always re-arms, and every caller gets one free window it did not ask for.
  const noteWaiting = () => {
    if (lastFingerprint === undefined) lastFingerprint = lockFingerprint(lockDir);
  };

  // The absolute ceiling, exposed because holderStillWedged() RE-ARMS on
  // progress: a lock being handed round briskly resets the window every time,
  // so the progress rule alone never terminates. pipeline-lock always checked
  // this at the top of its loop; the three copies had no ceiling at all before
  // they adopted the progress rule, and adopting it without this would trade a
  // premature timeout for an unbounded wait.
  const ceilingReached = () => Date.now() > hardDeadline;

  return { backoffMs, holderStillWedged, noteWaiting, ceilingReached };
}

function lockFingerprint(lockDir) {
  try {
    const st = statSync(lockDir);
    const { owner } = readLockOwner(lockDir);
    // ino is 0 on some Windows volumes, hence birthtime as the tiebreaker —
    // the same pairing sameLockDirectory() already relies on.
    return `${owner?.token ?? ''}|${st.ino}|${st.birthtimeMs}`;
  } catch {
    return null; // free or unobservable — no evidence either way
  }
}

/**
 * Blocks until the lock on `pipelinePath` is held, then returns a handle whose
 * release() frees it. Throws LockTimeoutError if the lock stays busy.
 *
 * @param {string} pipelinePath - File the lock guards.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=8000] - Max time a SINGLE holder may block this caller. Waiting is extended while the lock keeps changing hands (see below).
 * @param {number} [options.retryMs=80] - Delay between acquisition attempts.
 * @param {number} [options.staleMs=30000] - Age threshold for a lock with no readable owner, floored at OWNERLESS_GRACE_MS.
 * @param {number} [options.maxWaitMs] - Absolute ceiling on waiting, however much progress the lock makes. Defaults to 10x timeoutMs.
 */
export async function acquirePipelineLock(pipelinePath, options = {}) {
  // Env overrides let a caller several frames up the stack (a test driving
  // appendToPipeline, say) tune contention timing without threading options
  // through every signature — same escape hatch the tracker lock provides.
  const timeoutMs = options.timeoutMs ?? (Number(process.env.CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const retryMs = options.retryMs ?? (Number(process.env.CAREER_OPS_PIPELINE_LOCK_RETRY_MS) || DEFAULT_RETRY_MS);
  const staleMs = options.staleMs ?? (Number(process.env.CAREER_OPS_PIPELINE_LOCK_STALE_MS) || DEFAULT_STALE_MS);
  // A ceiling that is not a number is not a ceiling. NaN compares false against
  // everything, so a bad value would not fail loudly — it would silently remove
  // the only bound on waiting, which is the single thing this option exists to
  // provide. Only a usable ceiling is honoured; everything else takes the
  // default, which is at least bounded.
  //
  // Read WITHOUT the `|| default` idiom its three siblings above use, because
  // for this one 0 is a meaningful setting — "never wait past now" — and
  // `0 || default` would turn a caller who asked for no waiting into one who
  // waits DEFAULT_MAX_WAIT_FACTOR x timeoutMs, the exact opposite. timeoutMs
  // and retryMs have no such reading, which is why the idiom is fine there and
  // wrong here.
  //
  // Infinity is kept as written: an explicit, legible "no ceiling" is a choice,
  // not a mistake. -Infinity and NaN are mistakes, so they take the default
  // rather than being clamped into a silently different behaviour.
  const defaultMaxWaitMs = timeoutMs * DEFAULT_MAX_WAIT_FACTOR;
  const envMaxWait = process.env.CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS;
  const requestedMaxWait = Number(
    options.maxWaitMs ?? (envMaxWait === undefined || envMaxWait.trim() === '' ? defaultMaxWaitMs : envMaxWait),
  );
  const maxWaitMs = requestedMaxWait === Infinity ? Infinity
    : Number.isFinite(requestedMaxWait) && requestedMaxWait >= 0 ? requestedMaxWait
      : defaultMaxWaitMs;
  const lockDir = lockDirFor(pipelinePath);
  const recoverGuardDir = `${lockDir}.recover`;
  const token = randomUUID();
  let deadline = Date.now() + timeoutMs;
  // Deliberately NOT floored at timeoutMs. A caller that asks for a ceiling
  // below one per-holder window means it, and quietly raising it would make
  // maxWaitMs a no-op in precisely the range where it was stated most
  // explicitly. The ceiling wins; timeoutMs just stops mattering.
  const hardDeadline = Date.now() + maxWaitMs;
  // The last mkdir error this caller treated as contention. On POSIX it is
  // always EEXIST and says nothing; on Windows an EPERM/EACCES that persists
  // to the deadline is the difference between "crowded" and "this process
  // cannot create directories here at all", and without it a real permissions
  // problem would present as a plain, unexplained timeout.
  let lastContentionError = null;

  const { backoffMs, holderStillWedged, noteWaiting } = createLockWaitPolicy(lockDir, {
    timeoutMs, retryMs, deadline, hardDeadline,
  });
  // Built at the throw site so the diagnosis reflects the moment it gave up.
  // A timeout on a critical section that is a single sub-millisecond append
  // has more than one explanation, and the owner record separates them:
  //   - no owner, or an owner whose PID is dead: real contention, and the
  //     structural answer is a fair queue rather than a bigger budget.
  //   - an owner reported ALIVE after tens of seconds: the directory outlived
  //     its holder, because release()'s rmSync can fail on Windows while a
  //     handle is open and is swallowed by design.
  // Diagnostic only: it never changes whether the error is thrown.
  // `expiredMs` is the bound that actually ran out, so the message names the
  // limit that was applied. Reporting timeoutMs when the CEILING expired states
  // a number that was never in force.
  const buildTimeoutError = (expiredMs = timeoutMs) => {
    const err = new LockTimeoutError(lockDir, expiredMs);
    try {
      const { inspected, owner } = readLockOwner(lockDir);
      err.owner = owner
        ? { pid: owner.pid, alive: processIsAlive(owner.pid), started_at: owner.started_at, heldMs: Date.parse(owner.started_at) ? Date.now() - Date.parse(owner.started_at) : null }
        // The note now separates the two cases the diagnosis could not tell
        // apart before, because they point at different bugs: a stamp that is
        // absent is an acquisition still in flight, while one that could not be
        // read is the condition this change stops from condemning a live lock.
        : {
          pid: null,
          alive: null,
          note: !inspected ? 'owner.json exists but could not be read'
            : existsSync(lockDir) ? 'lock exists with no owner.json'
              : 'lock vanished before it could be read',
        };
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
    // The ceiling is tested FIRST, on its own, on every pass. Nesting it inside
    // the per-holder deadline made it conditional on a branch that may never
    // run: a caller whose maxWaitMs is below timeoutMs never reaches the inner
    // check, a re-arm pushes the next look a whole window away, and the reclaim
    // fast-path continues straight past both. A bound that holds only when
    // another bound happens to fire is not a bound.
    if (Date.now() > hardDeadline) throw buildTimeoutError(maxWaitMs);

    try {
      mkdirSync(lockDir);
    } catch (err) {
      if (!isMkdirContention(err)) throw err;
      lastContentionError = err;
      noteWaiting();

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
          if (holderStillWedged()) throw buildTimeoutError();
          await sleep(backoffMs());
          continue;
        }
        // A process killed between taking the guard and cleaning it up would
        // otherwise disable stale recovery forever. The guard normally lives
        // for milliseconds, so an old one is judged by the same age rule.
        // STALE only. A guard that was already gone when we looked needs no
        // eviction, and evicting on that answer would delete the guard a
        // different caller has just legitimately taken — putting two callers
        // inside the decide-then-delete window this guard exists to serialize.
        if (lockRecoveryVerdict(recoverGuardDir, staleMs) === RECOVER_STALE) {
          rmLockArtifactSync(recoverGuardDir);
        }
      }

      if (hasRecoverGuard) {
        try {
          // Only STALE reaches the rm. VANISHED means the lock was absent when
          // we looked, and the gap between that observation and this line is
          // long enough for another acquirer to have won the mkdir and be
          // partway through writing its owner.json. Deleting on that answer
          // destroys the fresh, live lock: measured on Windows, the winner's
          // mkdir landed 472 us after the vanished verdict and the rm 68 us
          // after that, killing it with `ENOENT ... open '<path>.lock/owner.json'`
          // and losing its queued item. The rm is the lucky outcome — had the
          // stamp landed first, both callers would have held the lock with no
          // error at all.
          //
          // So VANISHED falls through to the normal backoff and retries
          // acquisition, which is what the old comment already claimed this
          // branch did. It costs one backoff in a rare case; deleting a live
          // lock costs an item.
          // STALE is not enough on its own either: it says the directory we
          // READ was abandoned, and the rm acts on whatever is at the path a
          // moment later. Reaching the verdict costs a readFileSync and a
          // process.kill, which is ample room to be descheduled, and in that
          // gap the stale lock can be reclaimed by someone else and replaced by
          // a live one. Deleting then destroys a lock this caller never judged.
          //
          // Not hypothetical. Logging the directory's inode either side of the
          // verdict, the ONE stale reclaim in a 2,400-acquisition run came back
          //   idBefore=5910974513639709 ownerBefore=39392
          //   idAfter =6192449490350378 ownerAfter =27256 alive=true
          // — a different directory, owned by a live process, deleted anyway.
          //
          // So the identity of the judged directory is carried to the rm and
          // rechecked. A path that changed underneath us is left alone; we go
          // back and compete for it normally.
          const judged = statOrNull(lockDir);
          if (judged && lockRecoveryVerdict(lockDir, staleMs) === RECOVER_STALE
            && sameLockDirectory(judged, statOrNull(lockDir) ?? {})) {
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

      if (holderStillWedged()) throw buildTimeoutError();
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
      await sleep(backoffMs());
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
        if (holderStillWedged()) throw buildTimeoutError();
        continue;
      }
      // Best-effort: a contended rm here must not mask ownerErr, and an
      // orphaned owner-less lock ages out via lockRecoveryVerdict anyway.
      //
      // The try/catch is what makes that sentence true for EVERY failure, not
      // just a contended one. rmLockArtifactSync deliberately rethrows the
      // non-contention class (EROFS/ENOSPC), so without this an unwritable
      // filesystem would propagate from the CLEANUP and the `throw ownerErr`
      // below would never run — the caller would be told the lock could not be
      // removed, and never learn why the owner stamp could not be written.
      // A leftover lock ages out; a swallowed cause is recovered by nothing.
      try {
        rmLockArtifactSync(lockDir);
      } catch {
        /* cleanup must never outrank the reason we are here */
      }
      throw ownerErr;
    }

    // Read our own stamp back before handing the caller a lock handle.
    //
    // The identity recheck above stops this caller from deleting a directory it
    // did not judge, but it cannot stop another caller from doing so to US, and
    // that failure has no error attached to it: the delete lands after our
    // owner.json write succeeds, so nothing in the acquisition path notices and
    // two processes enter the critical section believing they hold it.
    //
    // main already recovers the case where the delete lands BEFORE the stamp —
    // the write fails ENOENT and the loop competes again. This is the same
    // recovery for the case where it lands just after. A stamp that is missing,
    // or that carries someone else's token, means we no longer hold what we
    // took, so we compete again rather than proceed.
    const confirmed = readLockOwner(lockDir);
    if (confirmed.owner?.token !== token) {
      if (holderStillWedged()) throw buildTimeoutError();
      continue;
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
        const { owner } = readLockOwner(lockDir);
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
