// lib/test-queue.mjs — one full test-all.mjs run at a time on this machine.
//
// A full run already uses every core (--jobs defaults to availableParallelism),
// so two of them started together, from two sessions in two worktrees, each get
// half a machine. Neither finishes in the time its suites were written against:
// child timeouts fire, timing assertions overrun, and the run reads as broken
// when nothing is. A second full run therefore waits for the first to finish.
//
// The queue is a lib/dir-lock.mjs lock in the OS temp directory, so every clone
// and worktree for this user shares it: the contention is for the machine's
// CPUs, not for any one checkout. A holder that dies is detected by its PID and
// its lock reclaimed, so a killed run never wedges the queue. Waiters are not
// served strictly first-come-first-served (see the jitter note in
// acquireDirLock), but only one full run proceeds at a time.
//
// Environment:
//   CAREER_OPS_TEST_QUEUE=0         do not queue. The run that holds the queue
//                                   sets it for everything it starts, so a suite
//                                   that launches a test-all of its own does not
//                                   wait for its parent to finish.
//   CAREER_OPS_TEST_QUEUE_LOCK=dir  the lock directory, in place of the default.

import { tmpdir } from 'os';
import { join } from 'path';
import { acquireDirLock, readLockOwner, releaseOrWarn, tryAcquireDirLockSync } from './dir-lock.mjs';

export const DEFAULT_TEST_QUEUE_LOCK = join(tmpdir(), 'career-ops-test-all.lock');

// How long one live holder may keep a waiter waiting before the waiter gives
// up. A healthy full run takes minutes; an hour without the lock changing hands
// is a hung run, and a waiter that never says so would hang with it.
const HOLDER_TIMEOUT_MS = 60 * 60_000;
// Only for a lock with no readable owner.json: a crash between the mkdir and
// the stamp. A stamped lock is judged by its owner's PID, however old it is.
const OWNERLESS_STALE_MS = 60_000;

function describeHolder(owner) {
  if (!owner?.pid) return 'a run whose owner could not be read';
  const since = Date.parse(owner.started_at);
  const minutes = Number.isFinite(since) ? `, for ${Math.max(0, Math.round((Date.now() - since) / 60_000))} min` : '';
  return `pid ${owner.pid}${owner.cwd ? ` in ${owner.cwd}` : ''}${minutes}`;
}

/**
 * Wait until no other full run holds the queue, then hold it until this
 * process exits.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env] - Read for the switches above, and
 *   set to CAREER_OPS_TEST_QUEUE=0 once the queue is held.
 * @param {(line: string) => void} [options.log] - Where the waiting notice goes.
 * @param {number} [options.holderTimeoutMs] - See HOLDER_TIMEOUT_MS.
 * @param {number} [options.retryMs] - Mean delay between looks while waiting.
 * @returns {Promise<{lockDir: string, waitMs: number} | null>} null when queueing is off.
 *   Rejects when one holder keeps the queue past holderTimeoutMs.
 */
export async function holdTestQueue({
  env = process.env,
  log = console.log,
  holderTimeoutMs = HOLDER_TIMEOUT_MS,
  retryMs = 2_000,
} = {}) {
  if ((env.CAREER_OPS_TEST_QUEUE ?? '').trim() === '0') return null;
  const lockDir = env.CAREER_OPS_TEST_QUEUE_LOCK?.trim() || DEFAULT_TEST_QUEUE_LOCK;
  const options = { staleMs: OWNERLESS_STALE_MS, createParent: true, owner: { cwd: process.cwd() } };

  let lock = tryAcquireDirLockSync(lockDir, options);
  if (!lock) {
    log(`  ⏳ another full test-all.mjs run holds the queue (${describeHolder(readLockOwner(lockDir).owner)}) — waiting for it to finish. CAREER_OPS_TEST_QUEUE=0 skips the queue.`);
    lock = await acquireDirLock(lockDir, {
      ...options,
      timeoutMs: holderTimeoutMs,
      retryMs,
      // Waiting stays open while the queue keeps changing hands, however many
      // runs are ahead; only one holder that never lets go ends it.
      maxWaitMs: Infinity,
      timeoutError: ({ owner }) => new Error(
        `gave up after ${Math.round(holderTimeoutMs / 60_000)} min waiting for the test queue at ${lockDir}, held by ${describeHolder(owner)}. `
        + 'If that run is hung, stop it; CAREER_OPS_TEST_QUEUE=0 runs without the queue.',
      ),
    });
    log(`  ▶ test queue free after ${Math.round(lock.waitMs / 1000)}s — starting`);
  }
  env.CAREER_OPS_TEST_QUEUE = '0';
  // 'exit' also fires for process.exit() and for exitOnInterrupt()'s exit, so
  // every way the run ends lets the next one in. A SIGKILL skips it; the next
  // waiter then finds this PID dead and reclaims the lock.
  process.on('exit', () => releaseOrWarn(lock));
  return { lockDir, waitMs: lock.waitMs };
}
