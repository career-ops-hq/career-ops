// tests/session-activity.test.mjs — advisory in-progress claims for concurrent
// sessions (#4532), mirroring reserve-report-num.mjs's own test conventions.
//
// This module never blocks or throws on collision (see session-activity.mjs's
// header) — it only answers honestly so a caller can warn instead of silently
// duplicating another session's work. These tests exercise the module
// directly (no CLI spawn needed, unlike reserve-report-num's --help test)
// since the exported functions are the whole contract.
//
// Run:  node --test tests/session-activity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  checkActivity, claimActivity, releaseActivity, gcStaleActivity, describeActiveOwner,
} from '../session-activity.mjs';

// Every test gets its own scratch dir passed as `activityDir`, so nothing here
// ever touches the real repo's .career-ops-locks/.
function sandbox() {
  return mkdtempSync(join(tmpdir(), 'session-activity-'));
}

function sentinelPathFor(activityDir, key) {
  const hash = createHash('sha1').update(String(key)).digest('hex');
  return join(activityDir, `${hash}.json`);
}

function exitedProcessPid() {
  const child = spawnSync(process.execPath, ['-e', '']);
  assert.equal(child.status, 0);
  assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0);
  return child.pid;
}

test('claimActivity succeeds when nothing is claimed, returning a token', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const result = claimActivity('report:042', { activityDir });
    assert.equal(result.claimed, true);
    assert.equal(typeof result.token, 'string');
    assert.ok(result.token.length > 0);
    assert.equal(result.owner.key, 'report:042');
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('a second claim on the same live key is refused, advisory not a throw', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const first = claimActivity('report:042', { activityDir, label: 'first session' });
    assert.equal(first.claimed, true);

    const second = claimActivity('report:042', { activityDir, label: 'second session' });
    assert.equal(second.claimed, false);
    assert.equal(second.token, null);
    assert.equal(second.owner.token, first.token);
    assert.equal(second.owner.label, 'first session');
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('checkActivity reflects an active claim without consuming or altering it', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const claim = claimActivity('report:042', { activityDir });
    assert.equal(claim.claimed, true);

    const check1 = checkActivity('report:042', { activityDir });
    assert.equal(check1.active, true);
    assert.equal(check1.owner.token, claim.token);

    // Calling check again must not have released or otherwise mutated it.
    const check2 = checkActivity('report:042', { activityDir });
    assert.equal(check2.active, true);
    assert.equal(check2.owner.token, claim.token);

    // A key that was never claimed reads as inactive.
    const untouched = checkActivity('report:999', { activityDir });
    assert.equal(untouched.active, false);
    assert.equal(untouched.owner, null);
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('releaseActivity with the correct token frees the key for reclaiming', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const claim = claimActivity('report:042', { activityDir });
    assert.equal(claim.claimed, true);

    const released = releaseActivity('report:042', { activityDir, token: claim.token });
    assert.equal(released, true);

    const reclaim = claimActivity('report:042', { activityDir });
    assert.equal(reclaim.claimed, true);
    assert.notEqual(reclaim.token, claim.token);
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('releaseActivity with a wrong or missing token does not release someone else\'s claim', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const claim = claimActivity('report:042', { activityDir });
    assert.equal(claim.claimed, true);

    const wrongToken = releaseActivity('report:042', { activityDir, token: 'not-the-real-token' });
    assert.equal(wrongToken, false);

    // Still active — the wrong-token release must not have touched it.
    assert.equal(checkActivity('report:042', { activityDir }).active, true);

    // No token and no force is a programmer error, not a silent no-op.
    assert.throws(() => releaseActivity('report:042', { activityDir }));

    // Still active after the throw too.
    assert.equal(checkActivity('report:042', { activityDir }).active, true);
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('a stale claim (dead pid) is not active, and can be reclaimed', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    // A PID vanishingly unlikely to be alive on any real machine. isStale()
    // only skips the age check when the recorded pid IS alive, so a dead pid
    // alone still needs an expired TTL. Age the file explicitly so filesystem
    // timestamp precision cannot leave a freshly-written sentinel unexpired.
    const deadPid = 999_999_999;
    const path = sentinelPathFor(activityDir, 'report:042');
    writeFileSync(path, JSON.stringify({
      key: 'report:042',
      token: 'stale-token',
      pid: deadPid,
      label: null,
      claimed_at: new Date().toISOString(),
    }));

    const staleTime = new Date(Date.now() - 60_000);
    utimesSync(path, staleTime, staleTime);

    const check = checkActivity('report:042', { activityDir, ttlMs: 1_000 });
    assert.equal(check.active, false);
    assert.equal(check.owner, null);

    const reclaim = claimActivity('report:042', { activityDir, ttlMs: 1_000 });
    assert.equal(reclaim.claimed, true);
    assert.notEqual(reclaim.token, 'stale-token');
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('a fresh CLI claim survives its creator PID exiting until TTL expiry', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const deadPid = exitedProcessPid();
    const path = sentinelPathFor(activityDir, 'report:cli');
    writeFileSync(path, JSON.stringify({
      key: 'report:cli',
      token: 'cli-token',
      pid: deadPid,
      process_bound: false,
      label: null,
      claimed_at: new Date().toISOString(),
    }));

    const check = checkActivity('report:cli', { activityDir, ttlMs: 60_000 });
    assert.equal(check.active, true);
    assert.equal(check.owner.token, 'cli-token');
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('a process-bound claim expires immediately when its PID is confirmed dead', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const deadPid = exitedProcessPid();
    const path = sentinelPathFor(activityDir, 'report:process');
    writeFileSync(path, JSON.stringify({
      key: 'report:process',
      token: 'process-token',
      pid: deadPid,
      process_bound: true,
      label: null,
      claimed_at: new Date().toISOString(),
    }));

    assert.equal(checkActivity('report:process', { activityDir, ttlMs: 60_000 }).active, false);
    assert.equal(claimActivity('report:process', { activityDir, ttlMs: 60_000 }).claimed, true);
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('claimActivity persists whether a claim is process-bound', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const ordinary = claimActivity('report:ordinary', { activityDir });
    const bound = claimActivity('report:bound', { activityDir, processBound: true });
    assert.equal(ordinary.owner.process_bound, false);
    assert.equal(bound.owner.process_bound, true);
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('a claim past its TTL (no live pid recorded) is not active, and can be reclaimed', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const path = sentinelPathFor(activityDir, 'report:042');
    // No pid at all — isStale() falls straight to the age check. Set an old
    // mtime rather than relying on a fresh file and a negative TTL.
    writeFileSync(path, JSON.stringify({
      key: 'report:042',
      token: 'stale-token',
      pid: null,
      label: null,
      claimed_at: new Date().toISOString(),
    }));

    const staleTime = new Date(Date.now() - 60_000);
    utimesSync(path, staleTime, staleTime);

    const check = checkActivity('report:042', { activityDir, ttlMs: 1_000 });
    assert.equal(check.active, false);

    const reclaim = claimActivity('report:042', { activityDir, ttlMs: 1_000 });
    assert.equal(reclaim.claimed, true);
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('a live PID does not keep an advisory claim active past its TTL', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const path = sentinelPathFor(activityDir, 'report:reused-pid');
    writeFileSync(path, JSON.stringify({
      key: 'report:reused-pid',
      token: 'old-token',
      pid: process.pid, // A live process stands in for an unrelated PID reuse.
      process_bound: false,
      label: null,
      claimed_at: new Date(Date.now() - 60_000).toISOString(),
    }));
    const staleTime = new Date(Date.now() - 60_000);
    utimesSync(path, staleTime, staleTime);

    assert.equal(checkActivity('report:reused-pid', { activityDir, ttlMs: 1_000 }).active, false);
    const reclaim = claimActivity('report:reused-pid', { activityDir, ttlMs: 1_000 });
    assert.equal(reclaim.claimed, true);
    assert.notEqual(reclaim.token, 'old-token');
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('a live PID keeps an advisory claim active within its TTL', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const claim = claimActivity('report:live-within-ttl', { activityDir, ttlMs: 60_000 });
    assert.equal(claim.claimed, true);
    const check = checkActivity('report:live-within-ttl', { activityDir, ttlMs: 60_000 });
    assert.equal(check.active, true);
    assert.equal(check.owner.token, claim.token);
    assert.equal(claimActivity('report:live-within-ttl', { activityDir, ttlMs: 60_000 }).claimed, false);
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('gcStaleActivity removes TTL-expired live-PID and dead claims but keeps a fresh live claim', () => {
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    // Fresh live claim: this process stays within TTL and must be retained.
    const live = claimActivity('report:live', { activityDir, ttlMs: 1_000 });
    assert.equal(live.claimed, true);

    // These are both old enough to expire: one has a live (reused) PID and
    // one has a dead PID. This covers GC's age-ceiling and dead-owner paths.
    for (const [key, pid] of [['report:reused', process.pid], ['report:dead', 999_999_999]]) {
      const path = sentinelPathFor(activityDir, key);
      writeFileSync(path, JSON.stringify({
        key,
        token: `${key}-token`,
        pid,
        process_bound: false,
        label: null,
        claimed_at: new Date(Date.now() - 60_000).toISOString(),
      }));
      const staleTime = new Date(Date.now() - 60_000);
      utimesSync(path, staleTime, staleTime);
    }

    const removed = gcStaleActivity({ activityDir, ttlMs: 1_000 });
    assert.equal(removed, 2);

    const remaining = readdirSync(activityDir).filter((f) => f.endsWith('.json'));
    assert.equal(remaining.length, 1);
    const survivor = JSON.parse(readFileSync(join(activityDir, remaining[0]), 'utf-8'));
    assert.equal(survivor.key, 'report:live');
  } finally {
    rmSync(activityDir, { recursive: true, force: true });
  }
});

test('describeActiveOwner renders a human-readable advisory line, or null for no owner', () => {
  assert.equal(describeActiveOwner(null), null);
  const msg = describeActiveOwner({ key: 'report:042', label: 'triage', claimed_at: new Date().toISOString() });
  assert.match(msg, /report:042/);
  assert.match(msg, /triage/);
});
