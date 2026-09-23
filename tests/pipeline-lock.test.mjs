/**
 * pipeline-lock.test.mjs — regression tests for pipeline-lock.mjs.
 *
 * The lock exists to serialize appendToPipeline()'s read-modify-write on
 * data/pipeline.md (#2188). These tests pin the three properties that make
 * that guarantee actually hold under contention and on fresh installs:
 *
 *   1. Mutual exclusion — a second acquirer cannot take a lock a live holder
 *      still owns, and times out instead.
 *   2. Stale-reclaim safety — reclaiming a crashed holder's lock must not let
 *      two processes both end up "holding" it. A naive stat-then-rmSync-then-
 *      mkdirSync reclaim is itself a TOCTOU race: two callers that both judge
 *      the same lock stale can have the second one's rmSync delete the first
 *      one's freshly created lock, after which both believe they hold it.
 *   3. Fresh-install robustness — the lock must not throw ENOENT when the
 *      parent data/ directory does not exist yet (plugins.mjs's cmdRun calls
 *      appendToPipeline with no directory pre-creation).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquirePipelineLock, LockTimeoutError, OWNERLESS_GRACE_MS,
  lockRecoveryVerdict, RECOVER_STALE, RECOVER_VANISHED, RECOVER_LIVE,
  createLockWaitPolicy,
} from '../pipeline-lock.mjs';
import { collectMjsFiles } from '../lib/mjs-files.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(SELF));

// Occupies `lockDir` continuously while handing it to a fresh owner every
// `everyMs`, the way a queue of short writers does. The swap runs inside one
// synchronous timer callback, so an in-process waiter can never slip through
// the gap — from its point of view the lock is busy the entire time, but busy
// with a DIFFERENT holder each window. Returns a stop() and the handoff count.
function churnLock(lockDir, everyMs) {
  let handoffs = 0;
  const takeIt = () => {
    rmSync(lockDir, { recursive: true, force: true });
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid, token: `handoff-${handoffs++}`, started_at: new Date().toISOString(),
    }), 'utf-8');
  };
  takeIt();
  const timer = setInterval(takeIt, everyMs);
  return {
    handoffs: () => handoffs,
    stop() {
      clearInterval(timer);
      rmSync(lockDir, { recursive: true, force: true });
    },
  };
}

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-pipeline-lock-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  return root;
}

// Ages a directory by rewriting its mtime, so the age-based branch can be
// exercised at any point on either side of the grace floor without sleeping.
function backdate(dir, ms) {
  const when = new Date(Date.now() - ms);
  utimesSync(dir, when, when);
}

// A lock directory left behind by a holder that died — stale by the owner-PID
// rule, so reclamation is genuinely on the table.
function writeCrashedHolder(lockDir) {
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
    pid: 2147483000, // not a live pid
    token: 'crashed-holder-token',
    started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  }), 'utf-8');
}

test('acquirePipelineLock: a live holder blocks a second acquirer, which times out', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const held = await acquirePipelineLock(p, { timeoutMs: 300, retryMs: 20 });
    try {
      await assert.rejects(
        () => acquirePipelineLock(p, { timeoutMs: 300, retryMs: 20 }),
        (err) => err instanceof LockTimeoutError,
      );
    } finally {
      held.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: configurable timing — the contention timeout is not a hard-coded multi-second wait', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const held = await acquirePipelineLock(p, { timeoutMs: 150, retryMs: 20 });
    try {
      const startedAt = Date.now();
      // The failure must be the *timeout*, not an unrelated instant throw —
      // otherwise a lock broken in some other way still passes this test.
      await assert.rejects(
        () => acquirePipelineLock(p, { timeoutMs: 150, retryMs: 20 }),
        (err) => err instanceof LockTimeoutError,
      );
      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed >= 100, `timeout returned too early after ${elapsed}ms — the caller timeout was not actually awaited`);
      // Must honor the caller's timeout, not the module default (seconds).
      assert.ok(elapsed < 2000, `expected the caller timeout to be honored, waited ${elapsed}ms`);
    } finally {
      held.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: creates a missing parent data/ directory instead of throwing ENOENT (fresh install)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-pipeline-lock-fresh-'));
  try {
    // No data/ directory at all — the plugins.mjs cmdRun path.
    const p = join(root, 'data', 'pipeline.md');
    assert.equal(existsSync(dirname(p)), false);
    const lock = await acquirePipelineLock(p, { timeoutMs: 300, retryMs: 20 });
    lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: stale-reclaim is serialized — a second reclaimer cannot delete the winner\'s fresh lock and double-hold', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const lockDir = `${p}.lock`;

    // Simulate a crashed holder: a lock directory owned by a PID that is not
    // alive, old enough to be judged stale by any age rule.
    writeCrashedHolder(lockDir);

    // Two concurrent acquirers both see the same stale lock. Exactly one must
    // win; the loser must NOT end up holding a lock at the same time.
    const [a, b] = await Promise.allSettled([
      acquirePipelineLock(p, { timeoutMs: 1000, retryMs: 15, staleMs: 1 }),
      acquirePipelineLock(p, { timeoutMs: 1000, retryMs: 15, staleMs: 1 }),
    ]);

    const winners = [a, b].filter((r) => r.status === 'fulfilled');
    assert.equal(winners.length, 1, 'exactly one acquirer may hold the reclaimed lock at a time');
    // ...and the loser must have lost by *waiting out the lock*, not by
    // crashing on something unrelated, which would make the count above lie.
    const failures = [a, b].filter((r) => r.status === 'rejected');
    assert.ok(
      failures[0].reason instanceof LockTimeoutError,
      `the losing acquirer must fail with LockTimeoutError, got: ${failures[0].reason}`,
    );
    winners.forEach((w) => w.value.release());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: a just-created ownerless lock is never judged stale, however small the caller staleMs (#2304)', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const lockDir = `${p}.lock`;

    // The acquisition window: a holder has mkdir'd the lock but has not
    // written owner.json yet. Age alone must not make this reclaimable, or a
    // contender deletes the winner's lock and both end up "holding" it.
    mkdirSync(lockDir, { recursive: true });

    await assert.rejects(
      () => acquirePipelineLock(p, { timeoutMs: 200, retryMs: 20, staleMs: 0 }),
      (err) => err instanceof LockTimeoutError,
    );
    assert.ok(existsSync(lockDir), 'a contender destroyed a lock created microseconds ago');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: an ownerless lock older than the grace floor is still reclaimable (#2304)', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const lockDir = `${p}.lock`;

    // The floor must not become "ownerless locks are never reclaimable" — a
    // truly abandoned lock with no owner metadata has to age out.
    mkdirSync(lockDir, { recursive: true });
    backdate(lockDir, OWNERLESS_GRACE_MS * 3);

    const lock = await acquirePipelineLock(p, { timeoutMs: 500, retryMs: 20, staleMs: 1 });
    lock.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: the grace floor never shortens a larger caller-supplied staleMs (#2304)', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const lockDir = `${p}.lock`;

    // Past the floor, but nowhere near the caller's staleMs. The floor is a
    // lower bound on patience, not a replacement for the caller's value.
    mkdirSync(lockDir, { recursive: true });
    backdate(lockDir, OWNERLESS_GRACE_MS * 2);

    await assert.rejects(
      () => acquirePipelineLock(p, { timeoutMs: 200, retryMs: 20, staleMs: 60 * 60_000 }),
      (err) => err instanceof LockTimeoutError,
    );
    assert.ok(existsSync(lockDir), 'the caller asked for an hour of patience and got the floor instead');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: a live recover guard is not deleted out from under the caller inside it (#2304)', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const lockDir = `${p}.lock`;
    const guardDir = `${lockDir}.recover`;

    // A stale lock is available to reclaim...
    writeCrashedHolder(lockDir);
    // ...but another caller is already inside the guarded decide-then-delete
    // window. The guard never carries owner.json, so it is judged by age
    // alone — and a fresh one must not be reclaimable, or two callers end up
    // inside that window at once and each rmSync's the other's guard.
    mkdirSync(guardDir);

    await assert.rejects(
      () => acquirePipelineLock(p, { timeoutMs: 200, retryMs: 20, staleMs: 1 }),
      (err) => err instanceof LockTimeoutError,
    );
    assert.ok(existsSync(guardDir), 'a contender deleted a live recover guard, defeating reclaim serialization');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: a recover guard abandoned by a crashed process still ages out (#2304)', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const lockDir = `${p}.lock`;
    const guardDir = `${lockDir}.recover`;

    // A process killed between taking the guard and cleaning it up must not
    // disable stale recovery forever — the floor delays reclaim, never blocks it.
    writeCrashedHolder(lockDir);
    mkdirSync(guardDir);
    backdate(guardDir, OWNERLESS_GRACE_MS * 3);

    const lock = await acquirePipelineLock(p, { timeoutMs: 1000, retryMs: 20, staleMs: 1 });
    lock.release();
    assert.equal(existsSync(guardDir), false, 'the abandoned recover guard should have been cleaned up');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The verdict itself. A cross-process reproduction of the bug below is
// inherently a race — it needs a rival acquirer to win the mkdir inside the
// microseconds between the verdict and the rm — so the decision is asserted
// directly instead. What the caller does with each verdict is the other half,
// and it is a two-line branch right at the call site.
test('lockRecoveryVerdict: an absent directory is VANISHED, never STALE — "gone" is not a licence to delete', () => {
  const root = fixtureRoot();
  try {
    const lockDir = join(root, 'data', 'pipeline.md.lock');
    // Nothing at the path at all: the exact state that produced
    // `canRecover:VANISHED->true` in the trace, immediately before a rival
    // acquirer created a fresh lock there and had it deleted underneath it.
    assert.equal(lockRecoveryVerdict(lockDir, 1), RECOVER_VANISHED);
    // The distinction that matters: a caller that deletes on STALE and only on
    // STALE cannot destroy a lock it never observed.
    assert.notEqual(lockRecoveryVerdict(lockDir, 1), RECOVER_STALE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lockRecoveryVerdict: STALE, LIVE and the grace floor keep their existing meanings', () => {
  const root = fixtureRoot();
  try {
    const dead = join(root, 'data', 'dead.lock');
    writeCrashedHolder(dead);
    assert.equal(lockRecoveryVerdict(dead, 1), RECOVER_STALE, 'a crashed holder is still reclaimable');

    const live = join(root, 'data', 'live.lock');
    mkdirSync(live, { recursive: true });
    writeFileSync(join(live, 'owner.json'), JSON.stringify({
      pid: process.pid, token: 'live', started_at: new Date().toISOString(),
    }), 'utf-8');
    backdate(live, OWNERLESS_GRACE_MS * 50);
    assert.equal(lockRecoveryVerdict(live, 1), RECOVER_LIVE, 'a live owner is never stale, however old');

    const fresh = join(root, 'data', 'fresh.lock');
    mkdirSync(fresh, { recursive: true });
    assert.equal(lockRecoveryVerdict(fresh, 1), RECOVER_LIVE, 'ownerless but inside the grace floor (#2304)');

    const aged = join(root, 'data', 'aged.lock');
    mkdirSync(aged, { recursive: true });
    backdate(aged, OWNERLESS_GRACE_MS * 5);
    assert.equal(lockRecoveryVerdict(aged, 1), RECOVER_STALE, 'ownerless past the floor still ages out (#2304)');

    // #2984: unreadable is not ownerless, and must not become VANISHED either —
    // that would hand the caller the same delete by a different route.
    const opaque = join(root, 'data', 'opaque.lock');
    mkdirSync(opaque, { recursive: true });
    mkdirSync(join(opaque, 'owner.json'));
    backdate(opaque, OWNERLESS_GRACE_MS * 5);
    assert.equal(lockRecoveryVerdict(opaque, 1), RECOVER_LIVE, 'a stamp we could not read protects the lock');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lockCanRecover: a lock whose owner.json exists but cannot be read is never reclaimed (Windows contention)', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const lockDir = `${p}.lock`;

    // A live holder whose stamp is momentarily unreadable. Simulated portably
    // by making owner.json a directory, so readFileSync fails with something
    // that is emphatically NOT ENOENT — exactly like the EPERM/EBUSY a real
    // Windows holder's stamp returns while 29 other processes hammer the lock.
    mkdirSync(lockDir, { recursive: true });
    mkdirSync(join(lockDir, 'owner.json'));
    // Old enough that the age rule would happily condemn it, so the ONLY thing
    // protecting this live lock is refusing to judge what cannot be inspected.
    backdate(lockDir, OWNERLESS_GRACE_MS * 5);

    await assert.rejects(
      () => acquirePipelineLock(p, { timeoutMs: 200, retryMs: 20, staleMs: 1 }),
      (err) => err instanceof LockTimeoutError,
    );
    // Before the fix this reclaimed the lock: unreadable was conflated with
    // ownerless, the age rule condemned it, and the real holder then died with
    // ENOENT writing its own owner.json — losing that caller's queued item.
    assert.ok(existsSync(lockDir), 'an unreadable owner stamp let a contender delete a live lock');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LockTimeoutError carries the live holder it was blocked by (#2834 diagnostic survives)', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const held = await acquirePipelineLock(p, { timeoutMs: 150, retryMs: 20 });
    try {
      // The owner diagnostic is built inside a try/catch that must never mask
      // the timeout, which also means a silently broken one changes nothing
      // observable — exactly how changing readLockOwner()'s return shape
      // degraded it to {alive:false, heldMs:null} without failing a single
      // test. Pin the fields so the next shape change cannot do it quietly.
      const err = await acquirePipelineLock(p, { timeoutMs: 150, retryMs: 20 }).then(
        (lock) => { lock.release(); return null; },
        (e) => e,
      );
      assert.ok(err instanceof LockTimeoutError, `expected a timeout, got ${err}`);
      assert.equal(err.owner?.pid, process.pid, `the blocking holder's pid was not reported: ${JSON.stringify(err.owner)}`);
      assert.equal(err.owner?.alive, true, `a live holder was reported as not alive: ${JSON.stringify(err.owner)}`);
      assert.ok(Number.isFinite(err.owner?.heldMs), `hold duration missing: ${JSON.stringify(err.owner)}`);
      assert.match(err.message, /owner=/, 'the owner record never reached the message');
    } finally {
      held.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Both ceiling tests race the acquire against a wall-clock bound rather than
// awaiting it. Against a lock that churns for ever, a broken ceiling does not
// return at all, and a bare await would hang the suite instead of failing it.
// The retry loop yields on every pass, so the racing timer does get to run.
async function settleOrGiveUp(promise, ms) {
  return Promise.race([
    promise.then((lock) => { lock.release(); return 'ACQUIRED'; }, (err) => err),
    sleep(ms).then(() => 'NEVER_SETTLED'),
  ]);
}



test('acquirePipelineLock: a lock that keeps changing hands does not time out a waiting caller', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const churn = churnLock(`${p}.lock`, 40);
    // Let the lock change hands for several times the caller's timeout, then
    // free it. The caller must still be waiting, not dead.
    const freeItLater = sleep(600).then(() => churn.stop());

    const startedAt = Date.now();
    // The old absolute deadline killed this caller at 150ms with
    // LockTimeoutError even though the lock was healthy and briskly shared —
    // which for agent-inbox.mjs meant its request was silently dropped. The
    // timeout is for a WEDGED holder, not for losing the retry lottery.
    const lock = await acquirePipelineLock(p, { timeoutMs: 150, retryMs: 15 });
    const elapsed = Date.now() - startedAt;
    lock.release();
    await freeItLater;

    assert.ok(elapsed > 400, `acquired after only ${elapsed}ms — the lock was not actually contended`);
    assert.ok(churn.handoffs() > 5, `only ${churn.handoffs()} handoffs — the deadline was never crossed mid-contention`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: extended waiting is still bounded by maxWaitMs, so endless churn cannot hang a caller', async () => {
  const root = fixtureRoot();
  const churn = churnLock(`${root}/data/pipeline.md.lock`, 30);
  try {
    const p = join(root, 'data', 'pipeline.md');
    // Progress must buy patience, never immortality: a lock handed round for
    // ever still has to fail the caller rather than block it indefinitely.
    const startedAt = Date.now();
    await assert.rejects(
      () => acquirePipelineLock(p, { timeoutMs: 100, retryMs: 10, maxWaitMs: 400 }),
      (err) => err instanceof LockTimeoutError,
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 400, `gave up after ${elapsed}ms, before the caller's maxWaitMs`);
    assert.ok(elapsed < 3000, `waited ${elapsed}ms — maxWaitMs did not bound the extension`);
  } finally {
    churn.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: an explicit maxWaitMs below timeoutMs is honored, not raised to it', async () => {
  const root = fixtureRoot();
  const churn = churnLock(`${root}/data/pipeline.md.lock`, 25);
  try {
    const p = join(root, 'data', 'pipeline.md');
    // The ceiling used to be floored at timeoutMs, which made it a no-op in the
    // one range where the caller stated it most explicitly: asking for "never
    // more than 200ms" bought five seconds. It was also only consulted inside
    // the per-holder deadline branch, which this caller never reaches.
    const startedAt = Date.now();
    const outcome = await settleOrGiveUp(
      acquirePipelineLock(p, { timeoutMs: 5000, retryMs: 20, maxWaitMs: 200 }),
      3000,
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(outcome instanceof LockTimeoutError, `expected the ceiling to end it, got: ${outcome}`);
    assert.ok(elapsed < 2000, `waited ${elapsed}ms — the 200ms ceiling was raised to timeoutMs`);
    // The diagnosis has to name the limit that was actually applied. Reporting
    // timeoutMs here states a number that was never in force, and sends the
    // reader looking for a 5s hold that never happened.
    assert.match(outcome.message, /held > 200ms/, `the message names a bound that was not the one that expired: ${outcome.message}`);
  } finally {
    churn.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: a lock freed after maxWaitMs is refused, not acquired', async () => {
  const root = fixtureRoot();
  const churn = churnLock(`${root}/data/pipeline.md.lock`, 25);
  try {
    const p = join(root, 'data', 'pipeline.md');
    // The ceiling expires while the caller is asleep between retries, and the
    // lock becomes free shortly after. An uncapped backoff would wake past the
    // ceiling, find the path available, and hand back a lock the caller was no
    // longer entitled to wait for — bounded overshoot, but a returned lock is
    // not a bounded error. It must refuse.
    const attempt = acquirePipelineLock(p, { timeoutMs: 5000, retryMs: 120, maxWaitMs: 150 });
    setTimeout(() => churn.stop(), 200);
    const outcome = await settleOrGiveUp(attempt, 3000);
    assert.ok(
      outcome instanceof LockTimeoutError,
      `the ceiling had already expired; acquiring anyway returns a lock past the documented limit (got: ${outcome})`,
    );
  } finally {
    churn.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: a maxWaitMs of 0 means no waiting, not the default ceiling', async () => {
  const root = fixtureRoot();
  const churn = churnLock(`${root}/data/pipeline.md.lock`, 20);
  const previous = process.env.CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS;
  try {
    const p = join(root, 'data', 'pipeline.md');
    // 0 is a MEANINGFUL setting here — "never wait past now" — so it must not go
    // through the `value || default` idiom the sibling options use: that turns a
    // caller who asked for no waiting into one who waits 10x timeoutMs, the exact
    // opposite of the request. Asserted through the env var, which is where the
    // idiom lived, and against a churning lock so only the ceiling can end it.
    process.env.CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS = '0';
    const startedAt = Date.now();
    const outcome = await settleOrGiveUp(acquirePipelineLock(p, { timeoutMs: 400, retryMs: 20 }), 3000);
    const elapsed = Date.now() - startedAt;
    assert.ok(outcome instanceof LockTimeoutError, `expected an immediate ceiling, got: ${outcome}`);
    assert.ok(elapsed < 300, `waited ${elapsed}ms for a zero ceiling — the 0 was read as "unset"`);
  } finally {
    if (previous === undefined) delete process.env.CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS;
    else process.env.CAREER_OPS_PIPELINE_LOCK_MAX_WAIT_MS = previous;
    churn.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: a negative or -Infinity ceiling takes the default rather than becoming zero', async () => {
  const root = fixtureRoot();
  const churn = churnLock(`${root}/data/pipeline.md.lock`, 20);
  try {
    const p = join(root, 'data', 'pipeline.md');
    // A negative ceiling is a mistake, not a request for no waiting. Clamping it
    // to 0 would turn a typo into "give up instantly", which is a silently
    // different behaviour; the default is at least bounded and obvious. Paired
    // with the zero test above on purpose — together they pin that 0 and "less
    // than 0" are NOT the same input.
    for (const bad of [-5, -Infinity]) {
      const startedAt = Date.now();
      const outcome = await settleOrGiveUp(
        acquirePipelineLock(p, { timeoutMs: 50, retryMs: 20, maxWaitMs: bad }), 3000,
      );
      const elapsed = Date.now() - startedAt;
      assert.ok(outcome instanceof LockTimeoutError, `maxWaitMs=${bad}: expected a timeout, got: ${outcome}`);
      assert.ok(elapsed >= 300, `maxWaitMs=${bad} gave up after ${elapsed}ms — clamped to zero instead of defaulting`);
    }
  } finally {
    churn.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('acquirePipelineLock: a non-numeric maxWaitMs falls back to the default instead of removing the ceiling', async () => {
  const root = fixtureRoot();
  const churn = churnLock(`${root}/data/pipeline.md.lock`, 25);
  try {
    const p = join(root, 'data', 'pipeline.md');
    // NaN compares false against everything, so an unusable value did not fail
    // loudly — it silently deleted the only bound on waiting. Against a lock
    // that never stops changing hands that is an unbounded wait, which is the
    // exact outcome the ceiling exists to prevent.
    const outcome = await settleOrGiveUp(
      acquirePipelineLock(p, { timeoutMs: 100, retryMs: 10, maxWaitMs: Number('not a number') }),
      4000,
    );
    assert.ok(
      outcome instanceof LockTimeoutError,
      `a NaN ceiling left the caller waiting (got: ${outcome}) — it must fall back to the default`,
    );
  } finally {
    churn.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('release(): a holder whose lock was reclaimed by another process must not delete the new owner\'s lock', async () => {
  const root = fixtureRoot();
  try {
    const p = join(root, 'data', 'pipeline.md');
    const lockDir = `${p}.lock`;

    const first = await acquirePipelineLock(p, { timeoutMs: 300, retryMs: 20 });
    // Simulate: first's operation outlived staleMs, another process reclaimed
    // the lock and now legitimately owns it with a different token.
    rmSync(lockDir, { recursive: true, force: true });
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid,
      token: 'a-different-owners-token',
      started_at: new Date().toISOString(),
    }), 'utf-8');

    first.release(); // must be a no-op: first no longer owns this lock

    assert.ok(existsSync(lockDir), 'release() deleted a lock owned by a different holder');
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
    assert.equal(owner.token, 'a-different-owners-token');
    rmSync(lockDir, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The wait ceiling belongs to the policy, not to each caller (#3895)
// ---------------------------------------------------------------------------
//
// createLockWaitPolicy clamps the jittered retry against a ceiling, but the
// ceiling itself used to arrive from outside: three lock modules each wrote
// `hardDeadline: Date.now() + timeoutMs * 10` at their own call site. Copies of
// an invariant stay correct only until one is edited, and NOTHING FAILED when
// they diverged — a wrong ceiling changes retry timing, which no test asserted
// and no user reports. These are the assertions that make that divergence
// detectable, so moving the clamp inside the policy is a fix rather than a
// relocation of a silent invariant.

test('createLockWaitPolicy: the wait ceiling is the policy\'s own, so a caller need not supply one (#3895)', () => {
  const root = fixtureRoot();
  try {
    const lockDir = join(root, 'data', 'pipeline.md.lock');
    // retryMs far above the ceiling, so the jittered retry never wins the
    // Math.min and backoffMs() reports the remaining ceiling itself.
    const policy = createLockWaitPolicy(lockDir, {
      timeoutMs: 200, retryMs: 1_000_000, deadline: Date.now() + 200,
    });

    const remaining = policy.backoffMs();
    assert.ok(
      Number.isFinite(remaining),
      `backoffMs() returned ${remaining}: with no ceiling the clamp is Math.min(x, NaN) === NaN, `
      + 'and setTimeout(NaN) fires immediately — the retry loop spins hot instead of waiting',
    );
    // 2000ms is the 10x multiple of timeoutMs each of the three lock modules
    // used to write out for itself. A literal on purpose: a test that reads the
    // constant back out of the module cannot notice that constant moving.
    assert.ok(
      Math.abs(remaining - 2_000) <= 100,
      `default ceiling is ~${remaining}ms away, expected ~2000ms (10 x timeoutMs)`,
    );
    assert.equal(policy.ceilingReached(), false, 'the ceiling cannot already be reached at t=0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createLockWaitPolicy: the policy-supplied ceiling actually expires, so waiting stays bounded (#3895)', async () => {
  const root = fixtureRoot();
  try {
    const lockDir = join(root, 'data', 'pipeline.md.lock');
    const policy = createLockWaitPolicy(lockDir, {
      timeoutMs: 5, retryMs: 1, deadline: Date.now() + 5,
    });

    await sleep(120); // well past 10 x 5ms, so this is not a race against the clock

    assert.equal(
      policy.ceilingReached(), true,
      'ceilingReached() never fires without a ceiling (Date.now() > undefined is always false), '
      + 'so a caller waits unboundedly on a lock that never frees',
    );
    assert.equal(policy.backoffMs(), 0, 'past the ceiling there is nothing left to sleep');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createLockWaitPolicy: a hardDeadline that is not a number is refused, not silently turned into NaN (#3895)', () => {
  const root = fixtureRoot();
  try {
    const lockDir = join(root, 'data', 'pipeline.md.lock');
    const timing = { timeoutMs: 100, retryMs: 10, deadline: Date.now() + 100 };

    for (const bad of ['in a bit', NaN, {}]) {
      assert.throws(
        () => createLockWaitPolicy(lockDir, { ...timing, hardDeadline: bad }),
        /hardDeadline/,
        `hardDeadline: ${String(bad)} must be refused — as a ceiling it silently becomes NaN, `
        + 'and a NaN backoff is a hot spin rather than an error anyone can see',
      );
    }

    // null is "nothing supplied", the same as omitting the key, so it takes the
    // policy default rather than throwing. Pinned because `??` is what draws
    // that line, and a later switch to `||` or a truthiness test would move it.
    const viaNull = createLockWaitPolicy(lockDir, { ...timing, hardDeadline: null });
    assert.ok(Number.isFinite(viaNull.backoffMs()), 'a null ceiling means "use the default", not NaN');

    // Infinity is a legitimate, explicit "no ceiling": acquirePipelineLock
    // passes it for maxWaitMs: Infinity. The check must not swallow it.
    const unbounded = createLockWaitPolicy(lockDir, { ...timing, hardDeadline: Infinity });
    assert.ok(unbounded.backoffMs() > 0, 'an unbounded ceiling still yields a real jittered retry');
    assert.equal(unbounded.ceilingReached(), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no lock module re-derives the wait ceiling — the policy holds the only copy (#3895)', () => {
  const policyModule = join(REPO_ROOT, 'pipeline-lock.mjs');
  const sources = collectMjsFiles(REPO_ROOT).filter((f) => f !== SELF && f !== policyModule);

  // A guard that cannot look must never pass: an empty or tiny scan means the
  // walk failed, not that the repository is clean.
  assert.ok(
    sources.length > 100,
    `only ${sources.length} .mjs files scanned — this guard could not inspect the tree`,
  );

  // Comments are stripped first: naming the parameter while explaining why it
  // is NOT passed is exactly what the three call sites now do, and a guard that
  // fires on prose gets silenced rather than obeyed.
  const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const offenders = sources
    .filter((f) => withoutComments(readFileSync(f, 'utf-8')).includes('hardDeadline'))
    .map((f) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, '/'));

  assert.deepEqual(
    offenders, [],
    'these modules name hardDeadline themselves, which means they are bounding the wait '
    + 'instead of letting createLockWaitPolicy do it — the duplicated invariant #3895 removed. '
    + 'A ceiling belongs to the policy; a copy of it stays correct only until someone edits one side',
  );
});
