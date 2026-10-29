// tests/tracker-history-positional.test.mjs — `tracker.mjs history 1` is the
// same read as `history --id 1`. find.mjs and set-status.mjs already take a
// bare tracker number. history ignored that token and exited 1.
//
// Run: node --test tests/tracker-history-positional.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-10-01 | Fernhollow Labs | Data Analyst | 4.2/5 | Evaluated | ❌ | — | fixture |',
  '',
].join('\n');

let sqlite = true;
try {
  await import('node:sqlite');
} catch {
  sqlite = false;
}
const SQLITE = { skip: sqlite ? false : 'node:sqlite unavailable' };

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-history-positional-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  const tracker = join(dir, 'data', 'applications.md');
  writeFileSync(tracker, TRACKER);
  return { dir, tracker };
}

function spawn(sb, args) {
  return spawnSync(process.execPath, [join(ROOT, 'tracker.mjs'), ...args], {
    cwd: sb.dir,
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: sb.dir,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_TRACKER_DB: '',
    },
  });
}

describe('tracker.mjs history accepts one bare tracker number', SQLITE, () => {
  test('history 1 prints the same history as history --id 1 and does not write', () => {
    const sb = sandbox();
    try {
      const before = readFileSync(sb.tracker);
      const flagged = spawn(sb, ['history', '--id', '1']);
      const bare = spawn(sb, ['history', '1']);
      assert.equal(flagged.status, 0, flagged.stderr);
      assert.equal(bare.status, 0, `${bare.stderr}\n${bare.stdout}`);
      assert.equal(bare.stdout, flagged.stdout);
      assert.match(bare.stdout, /#1 Fernhollow Labs/);
      assert.match(bare.stdout, /Evaluated/);
      assert.equal(readFileSync(sb.tracker).equals(before), true);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('history --id=1 is the same read', () => {
    const sb = sandbox();
    try {
      const flagged = spawn(sb, ['history', '--id', '1']);
      const equals = spawn(sb, ['history', '--id=1']);
      assert.equal(flagged.status, 0, flagged.stderr);
      assert.equal(equals.status, 0, equals.stderr);
      assert.equal(equals.stdout, flagged.stdout);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('a missing bare id names that number', () => {
    const sb = sandbox();
    try {
      const missing = spawn(sb, ['history', '999']);
      assert.equal(missing.status, 1, missing.stdout);
      assert.match(missing.stderr, /no application with id 999/);
      assert.doesNotMatch(missing.stderr, /history requires --id/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('no number still says history requires --id N', () => {
    const sb = sandbox();
    try {
      const missing = spawn(sb, ['history']);
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /history requires --id N \(a positive integer\)/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('a non-numeric token is quoted in that same error', () => {
    const sb = sandbox();
    try {
      const bad = spawn(sb, ['history', 'foo']);
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /history requires --id N \(a positive integer\)/);
      assert.match(bad.stderr, /Got "foo"/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('two tokens are a usage error and do not print a row', () => {
    const sb = sandbox();
    try {
      const both = spawn(sb, ['history', '1', 'extra']);
      assert.equal(both.status, 1);
      assert.match(both.stderr, /one tracker number/);
      assert.doesNotMatch(both.stdout, /Fernhollow Labs/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('a number beside --id is a usage error', () => {
    const sb = sandbox();
    try {
      const both = spawn(sb, ['history', '1', '--id', '1']);
      assert.equal(both.status, 1);
      assert.match(both.stderr, /not both/);
      assert.doesNotMatch(both.stdout, /Fernhollow Labs/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('zero is not a tracker number', () => {
    const sb = sandbox();
    try {
      const zero = spawn(sb, ['history', '0']);
      assert.equal(zero.status, 1);
      assert.match(zero.stderr, /history requires --id N \(a positive integer\)/);
      assert.match(zero.stderr, /Got "0"/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });
});
