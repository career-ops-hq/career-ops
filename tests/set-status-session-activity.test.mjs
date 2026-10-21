// tests/set-status-session-activity.test.mjs — advisory in-progress claim
// wired into set-status.mjs, the canonical tracker-row writer (#4532).
//
// session-activity.mjs is deliberately never a hard lock (see its own header
// and reserve-report-num.mjs, the sentinel pattern it mirrors): a status
// change must succeed whether or not another session already claimed the
// same row, and a collision only ever produces a console.warn advisory line,
// never a different exit code or JSON shape. These tests prove exactly that
// — a normal run claims and releases cleanly, and a pre-existing claim on the
// same key changes nothing about the outcome except the warning.
//
// Every claim lives under CAREER_OPS_ACTIVITY_DIR pointed at a per-test temp
// dir, so nothing here ever touches the real repo's .career-ops-locks/.
//
// Run:  node --test tests/set-status-session-activity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimActivity } from '../session-activity.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';

function sandbox({ status = 'Evaluated', reportCell = '[7](../reports/007-acme-2026-02-01.md)' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-session-activity-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker', '', HEADER, SEP,
    `| 7 | 2026-02-01 | Acme | Backend Engineer | 4.4/5 | ${status} | ✅ | ${reportCell} | notes |`,
    '',
  ].join('\n'));
  return dir;
}

function setStatus(dir, args, { activityDir } = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: {
      ...process.env,
      CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
      ...(activityDir ? { CAREER_OPS_ACTIVITY_DIR: activityDir } : {}),
    },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const jsonOf = (r) => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
const cleanup = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 10 }));

test('a normal status change claims and releases cleanly (no pre-existing claim)', () => {
  const dir = sandbox();
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Applied', '--json'], { activityDir }));
    assert.equal(r.changed, true);
    assert.equal(r.newStatus, 'Applied');
    // The claim taken during the run must be released by the time the
    // process exits — no leftover sentinel to leak into a later run.
    const sentinels = readdirSync(activityDir).filter((f) => f.endsWith('.json'));
    assert.deepEqual(sentinels, [], 'claim must be released after the status change finishes');
  } finally { cleanup(dir, activityDir); }
});

test('an existing claim on the same report does not block the status change (advisory only)', () => {
  const dir = sandbox();
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    // Simulate another (still "live", since it is this same test process)
    // session already claiming report #7 before set-status.mjs runs.
    const preExisting = claimActivity('report:7', { activityDir, label: 'another session' });
    assert.equal(preExisting.claimed, true);

    const result = setStatus(dir, ['--row', '7', 'Applied', '--json'], { activityDir });
    const r = jsonOf(result);

    // The status change must still fully succeed — advisory, not a lock.
    assert.equal(r.changed, true);
    assert.equal(r.newStatus, 'Applied');

    // And the collision must have been surfaced somewhere observable.
    assert.match(result.stderr, /another session appears to already be active/);
    assert.match(result.stderr, /report:7/);

    // The pre-existing claim (owned by THIS test, not by set-status.mjs) must
    // still be there afterward — set-status.mjs must never release a claim
    // it does not own.
    const sentinels = readdirSync(activityDir).filter((f) => f.endsWith('.json'));
    assert.equal(sentinels.length, 1);
  } finally { cleanup(dir, activityDir); }
});

test('--dry-run claims nothing', () => {
  const dir = sandbox();
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Applied', '--dry-run', '--json'], { activityDir }));
    assert.equal(r.dryRun, true);
    const sentinels = readdirSync(activityDir).filter((f) => f.endsWith('.json'));
    assert.deepEqual(sentinels, [], '--dry-run must never claim, so nothing is left to release either');
  } finally { cleanup(dir, activityDir); }
});

test('a row with no report number falls back to a company+role key', () => {
  const dir = sandbox({ reportCell: '—' });
  const activityDir = mkdtempSync(join(tmpdir(), 'session-activity-'));
  try {
    const preExisting = claimActivity('tracker-row:acme|Backend Engineer', { activityDir });
    assert.equal(preExisting.claimed, true);

    const result = setStatus(dir, ['--row', '7', 'Applied', '--json'], { activityDir });
    const r = jsonOf(result);
    assert.equal(r.changed, true);
    assert.match(result.stderr, /another session appears to already be active/);
  } finally { cleanup(dir, activityDir); }
});
