// verify-pipeline.mjs took no flags seriously: anything but --no-hints was
// ignored and the whole run happened anyway. That is not a harmless default,
// because Check 8 deletes stale report-number sentinels, so `--help` deleted
// files, and a mistyped `--no-hint` ran the checks with hints on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OVERRIDES = ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_FOLLOWUPS', 'CAREER_OPS_REPORTS', 'CAREER_OPS_CV', 'CAREER_OPS_JDS', 'CAREER_OPS_ADDITIONS'];

function withStaleSentinel(fn) {
  const root = mkdtempSync(join(tmpdir(), 'verify-pipeline-flags-'));
  try {
    mkdirSync(join(root, 'reports'));
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '',
    ].join('\n'));
    const sentinel = join(root, 'reports', '042-RESERVED.md');
    writeFileSync(sentinel, 'reserved\n');
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    utimesSync(sentinel, longAgo, longAgo);
    const env = { ...process.env, CAREER_OPS_ROOT: root };
    for (const key of OVERRIDES) env[key] = '';
    fn(sentinel, (...args) => spawnSync(process.execPath, [join(ROOT, 'verify-pipeline.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 30000, env }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('premise: a plain run removes a stale sentinel', () => {
  withStaleSentinel((sentinel, run) => {
    run();
    assert.equal(existsSync(sentinel), false);
  });
});

for (const flag of ['--help', '-h']) {
  test(`${flag} prints usage and leaves the sentinel alone`, () => {
    withStaleSentinel((sentinel, run) => {
      const result = run(flag);
      assert.equal(result.status, 0, describeSpawn(result));
      assert.match(result.stdout, /Usage: node verify-pipeline\.mjs/);
      assert.doesNotMatch(result.stdout, /Removed stale reservation sentinel/);
      assert.equal(existsSync(sentinel), true, 'asking for help deleted a sentinel');
    });
  });
}

test('a mistyped flag is refused before anything is deleted', () => {
  withStaleSentinel((sentinel, run) => {
    const result = run('--no-hint');
    assert.ok(exitedNonZero(result), describeSpawn(result, 'expected a non-zero exit'));
    assert.match(result.stderr, /--no-hint/);
    assert.equal(existsSync(sentinel), true, 'a mistyped flag deleted a sentinel');
  });
});

test('--no-hints still runs the checks', () => {
  withStaleSentinel((sentinel, run) => {
    const result = run('--no-hints');
    assert.doesNotMatch(result.stderr, /unrecognized/i);
    assert.equal(existsSync(sentinel), false);
  });
});
