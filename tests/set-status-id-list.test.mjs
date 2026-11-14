// tests/set-status-id-list.test.mjs — `set-status 14,78 Applied` is a list of
// tracker numbers, not a company name. The CLI updates one row. A list must
// exit 1 and print one command per number, and it must not say the company
// was missing.
//
// Run: node --test tests/set-status-id-list.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 14 | 2026-10-01 | Fernhollow Labs | Data Analyst | 4.2/5 | Evaluated | ❌ | — | fixture |',
  '| 78 | 2026-10-02 | Quillfeather Labs | Designer | 3.5/5 | Evaluated | ❌ | — | fixture |',
  '| 3 | 2026-10-03 | Acme | Backend Engineer | 4.0/5 | Evaluated | ❌ | — | fixture |',
  '',
].join('\n');

function sandbox(body = TRACKER) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-set-status-list-'));
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, body);
  return {
    dir,
    tracker,
    lock: join(dir, 'career-ops-merge-tracker-test.lock'),
  };
}

function spawn(sb, args, { tracker = sb.tracker } = {}) {
  return spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: sb.dir,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: tracker,
      CAREER_OPS_TRACKER_DB: '',
      CAREER_OPS_TRACKER_LOCK: sb.lock,
    },
  });
}

describe('set-status rejects a list of tracker numbers', () => {
  test('14,78 Applied exits 1, names both commands, and does not write', () => {
    const sb = sandbox();
    try {
      const before = readFileSync(sb.tracker);
      const result = spawn(sb, ['14,78', 'Applied']);
      assert.equal(result.status, 1, result.stderr);
      assert.doesNotMatch(result.stderr, /company matching/);
      assert.match(result.stderr, /node set-status\.mjs --row 14 Applied/);
      assert.match(result.stderr, /node set-status\.mjs --row 78 Applied/);
      assert.equal(readFileSync(sb.tracker).equals(before), true);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('a space after the comma is the same list', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['14, 78', 'Applied', '--dry-run']);
      assert.equal(result.status, 1, result.stderr);
      assert.doesNotMatch(result.stderr, /company matching/);
      assert.match(result.stderr, /node set-status\.mjs --row 14 Applied/);
      assert.match(result.stderr, /node set-status\.mjs --row 78 Applied/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('an empty slot says the list is unfinished', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['14,', 'Applied']);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /empty slot/);
      assert.doesNotMatch(result.stderr, /company matching/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('--json reports code usage', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['14,78', 'Applied', '--json']);
      assert.equal(result.status, 1, result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.code, 'usage');
      assert.doesNotMatch(body.error, /company matching/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('a bad state is still reported before the list', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['14,78', 'NotAStatus']);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /not a canonical state/);
      assert.doesNotMatch(result.stderr, /one command per/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('a legal suffix is not treated as a list of ids', () => {
    const sb = sandbox();
    try {
      // "Acme, Inc." is a company name. It matches the Acme row once the
      // legal suffix is dropped, so the preview names that row.
      const result = spawn(sb, ['Acme, Inc.', 'Applied', '--dry-run']);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /one command per/);
      assert.match(result.stdout, /#3 Acme/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('one bare number still previews that row', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['14', 'Applied', '--dry-run']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /#14/);
      assert.match(result.stdout, /Fernhollow Labs/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('--undo names one --row command per tracker number', () => {
    const sb = sandbox();
    try {
      const result = spawn(sb, ['14,78', '--undo']);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /node set-status\.mjs --row 14 --undo/);
      assert.match(result.stderr, /node set-status\.mjs --row 78 --undo/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('the suggested command still selects a row whose report id differs', () => {
    const linked = TRACKER
      .replace('| 14 | 2026-10-01 | Fernhollow Labs | Data Analyst | 4.2/5 | Evaluated | ❌ | — | fixture |',
        '| 14 | 2026-10-01 | Fernhollow Labs | Data Analyst | 4.2/5 | Evaluated | ❌ | [99](reports/99-fernhollow.md) | fixture |')
      .replace('| 78 | 2026-10-02 | Quillfeather Labs | Designer | 3.5/5 | Evaluated | ❌ | — | fixture |',
        '| 78 | 2026-10-02 | Quillfeather Labs | Designer | 3.5/5 | Evaluated | ❌ | [100](reports/100-quillfeather.md) | fixture |');
    const sb = sandbox(linked);
    try {
      const listed = spawn(sb, ['14,78', 'Applied']);
      assert.equal(listed.status, 1, listed.stderr);
      assert.match(listed.stderr, /node set-status\.mjs --row 14 Applied/);
      assert.match(listed.stderr, /node set-status\.mjs --row 78 Applied/);
      const bare = spawn(sb, ['14', 'Applied', '--dry-run']);
      assert.ok(exitedNonZero(bare), describeSpawn(bare, 'a bare 14 should have been refused'));
      assert.match(bare.stderr, /report ID/);
      const explicit = spawn(sb, ['--row', '14', 'Applied', '--dry-run']);
      assert.equal(explicit.status, 0, explicit.stderr);
      assert.match(explicit.stdout, /Fernhollow Labs/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('a list is a usage error even when the tracker file is missing', () => {
    const sb = sandbox();
    try {
      const missing = join(sb.dir, 'missing.md');
      const result = spawn(sb, ['14,78', 'Applied'], { tracker: missing });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /one command per/);
      assert.doesNotMatch(result.stderr, /No tracker found/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });
});
