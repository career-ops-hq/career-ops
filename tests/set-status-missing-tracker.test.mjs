// A missing tracker used to name <data-root>/applications.md. That is the
// legacy read fallback. The first evaluation writes data/applications.md, so
// the error sent a new user to a file that will never appear.
//
// Run: node --test tests/set-status-missing-tracker.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-01-05 | Acme | Backend Engineer | 4.2/5 | Applied | ❌ | [1](../reports/001-acme.md) | n |',
  '',
].join('\n');

function run(dataRoot, args, extraEnv = {}) {
  const env = {
    ...process.env,
    CAREER_OPS_ROOT: dataRoot,
    CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_TRACKER: '',
    ...extraEnv,
  };
  delete env.FORCE_COLOR;
  const r = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env,
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function escaped(path) {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('a missing tracker names the canonical write path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-status-missing-'));
  try {
    const r = run(dir, ['1', 'Applied', '--dry-run']);
    const writePath = join(dir, 'data', 'applications.md');
    const legacy = join(dir, 'applications.md');
    assert.equal(r.status, 2, r.all);
    assert.match(r.all, new RegExp(escaped(writePath)));
    assert.doesNotMatch(r.all, new RegExp(`No tracker found at ${escaped(legacy)}(?:\\s|$)`));
    assert.match(r.all, /created when you evaluate your first offer/);
    assert.equal(existsSync(writePath), false, 'reporting the missing tracker must not create it');
    assert.equal(existsSync(legacy), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('an existing legacy tracker at the data root is still read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-status-legacy-'));
  try {
    writeFileSync(join(dir, 'applications.md'), TRACKER);
    const r = run(dir, ['1', 'Interview', '--dry-run']);
    assert.equal(r.status, 0, r.all);
    assert.doesNotMatch(r.all, /No tracker found/i);
    assert.equal(existsSync(join(dir, 'data', 'applications.md')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('CAREER_OPS_TRACKER still names the file when that override is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-status-env-'));
  const tracker = join(dir, 'custom-tracker.md');
  try {
    const r = run(dir, ['1', 'Applied', '--dry-run'], { CAREER_OPS_TRACKER: tracker });
    assert.equal(r.status, 2, r.all);
    assert.match(r.all, new RegExp(escaped(tracker)));
    assert.match(r.all, /created when you evaluate your first offer/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
