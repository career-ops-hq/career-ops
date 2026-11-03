// tests/set-status-legal-suffix.test.mjs — a company written with Inc or LLC
// is the same employer as the tracker row that omits that suffix.
// set-status used an exact normalizeCompany key, so the row was "not found"
// and nothing was written. The fallback is companiesMatchIgnoringCorporateForm,
// and only when the exact key matches nothing.
//
// Run: node --test tests/set-status-legal-suffix.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function table(rows) {
  return [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...rows,
    '',
  ].join('\n');
}

function sandbox(body) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-set-status-suffix-'));
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, body);
  return {
    dir,
    tracker,
    lock: join(dir, 'career-ops-merge-tracker-test.lock'),
  };
}

function spawn(sb, args) {
  return spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: sb.dir,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: sb.tracker,
      CAREER_OPS_TRACKER_DB: '',
      CAREER_OPS_TRACKER_LOCK: sb.lock,
    },
  });
}

const ONE = table([
  '| 1 | 2026-10-01 | Fernhollow Labs | Data Analyst | 4.2/5 | Evaluated | ❌ | — | fixture |',
  '| 2 | 2026-10-02 | Acme Robotics | Backend Engineer | 4.0/5 | Evaluated | ❌ | — | fixture |',
]);

const TWO = table([
  '| 1 | 2026-10-01 | Fernhollow Labs | Data Analyst | 4.2/5 | Evaluated | ❌ | — | fixture |',
  '| 2 | 2026-10-02 | Fernhollow Labs | Designer | 3.5/5 | Evaluated | ❌ | — | fixture |',
]);

describe('set-status matches a company across a legal suffix', () => {
  test('Fernhollow Labs LLC dry-run names the row and does not write', () => {
    const sb = sandbox(ONE);
    try {
      const before = readFileSync(sb.tracker);
      const result = spawn(sb, ['Fernhollow Labs LLC', 'Applied', '--dry-run']);
      assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
      assert.match(result.stdout, /Fernhollow Labs/);
      assert.match(result.stdout, /would set/);
      assert.equal(readFileSync(sb.tracker).equals(before), true);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('a comma before LLC is the same employer, and a real write changes status', () => {
    const sb = sandbox(ONE);
    try {
      const result = spawn(sb, ['Fernhollow Labs, LLC', 'Applied']);
      assert.equal(result.status, 0, result.stderr);
      const after = readFileSync(sb.tracker, 'utf-8');
      assert.match(after, /\| 1 \|.*\| Applied \|/);
      assert.match(after, /\| 2 \|.*\| Evaluated \|/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('a different employer that merely ends in LLC is not found and is not written', () => {
    const sb = sandbox(ONE);
    try {
      const before = readFileSync(sb.tracker);
      const result = spawn(sb, ['Other Labs LLC', 'Applied']);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /company matching/);
      assert.equal(readFileSync(sb.tracker).equals(before), true);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('Acme Inc. does not select Acme Robotics', () => {
    const sb = sandbox(ONE);
    try {
      const before = readFileSync(sb.tracker);
      const result = spawn(sb, ['Acme Inc.', 'Applied', '--dry-run']);
      assert.equal(result.status, 2, result.stderr);
      assert.doesNotMatch(result.stdout, /Acme Robotics/);
      assert.equal(readFileSync(sb.tracker).equals(before), true);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });

  test('two rows of the same employer are ambiguous until --role narrows them', () => {
    const sb = sandbox(TWO);
    try {
      const before = readFileSync(sb.tracker);
      const ambiguous = spawn(sb, ['Fernhollow Labs LLC', 'Applied']);
      assert.equal(ambiguous.status, 3, ambiguous.stderr);
      assert.match(ambiguous.stderr, /#1/);
      assert.match(ambiguous.stderr, /#2/);
      assert.equal(readFileSync(sb.tracker).equals(before), true);
      const narrowed = spawn(sb, ['Fernhollow Labs LLC', 'Applied', '--role', 'Designer']);
      assert.equal(narrowed.status, 0, narrowed.stderr);
      const after = readFileSync(sb.tracker, 'utf-8');
      assert.match(after, /\| 2 \|.*\| Applied \|/);
      assert.match(after, /\| 1 \|.*\| Evaluated \|/);
    } finally {
      rmSync(sb.dir, { recursive: true, force: true });
    }
  });
});
