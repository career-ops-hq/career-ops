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
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { acquirePipelineLock, LockTimeoutError } from '../pipeline-lock.mjs';

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-pipeline-lock-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  return root;
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
      await assert.rejects(() => acquirePipelineLock(p, { timeoutMs: 150, retryMs: 20 }));
      const elapsed = Date.now() - startedAt;
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
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
      pid: 2147483000, // not a live pid
      token: 'crashed-holder-token',
      started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    }), 'utf-8');

    // Two concurrent acquirers both see the same stale lock. Exactly one must
    // win; the loser must NOT end up holding a lock at the same time.
    const [a, b] = await Promise.allSettled([
      acquirePipelineLock(p, { timeoutMs: 1000, retryMs: 15, staleMs: 1 }),
      acquirePipelineLock(p, { timeoutMs: 1000, retryMs: 15, staleMs: 1 }),
    ]);

    const winners = [a, b].filter((r) => r.status === 'fulfilled');
    assert.equal(winners.length, 1, 'exactly one acquirer may hold the reclaimed lock at a time');
    winners.forEach((w) => w.value.release());
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
