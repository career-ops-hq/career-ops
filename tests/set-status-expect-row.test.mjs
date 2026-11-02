// tests/set-status-expect-row.test.mjs — the row-scoped review guards (#5536).
//
// reply-watch shows a row, asks the user, then hands the write to set-status.
// --expect-row and --expect-status let set-status check, under its lock, that
// the row it writes is still the one that was shown. Unlike --expect-tracker
// they look at that row only, so a write to another row in the meantime does
// not void the user's answer.
//
// Run:  node --test tests/set-status-expect-row.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, rmSync } from './helpers.mjs';
import { resolveColumns, parseTrackerRow, trackerRowIdentity } from '../tracker-parse.mjs';

const SCRIPT = join(ROOT, 'set-status.mjs');
const HEADER = [
  '# Applications',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
];
const ROW_1 = '| 1 | 2026-09-01 | Example Labs | Backend Engineer | 4/5 | Applied | - | - | résumé reviewed |';
const ROW_2 = '| 2 | 2026-09-01 | Sample Systems | Data Engineer | 4/5 | Applied | - | - | - |';
const tracker = rows => [...HEADER, ...rows, ''].join('\n');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-expect-row-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  mkdirSync(data);
  const file = join(data, 'applications.md');
  writeFileSync(file, tracker([ROW_1, ROW_2]));
  return {
    root, data, file,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: file },
  };
}

// The identity the reviewer would have computed from the row it showed.
function identityOf(line) {
  const lines = tracker([line]).split('\n');
  return trackerRowIdentity(parseTrackerRow(line, resolveColumns(lines)));
}

function run(f, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--json'], {
    cwd: f.root, env: f.env, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(r.error, undefined, r.error?.message);
  return { ...r, json: JSON.parse(r.stdout) };
}

test('the reviewed row and status are written, with the ledger row', (t) => {
  const f = fixture(t);
  const r = run(f, '--row', '1', 'Interview', '--expect-row', identityOf(ROW_1), '--expect-status', 'Applied');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.changed, true);
  assert.match(readFileSync(f.file, 'utf8'), /\| 1 \|.+\| Interview \|/);
  assert.match(readFileSync(join(f.data, 'status-log.tsv'), 'utf8'), /^1\t\d{4}-\d{2}-\d{2}\tApplied\tInterview\tset-status\t$/m);
});

test('a write to another row in the meantime does not void the review', (t) => {
  const f = fixture(t);
  writeFileSync(f.file, tracker([ROW_1, ROW_2.replace(/\| - \|$/, '| other note |')]));
  const r = run(f, '--row', '1', 'Interview', '--expect-row', identityOf(ROW_1), '--expect-status', 'Applied');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.changed, true);
});

test('an edited row is refused, even when it already carries the new status', (t) => {
  const f = fixture(t);
  for (const edited of [
    ROW_1.replace('résumé reviewed', 'concurrent note'),
    ROW_1.replace('Example Labs', 'Other Employer').replace('| Applied |', '| Interview |'),
  ]) {
    writeFileSync(f.file, tracker([edited, ROW_2]));
    const r = run(f, '--row', '1', 'Interview', '--expect-row', identityOf(ROW_1), '--expect-status', 'Applied');
    assert.equal(r.status, 3, r.stderr);
    assert.equal(r.json.code, 'row-changed');
    assert.equal(readFileSync(f.file, 'utf8'), tracker([edited, ROW_2]), 'the tracker must not change');
    assert.equal(existsSync(join(f.data, 'status-log.tsv')), false, 'no ledger row for a refused write');
  }
});

test('a status changed since review is refused and named', (t) => {
  const f = fixture(t);
  const moved = ROW_1.replace('| Applied |', '| Rejected |');
  writeFileSync(f.file, tracker([moved, ROW_2]));
  const r = run(f, '--row', '1', 'Interview', '--expect-row', identityOf(ROW_1), '--expect-status', 'Applied');
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.json.code, 'status-changed');
  assert.equal(r.json.currentStatus, 'Rejected');
  assert.equal(readFileSync(f.file, 'utf8'), tracker([moved, ROW_2]));
});

test('a row already at the new status is a no-op, not a status conflict', (t) => {
  const f = fixture(t);
  const current = ROW_1.replace('| Applied |', '| Interview |');
  writeFileSync(f.file, tracker([current, ROW_2]));
  const r = run(f, '--row', '1', 'Interview', '--expect-row', identityOf(ROW_1), '--expect-status', 'Applied');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.changed, false);
});

test('a row already at the new status under an alias is not a status conflict either', (t) => {
  const f = fixture(t);
  writeFileSync(f.file, tracker([ROW_1.replace('| Applied |', '| interview |'), ROW_2]));
  const r = run(f, '--row', '1', 'Interview', '--expect-row', identityOf(ROW_1), '--expect-status', 'Applied');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(f.file, 'utf8'), /\| 1 \|.+\| Interview \|/);
});

test('an alias of the expected status still matches, and a malformed hash is a usage error', (t) => {
  const f = fixture(t);
  const r = run(f, '--row', '1', 'Interview', '--expect-row', identityOf(ROW_1), '--expect-status', 'applied');
  assert.equal(r.status, 0, r.stderr);
  const bad = spawnSync(process.execPath, [SCRIPT, '--row', '2', 'Interview', '--expect-row', 'abc'], {
    cwd: f.root, env: f.env, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--expect-row expects a lowercase SHA-256 hash/);
});
