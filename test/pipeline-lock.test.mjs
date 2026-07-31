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
import { acquirePipelineLock, LockTimeoutError, OWNERLESS_GRACE_MS } from '../pipeline-lock.mjs';

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
