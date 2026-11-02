// lib/dir-lock.mjs — the one cross-process directory lock.
//
// Every core lock (data/pipeline.md, the applications tracker, follow-ups.md,
// portal-health.tsv) is this protocol with a different path, owner stamp and
// timeout error. Each used to carry its own acquire/recover/release body, and
// the copies drifted apart one fix at a time: #2777 (Windows EPERM) was learned
// by one copy at a time, #2506 and #2835 (lockstep wakeups) reached three of
// them late, #3895 found "a fourth copy of that bound", and #5358 found copies
// that deleted a peer's lock on a failed owner write, crashed or deadlocked on
// one, or skipped the identity recheck and the stamp read-back pipeline-lock
// had added after measuring the race. So the whole protocol lives here, and
// the callers only pick what differs. tests/lock-rm-contention.test.mjs fails
// if an acquire loop of its own appears anywhere else.
//
// web/src/lib/core/dir-lock.mjs is a byte-for-byte copy of this file, because
// the web bundle cannot import the repo-root core (web/next.config.mjs pins the
// Turbopack root to web/). web/tests/lib/dir-lock.test.mjs fails if the two
// differ by a single byte, so edit this file and copy it across, never the
// other way round.
//
// Protocol:
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
//     which both believe they hold it — reintroducing the very race the lock
//     exists to close, just gated behind a crash + contention window.
//
// Timing is caller-supplied so tests can exercise contention in milliseconds
// instead of waiting out a multi-second constant.

import { mkdirSync, rmSync, statSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

// Env-overridable like the timing knobs each caller reads (staleMs, timeoutMs,
// retryMs) for the same reason: a test that backdates a lock by a small,
// fixed amount to stay just past a tiny staleMs needs the OTHER side of that
// window — the floor itself — to have slack too, or the real cost of spawning
// the child process (Node startup, the module graph, retries) can eat into the
// 1s default before the child ever looks. On a slower CI runner that reads
// as the lock "aging out" prematurely and the test asserting the opposite of
// what it measured (#4537) — read once at module load, which is fine since
// every caller is a fresh process.
//
// Only a finite, positive override is honoured. `|| 1_000` alone would accept
// a NEGATIVE value (a truthy number, so it survives the `||`) and reduce the
// floor below 1,000ms — the opposite of every legitimate use, which widens
// it. It would also accept `Infinity`, which stops ownerless locks from ever
// aging out and can hang acquisition on a genuinely abandoned lock. Both are
// clearly misconfiguration, not a caller asking for "no floor"; unlike
// acquireDirLock's `maxWaitMs`, this constant has no documented
// Infinity-means-unbounded convention to preserve.
const configuredOwnerlessGraceMs = Number(process.env.CAREER_OPS_OWNERLESS_GRACE_MS);
export const OWNERLESS_GRACE_MS = Number.isFinite(configuredOwnerlessGraceMs) && configuredOwnerlessGraceMs > 0
  ? configuredOwnerlessGraceMs
  : 1_000;

// Ceiling on progress-extended waiting (see createLockWaitPolicy). A multiple
// of timeoutMs rather than a constant, so a caller that tunes one tunes both.
const DEFAULT_MAX_WAIT_FACTOR = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The same pause for tryAcquireDirLockSync, which has no event-loop turn to
// give back. It only ever waits out an inconclusive stamp read-back, below.
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// How long acquisition keeps re-reading its own stamp when the read fails
// with something other than ENOENT: a handful of short tries, enough to ride
// out a transient Windows sharing violation without stretching acquisition.
const READBACK_RETRIES = 5;
const READBACK_RETRY_MS = 10;

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
 *
 * ENOTDIR is the same fact for a path that is not a directory at all: there is
 * no stamp because there is nowhere for one to be. A lock path holding a plain
 * FILE is never a live lock under this protocol. It is a leftover, typically
 * from a caller that locked with an O_EXCL file at the same name before moving
 * here (the web's assistant chat store did, #5358). Reading it as "could not
 * look" would pin it LIVE for ever and wedge every acquirer; reading it as
 * ownerless hands it to the age rule, which reclaims it once it is old enough.
 */
export function readLockOwner(lockDir) {
  let raw;
  try {
    raw = readFileSync(join(lockDir, 'owner.json'), 'utf-8');
  } catch (err) {
    return { inspected: err?.code === 'ENOENT' || err?.code === 'ENOTDIR', owner: null };
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

// A stat taken to compare identities: the stats, GONE when the directory does
// not exist (ENOENT is a fact), or null when it could not be looked at — no
// evidence either way, the same distinction lockRecoveryVerdict draws.
const GONE = Symbol('gone');
function statForIdentity(dir) {
  try {
    return statSync(dir);
  } catch (err) {
    return err?.code === 'ENOENT' ? GONE : null;
  }
}

// Whether `now` is the directory `created` was taken from: true, false, or
// null when either look failed and the question cannot be answered.
function sameAsCreated(created, now) {
  if (now === GONE) return false;
  if (created === GONE || created === null || now === null) return null;
  return sameLockDirectory(created, now);
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
// reclaimed by lockRecoveryVerdict on a later attempt, so the worst case of
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

// Tokens of the handles this module has handed out and not yet released.
//
// A live pid proves its holder is alive only when the holder is another
// process. For THIS process's pid it proves nothing: a long-lived process (the
// web server) can be left holding a directory no handle owns — a release whose
// rm was contended on Windows (swallowed by design, see createRelease), or a
// stamp this caller wrote but could not confirm. The pid rule would then keep
// that lock LIVE until the server restarts, answering "busy" to every request
// that needs it (#5390 review). So our own pid counts as live only for a token
// we are actually holding; any other stamp of ours goes to the age rule below.
//
// The age rule, not an immediate reclaim, because this set is per module
// instance: a second copy of this module in the same process (a bundler chunk,
// a worker thread, a dev-server reload) holds tokens this one cannot see. Its
// lock is reclaimable only once it is older than staleMs, which no critical
// section in this repo approaches.
const activeTokens = new Set();

export function lockRecoveryVerdict(lockDir, staleMs) {
  const { inspected, owner } = readLockOwner(lockDir);
  // Unreadable is not ownerless. A stamp this process could not read proves
  // nothing about whether its holder is alive, and falling through to the age
  // rule on that basis is how a LIVE lock gets condemned — the same reasoning
  // #2984 applied to the stat below, one step earlier in the same function.
  if (!inspected) return RECOVER_LIVE;
  if (owner?.pid) {
    if (!processIsAlive(owner.pid)) return RECOVER_STALE;
    if (owner.pid !== process.pid || activeTokens.has(owner.token)) return RECOVER_LIVE;
    // Our pid, but no handle of ours: fall through to the age rule.
  }
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

/**
 * The waiting half of the protocol.
 *
 * Both rules here were bought with measured failures in `pipeline-lock`, and
 * for a long time neither reached the other lock modules, which slept a FIXED
 * `retryMs` and timed out on a plain elapsed check:
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
 * @param {{timeoutMs: number, retryMs: number, deadline: number, hardDeadline?: number}} timing
 *   `hardDeadline` is OPTIONAL: omit it and the policy applies its own default
 *   ceiling, DEFAULT_MAX_WAIT_FACTOR x timeoutMs from now. Pass one only when
 *   the caller has a real knob of its own (acquireDirLock's `maxWaitMs`).
 * @returns {{backoffMs: () => number, holderStillWedged: () => boolean, noteWaiting: () => void, ceilingReached: () => boolean}}
 */
export function createLockWaitPolicy(lockDir, { timeoutMs, retryMs, deadline, hardDeadline }) {
  let perHolderDeadline = deadline;
  let lastFingerprint;

  // The ceiling is the policy's, not each caller's (#3895). Three lock modules
  // used to write `Date.now() + timeoutMs * 10` at their own call sites, so the
  // bound the clamp below applies existed in four places. Copies of an
  // invariant stay correct only until one is edited, and a wrong ceiling fails
  // silently — it changes retry timing, which nothing asserts and nobody
  // reports. Deriving it here leaves one copy for them all.
  const ceiling = hardDeadline ?? Date.now() + timeoutMs * DEFAULT_MAX_WAIT_FACTOR;
  // A ceiling that is not a number is not a ceiling, and it fails INVISIBLY:
  // Math.min(x, NaN) is NaN, Math.max(0, NaN) is NaN, and setTimeout(NaN) fires
  // immediately — so a caller that got this wrong would spin hot through the
  // retry loop rather than raise anything. Infinity is a deliberate, legible
  // "no ceiling" (acquireDirLock passes it for maxWaitMs: Infinity) and is
  // kept; NaN and non-numbers are mistakes and are refused where they are made.
  if (typeof ceiling !== 'number' || Number.isNaN(ceiling)) {
    throw new TypeError(
      `createLockWaitPolicy: hardDeadline must be a number or omitted, got ${String(hardDeadline)}`,
    );
  }

  // Jittered backoff, never sleeping past EITHER deadline the loop can exit on.
  //
  // ceiling: an uncapped sleep can cross it and let the NEXT mkdir succeed,
  // returning a lock after the documented absolute limit — an overshoot of up
  // to 1.5x retryMs. Waking exactly at the ceiling means the check at the top
  // of the loop is what decides, rather than whichever of the two happened to
  // be later.
  //
  // perHolderDeadline: the loop also exits when holderStillWedged() flips true,
  // which cannot happen until this deadline passes. Sleeping past it means the
  // caller's own timeoutMs is only observed at whatever moment the sleep
  // happens to end. With retryMs above timeoutMs the overshoot is the whole
  // retry: a 150ms timeout waited five seconds. Waking at the nearer deadline
  // puts the decision back in the check at the top of the loop.
  //
  // Clamping OUTSIDE this function is not equivalent. A caller clamping to its
  // own fixed `startedAt + timeoutMs` goes to zero once that passes, while
  // holderStillWedged() RE-ARMS perHolderDeadline every time the lock changes
  // hands. The loop then legitimately continues to the ceiling while every
  // sleep is 0, which is a busy-wait at the setTimeout floor and the thundering
  // herd the jitter above exists to prevent.
  const backoffMs = () => Math.max(0, Math.min(
    retryMs * (0.5 + Math.random()),
    ceiling - Date.now(),
    perHolderDeadline - Date.now(),
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
  // so the progress rule alone never terminates. acquireDirLock checks this at
  // the top of its loop; the lock modules that once had their own loops had no
  // ceiling at all before they adopted the progress rule, and adopting it
  // without this would trade a premature timeout for an unbounded wait.
  const ceilingReached = () => Date.now() > ceiling;

  return { backoffMs, holderStillWedged, noteWaiting, ceilingReached };
}

// A cheap identity for "which holder currently has this lock". Used only to
// tell a lock that is CHANGING HANDS (the system is making progress; this
// caller is merely unlucky) from one that is WEDGED (a single holder is not
// letting go, which is what the timeout exists to escape).
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
 * Error thrown when a lock stays busy and the caller supplied no `timeoutError`.
 * Callers with an established error type of their own pass a factory instead.
 */
export class DirLockTimeoutError extends Error {
  constructor(lockDir, expiredMs) {
    super(`lock timeout: ${lockDir} held > ${expiredMs}ms`);
    this.name = 'DirLockTimeoutError';
    this.code = 'LOCK_TIMEOUT';
    this.lockDir = lockDir;
  }
}

// What one pass of the protocol can end in. The waiting caller
// (acquireDirLock) and the non-waiting one (tryAcquireDirLockSync) differ only
// in what they do with these, so the pass itself is written once.
//   STAMPED   — this pass created the lock and wrote its stamp; confirmStamp()
//               decides whether it is still ours.
//   RECLAIMED — a stale lock was removed under the recover guard: try again now.
//   LOST_RACE — the lock this pass created was taken from it before it could
//               be handed out: try again now, unless the holder is wedged.
//   BUSY      — someone else holds it, or the guard is mid-flight: back off.
const PASS_STAMPED = 'stamped';
const PASS_RECLAIMED = 'reclaimed';
const PASS_LOST_RACE = 'lost-race';
const PASS_BUSY = 'busy';

// The non-waiting caller's bound on immediate retries. A reclaim and a lost race
// each earn one more pass; anything still contended after that is a holder, and
// the honest answer is "busy".
const SYNC_MAX_PASSES = 3;

/**
 * One acquisition attempt: mkdir, and on contention a guarded stale-reclaim;
 * on success, the owner stamp. Never sleeps. Returns a PASS_* outcome; on
 * PASS_STAMPED the caller runs confirmStamp() before handing out a lock.
 *
 * `state` carries what persists across passes for one caller: its token, the
 * attempt count, whether it reclaimed a stale lock, the last mkdir error it read
 * as contention, the identity of the directory this pass created, and
 * `onContention`, the waiting caller's hook for sampling the lock it started
 * waiting on.
 */
function attemptDirLock(lockDir, state, options) {
  const { staleMs } = options;
  const recoverGuardDir = `${lockDir}.recover`;
  state.attempts++;

  try {
    mkdirSync(lockDir);
  } catch (err) {
    // Not just EEXIST: Windows reports a directory that is mid-create or
    // mid-remove by another process as EPERM/EACCES. That is contention, not
    // failure — treating it as fatal kills a concurrent writer and loses its
    // write (#2777, measured on windows-latest).
    if (!isMkdirContention(err)) throw err;
    state.lastContentionError = err;
    state.onContention();

    // Serialize stale-reclaim behind a second atomic guard so only one
    // caller can be inside the decide-then-delete window at a time.
    let hasRecoverGuard = false;
    try {
      mkdirSync(recoverGuardDir);
      hasRecoverGuard = true;
    } catch (guardErr) {
      if (!isMkdirContention(guardErr)) throw guardErr;
      state.lastContentionError = guardErr;
      // An EPERM/EACCES here says the guard directory is mid-flight, not that
      // it is sitting there abandoned, so the age check below would be
      // reasoning about a directory it cannot even stat reliably. Back off to
      // the retry loop instead of judging it.
      if (guardErr.code !== 'EEXIST') return PASS_BUSY;
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
        options.onRecoverGuard?.();
      } catch { /* an observational hook must never change acquisition */ }
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
        // acquisition. It costs one backoff in a rare case; deleting a live
        // lock costs an item.
        //
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
            state.staleRecovered = true;
            return PASS_RECLAIMED; // retry acquisition immediately, still holding the guard's decision
          }
          // rm hit contention: another process is touching the stale lock at
          // this instant, so fall through to the normal backoff instead of
          // treating the collision as fatal.
        }
      } finally {
        rmLockArtifactSync(recoverGuardDir);
      }
    }
    return PASS_BUSY;
  }

  // The directory we just won, by identity. confirmStamp() checks it
  // alongside the stamp, and falls back on it alone when the stamp cannot be
  // read at all.
  state.created = statForIdentity(lockDir);

  // Acquired. Record ownership; an owner-less lock would block every future
  // acquirer until the age-out, so clean up if the stamp can't be written.
  // Its own try, NOT the mkdir's: a failure here is about a directory this
  // caller created, and the mkdir catch above would read EPERM/EACCES from
  // the write as contention and wait on our own ownerless lock (#5358).
  try {
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid,
      token: state.token,
      started_at: new Date().toISOString(),
      ...options.owner,
    }, null, 2), { flag: 'wx' });
  } catch (ownerErr) {
    // ENOENT writing owner.json means the just-won lock directory is gone:
    // another caller (mis)judged it reclaimable and deleted it. That is a
    // lost race, not a failure — re-enter the loop and compete again.
    // Dying here loses the caller's queued write (#2777, third face). And
    // deleting here would be worse: the path may already hold a NEWER
    // caller's live lock, which an rm would free underneath it (#5358).
    //
    // EEXIST is the same race seen from the other side. The directory we
    // created was empty, so a stamp already in it means our directory was
    // replaced by another caller's before we wrote. The exclusive write is
    // what keeps us from overwriting that holder's stamp: a plain write would
    // put our token in its lock, our read-back would then accept it, and two
    // processes would enter the critical section (#5389 review).
    if (ownerErr?.code === 'ENOENT' || ownerErr?.code === 'EEXIST') return PASS_LOST_RACE;
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

  return PASS_STAMPED;
}

/**
 * Read our own stamp back before handing the caller a lock handle. A generator
 * so the retry schedule is written once for both entry points: it yields each
 * pause and returns whether the lock is still ours. acquireDirLock awaits the
 * pauses (settleAsync); tryAcquireDirLockSync blocks on them (settleSync).
 *
 * The identity recheck in attemptDirLock stops this caller from deleting a
 * directory it did not judge, but it cannot stop another caller from doing so
 * to US, and that failure has no error attached to it: the delete lands after
 * our owner.json write succeeds, so nothing in the acquisition path notices and
 * two processes enter the critical section believing they hold it.
 *
 * The ENOENT branch of the owner write recovers the case where the delete
 * lands BEFORE the stamp. This is the same recovery for the case where it lands
 * just after. A stamp that is missing, or that carries someone else's token,
 * means we no longer hold what we took, so we compete again rather than
 * proceed.
 *
 * A read that FAILED (not ENOENT) is neither answer. On Windows a live
 * holder's stamp is momentarily unreadable while waiters churn the
 * directory (see readLockOwner), and treating that as "lost" sends this
 * caller back to wait on its own lock: the mkdir meets EEXIST, the verdict
 * finds our own live pid and answers LIVE, and the caller times out while
 * the orphan it leaves blocks every writer until this process exits. So an
 * inconclusive read is retried briefly, and if it never becomes readable
 * the directory's identity decides: a replacement lock is a new directory.
 * Identity is the fallback, not the rule, because a filesystem can reuse
 * an inode number for a directory recreated at once, which only the stamp
 * can tell apart.
 */
function* confirmStamp(lockDir, state) {
  let readBack = readLockOwner(lockDir);
  for (let retry = 0; !readBack.inspected && retry < READBACK_RETRIES; retry++) {
    yield READBACK_RETRY_MS;
    readBack = readLockOwner(lockDir);
  }
  // A readable stamp with our token must also sit in the directory we
  // created. The exclusive write already refuses another holder's stamp, so
  // this is the second guard on the same race, not the only one. A stat that
  // merely failed is no evidence against us (the Windows churn again), so it
  // only blocks us when the identity is known to differ or the directory is
  // known to be gone.
  const identity = sameAsCreated(state.created, statForIdentity(lockDir));
  return readBack.inspected
    ? readBack.owner?.token === state.token && identity !== false
    : identity === true;
}

async function settleAsync(steps) {
  let step = steps.next();
  while (!step.done) {
    await sleep(step.value);
    step = steps.next();
  }
  return step.value;
}

function settleSync(steps) {
  let step = steps.next();
  while (!step.done) {
    sleepSync(step.value);
    step = steps.next();
  }
  return step.value;
}

function newAttemptState(onContention = () => {}) {
  return { token: randomUUID(), attempts: 0, staleRecovered: false, lastContentionError: null, created: null, onContention };
}

function lockHandle(lockDir, state, startedAt, options) {
  activeTokens.add(state.token);
  return {
    lockDir,
    token: state.token,
    attempts: state.attempts,
    waitMs: Date.now() - startedAt,
    staleRecovered: state.staleRecovered,
    release: createRelease(lockDir, state.token, options.removeLock),
  };
}

/**
 * Blocks until the directory lock at `lockDir` is held, then returns a handle
 * whose release() frees it.
 *
 * @param {string} lockDir - The lock directory itself (not the file it guards).
 * @param {object} options
 * @param {number} options.timeoutMs - Max time a SINGLE holder may block this caller. Waiting is extended while the lock keeps changing hands (see createLockWaitPolicy).
 * @param {number} options.retryMs - Mean delay between acquisition attempts (jittered).
 * @param {number} options.staleMs - Age threshold for a lock with no readable owner, floored at OWNERLESS_GRACE_MS.
 * @param {number} [options.maxWaitMs] - Absolute ceiling on waiting, however much progress the lock makes. Omitted: the policy's default, DEFAULT_MAX_WAIT_FACTOR x timeoutMs.
 * @param {object} [options.owner] - Extra owner.json fields, recorded for diagnostics.
 * @param {boolean} [options.createParent=false] - mkdir -p the lock's parent first.
 * @param {(info: {lockDir: string, expiredMs: number, owner: object, lastMkdirError: string|null, diagnosis: string}) => Error} [options.timeoutError]
 *   Builds the error thrown when the wait gives up. `expiredMs` is the bound that
 *   actually ran out; `diagnosis` is a ready-made " — owner=…" suffix.
 * @param {() => void} [options.onRecoverGuard] - Called each time this caller takes the recover guard (test ordering hook).
 * @param {(lockDir: string) => void} [options.removeLock] - Release's rm, injectable for fault tests.
 * @returns {Promise<{lockDir: string, token: string, attempts: number, waitMs: number, staleRecovered: boolean, release: () => void}>}
 */
export async function acquireDirLock(lockDir, options) {
  const { timeoutMs, retryMs, maxWaitMs } = options;
  const startedAt = Date.now();
  // Deliberately NOT floored at timeoutMs. A caller that asks for a ceiling
  // below one per-holder window means it, and quietly raising it would make
  // maxWaitMs a no-op in precisely the range where it was stated most
  // explicitly. The ceiling wins; timeoutMs just stops mattering.
  const hardDeadline = maxWaitMs === undefined ? undefined : startedAt + maxWaitMs;
  const ceilingMs = maxWaitMs ?? timeoutMs * DEFAULT_MAX_WAIT_FACTOR;

  const { backoffMs, holderStillWedged, noteWaiting, ceilingReached } = createLockWaitPolicy(lockDir, {
    timeoutMs, retryMs, deadline: startedAt + timeoutMs, hardDeadline,
  });
  // state.lastContentionError is the last mkdir error this caller treated as
  // contention. On POSIX it is always EEXIST and says nothing; on Windows an
  // EPERM/EACCES that persists to the deadline is the difference between
  // "crowded" and "this process cannot create directories here at all", and
  // without it a real permissions problem would present as a plain,
  // unexplained timeout.
  const state = newAttemptState(noteWaiting);

  // Built at the throw site so the diagnosis reflects the moment it gave up.
  // A timeout on a critical section that is a single sub-millisecond append
  // has more than one explanation, and the owner record separates them:
  //   - no owner, or an owner whose PID is dead: real contention, and the
  //     structural answer is a fair queue rather than a bigger budget.
  //   - an owner reported ALIVE after tens of seconds: the directory outlived
  //     its holder, because release()'s rm can fail on Windows while a handle
  //     is open and is swallowed by design.
  // Diagnostic only: it never changes whether the error is thrown.
  // `expiredMs` is the bound that actually ran out, so the message names the
  // limit that was applied. Reporting timeoutMs when the CEILING expired states
  // a number that was never in force.
  const buildTimeoutError = (expiredMs = timeoutMs) => {
    const info = { lockDir, expiredMs, owner: null, lastMkdirError: null, diagnosis: '' };
    try {
      const { inspected, owner } = readLockOwner(lockDir);
      info.owner = owner
        ? { pid: owner.pid, alive: processIsAlive(owner.pid), started_at: owner.started_at, heldMs: Date.parse(owner.started_at) ? Date.now() - Date.parse(owner.started_at) : null }
        // The note separates the two cases the diagnosis could not otherwise
        // tell apart, because they point at different bugs: a stamp that is
        // absent is an acquisition still in flight, while one that could not be
        // read is the condition lockRecoveryVerdict refuses to condemn.
        : {
          pid: null,
          alive: null,
          note: !inspected ? 'owner.json exists but could not be read'
            : existsSync(lockDir) ? 'lock exists with no owner.json'
              : 'lock vanished before it could be read',
        };
      info.diagnosis = ` — owner=${JSON.stringify(info.owner)}`;
      const lastContentionError = state.lastContentionError;
      if (lastContentionError && lastContentionError.code !== 'EEXIST') {
        info.lastMkdirError = lastContentionError.code;
        info.diagnosis += `, last mkdir error=${lastContentionError.code} on ${lastContentionError.path ?? '?'}`;
      }
    } catch { /* diagnosis must never mask the timeout it describes */ }
    return options.timeoutError ? options.timeoutError(info) : new DirLockTimeoutError(lockDir, expiredMs);
  };

  // A fresh install may not have data/ yet — plugins.mjs's cmdRun calls
  // appendToPipeline with no directory pre-creation, and appendPortalHealth()
  // creates data/ only after its lock is taken — so create it here rather
  // than letting mkdirSync(lockDir) throw a raw ENOENT.
  if (options.createParent) mkdirSync(dirname(lockDir), { recursive: true });

  for (;;) {
    // The ceiling is tested FIRST, on its own, on every pass. Nesting it inside
    // the per-holder deadline made it conditional on a branch that may never
    // run: a caller whose maxWaitMs is below timeoutMs never reaches the inner
    // check, a re-arm pushes the next look a whole window away, and the reclaim
    // fast-path continues straight past both. A bound that holds only when
    // another bound happens to fire is not a bound.
    if (ceilingReached()) throw buildTimeoutError(ceilingMs);

    const outcome = attemptDirLock(lockDir, state, options);
    if (outcome === PASS_STAMPED) {
      if (await settleAsync(confirmStamp(lockDir, state))) return lockHandle(lockDir, state, startedAt, options);
      // Not ours any more: a lost race, judged like the others below.
    } else if (outcome === PASS_RECLAIMED) {
      continue;
    }
    if (holderStillWedged()) throw buildTimeoutError();
    if (outcome !== PASS_BUSY) continue;
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
  }
}

/**
 * Takes the directory lock at `lockDir` if it can be had now, without waiting:
 * returns the same handle acquireDirLock does, or null when another holder has
 * it. For a caller whose answer to contention is "busy, retry" rather than a
 * queue — a synchronous request handler returning 409, say.
 *
 * Not a weaker lock. It is the same pass acquireDirLock makes, so a stale lock
 * (a crashed holder, an ownerless leftover past its age-out) is reclaimed in
 * line and the caller proceeds; only a LIVE holder answers null. The one wait
 * it shares is confirmStamp's: an unreadable read-back of its own stamp
 * blocks for at most READBACK_RETRIES x READBACK_RETRY_MS (50ms) before the
 * directory's identity decides. A readable stamp, the normal case, never waits.
 *
 * @param {string} lockDir - The lock directory itself (not the file it guards).
 * @param {object} options
 * @param {number} options.staleMs - Age threshold for a lock with no readable owner, floored at OWNERLESS_GRACE_MS.
 * @param {object} [options.owner] - Extra owner.json fields, recorded for diagnostics.
 * @param {boolean} [options.createParent=false] - mkdir -p the lock's parent first.
 * @param {() => void} [options.onRecoverGuard] - Called each time this caller takes the recover guard (test ordering hook).
 * @param {(lockDir: string) => void} [options.removeLock] - Release's rm, injectable for fault tests.
 * @returns {{lockDir: string, token: string, attempts: number, waitMs: number, staleRecovered: boolean, release: () => void} | null}
 */
export function tryAcquireDirLockSync(lockDir, options) {
  const startedAt = Date.now();
  const state = newAttemptState();
  if (options.createParent) mkdirSync(dirname(lockDir), { recursive: true });
  for (let pass = 0; pass < SYNC_MAX_PASSES; pass++) {
    const outcome = attemptDirLock(lockDir, state, options);
    if (outcome === PASS_STAMPED && settleSync(confirmStamp(lockDir, state))) {
      return lockHandle(lockDir, state, startedAt, options);
    }
    if (outcome === PASS_BUSY) return null;
  }
  return null;
}

/**
 * The handle's release(). Idempotent, and retryable: a release that throws can
 * be called again, and it remembers what it had already verified.
 *
 * It removes the lock only when it can show the directory is still the one this
 * caller stamped: a stat on either side of reading the stamp, compared by
 * identity, so a lock that was reclaimed and recreated in between is left to
 * its new owner. Our operation can outlive staleMs, and another process can
 * then legitimately reclaim the lock — deleting it here would free someone
 * else's critical section.
 *
 * Throws when ownership cannot be established either way (the directory is
 * there but its stamp is missing or unreadable) and on a removal failure that
 * is not Windows contention. Contention is swallowed: ownership was verified,
 * so a contended rm (EPERM/EBUSY while another process stats the directory)
 * must not fail a caller whose work already succeeded; the orphan ages out via
 * lockRecoveryVerdict.
 */
function createRelease(lockDir, token, removeLock = (path) => rmSync(path, { recursive: true, force: true })) {
  let released = false;
  let verifiedDir = null;
  // Released, whether or not the rm below succeeded: the handle no longer
  // holds the lock, so its token stops counting as live (see activeTokens).
  const finish = () => {
    released = true;
    activeTokens.delete(token);
  };
  return function release() {
    if (released) return;
    if (verifiedDir) {
      // A previous call verified ownership and then failed to remove. Its own
      // partial cleanup may have taken owner.json with it, so a missing stamp
      // is no longer evidence against us; the directory's identity is.
      let currentDir;
      try {
        currentDir = statSync(lockDir);
      } catch (err) {
        if (err?.code === 'ENOENT') {
          finish();
          return;
        }
        throw err;
      }
      if (!sameLockDirectory(verifiedDir, currentDir)) {
        finish();
        return;
      }
      const { owner } = readLockOwner(lockDir);
      if (owner && owner.token !== token) {
        finish();
        return;
      }
      if (!owner && existsSync(join(lockDir, 'owner.json'))) {
        throw new Error(`Cannot verify lock ownership at ${lockDir}`);
      }
    } else {
      let beforeRead;
      try {
        beforeRead = statSync(lockDir);
      } catch (err) {
        if (err?.code === 'ENOENT') {
          finish();
          return;
        }
        throw err;
      }
      const { owner } = readLockOwner(lockDir);
      if (owner?.token !== token) {
        if (owner) {
          finish(); // reclaimed by someone else — leave it alone
          return;
        }
        throw new Error(`Cannot verify lock ownership at ${lockDir}`);
      }
      const afterRead = statSync(lockDir);
      if (!sameLockDirectory(beforeRead, afterRead)) {
        finish(); // swapped underneath us
        return;
      }
      verifiedDir = afterRead;
    }
    try {
      removeLock(lockDir);
    } catch (rmErr) {
      if (!isRmContention(rmErr)) throw rmErr;
    }
    finish();
  };
}

/**
 * Release a handle from a `finally`, where a throw would replace the caller's
 * own outcome: a failed release must neither mask the error that is unwinding
 * nor turn a completed write into a reported failure. A warning is the honest
 * answer, and the handle is then abandoned: nothing will retry this release.
 *
 * So its token stops counting as live here, even though release() itself
 * keeps it (a handle whose release threw may be retried, and until then it
 * still holds the lock). An abandoned token left in activeTokens would pin the
 * leftover LIVE until this process exits — a chat answering 409, a store
 * timing out, until the web server restarts. Dropped, the leftover goes to the
 * age rule like any other stamp of ours with no handle behind it.
 */
export function releaseOrWarn(lock) {
  try {
    lock.release();
  } catch (err) {
    activeTokens.delete(lock.token);
    console.error(`Warning: lock cleanup failed at ${lock.lockDir}: ${err.message}`);
  }
}
