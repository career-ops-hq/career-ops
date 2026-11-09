import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStatusLog, foldObservations } from '../funnel-velocity.mjs';
import { loadCanonicalStates } from '../tracker-utils.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const states = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));

function sandbox(status = 'Evaluated', ledger = null) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-undo-'));
  mkdirSync(join(dir, 'data'));
  const tracker = join(dir, 'data', 'applications.md');
  writeFileSync(tracker, [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    `| 7 | 2026-02-01 | Acme | Backend Engineer | 4.4/5 | ${status} | ❌ | | |`, '',
  ].join('\n'));
  if (ledger) writeFileSync(join(dir, 'data', 'status-log.tsv'), ledger);
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_TRACKER: tracker },
  });
  const status7 = () => readFileSync(tracker, 'utf-8').split('\n').find(l => l.startsWith('| 7 |')).split('|')[6].trim();
  const logPath = join(dir, 'data', 'status-log.tsv');
  const log = () => (existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '');
  const timeline = () => (foldObservations(parseStatusLog(log(), states).observations).get(7) ?? []).map(o => o.to);
  return { dir, run, status7, log, timeline, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('undo reverts a mis-clicked Applied and retracts it from the ledger', () => {
  const s = sandbox();
  try {
    assert.equal(s.run('--row', '7', 'Applied').status, 0);
    assert.deepEqual(s.timeline(), ['Applied']);
    const r = s.run('--row', '7', '--undo');
    assert.equal(r.status, 0, describeSpawn(r));
    assert.equal(s.status7(), 'Evaluated');
    assert.deepEqual(s.timeline(), []);
    assert.match(r.stdout, /#7 Acme/);
  } finally { s.cleanup(); }
});

test('repeated undo walks back one logged change at a time', () => {
  const s = sandbox();
  try {
    s.run('--row', '7', 'Applied');
    s.run('--row', '7', 'Responded');
    assert.equal(s.run('--row', '7', '--undo').status, 0);
    assert.equal(s.status7(), 'Applied');
    assert.deepEqual(s.timeline(), ['Applied']);
    assert.equal(s.run('Acme', '--undo').status, 0);
    assert.equal(s.status7(), 'Evaluated');
    assert.deepEqual(s.timeline(), []);
  } finally { s.cleanup(); }
});

test('undo retracts a logged change whose prior status equals its new one', () => {
  const s = sandbox('Applied', '7\t2026-02-03\tEvaluated\tApplied\tset-status\t\n7\t2026-02-05\tApplied\tApplied\tweb\t\n');
  try {
    assert.equal(s.run('--row', '7', '--undo').status, 0);
    assert.equal(s.status7(), 'Applied');
    assert.equal(s.log().trimEnd().split('\n').length, 3);
    assert.equal(s.run('--row', '7', '--undo').status, 0);
    assert.equal(s.status7(), 'Evaluated');
    assert.deepEqual(s.timeline(), []);
  } finally { s.cleanup(); }
});

test('undo puts the status back when the retraction cannot be logged', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const s = sandbox('Applied', '7\t2026-02-03\tEvaluated\tApplied\tset-status\t\n');
  try {
    chmodSync(join(s.dir, 'data', 'status-log.tsv'), 0o444);
    const r = s.run('--row', '7', '--undo', '--json');
    assert.equal(r.status, 1, describeSpawn(r));
    assert.equal(JSON.parse(r.stdout).code, 'undo-not-logged');
    assert.equal(s.status7(), 'Applied');
  } finally {
    chmodSync(join(s.dir, 'data', 'status-log.tsv'), 0o644);
    s.cleanup();
  }
});

test('undo refuses when the tracker no longer matches the last logged change', () => {
  const s = sandbox('Interview', '7\t2026-02-03\tEvaluated\tApplied\tset-status\t\n');
  try {
    const before = s.log();
    const r = s.run('--row', '7', '--undo', '--json');
    assert.equal(r.status, 3, describeSpawn(r));
    assert.equal(JSON.parse(r.stdout).code, 'undo-stale');
    assert.equal(s.status7(), 'Interview');
    assert.equal(s.log(), before);
  } finally { s.cleanup(); }
});

test('undo with no logged change fails without writing', () => {
  const s = sandbox('Applied');
  try {
    const r = s.run('--row', '7', '--undo', '--json');
    assert.equal(r.status, 2, describeSpawn(r));
    assert.equal(JSON.parse(r.stdout).code, 'nothing-to-undo');
    assert.equal(s.status7(), 'Applied');
    assert.equal(s.log(), '');
  } finally { s.cleanup(); }
});

test('undo refuses a logged change with no known prior status', () => {
  const s = sandbox('Applied', '7\t2026-02-03\t-\tApplied\tbackfill\t\n');
  try {
    const r = s.run('--row', '7', '--undo', '--json');
    assert.equal(r.status, 1, describeSpawn(r));
    assert.equal(JSON.parse(r.stdout).code, 'undo-unknown-prior');
    assert.equal(s.status7(), 'Applied');
  } finally { s.cleanup(); }
});

test('undo --dry-run reports the revert and writes nothing', () => {
  const s = sandbox();
  try {
    s.run('--row', '7', 'Applied');
    const before = s.log();
    const r = s.run('--row', '7', '--undo', '--dry-run', '--json');
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.equal(out.oldStatus, 'Applied');
    assert.equal(out.newStatus, 'Evaluated');
    assert.equal(s.status7(), 'Applied');
    assert.equal(s.log(), before);
  } finally { s.cleanup(); }
});

test('undo takes no state argument', () => {
  const s = sandbox();
  try {
    const r = s.run('--row', '7', 'Applied', '--undo');
    assert.equal(r.status, 1, describeSpawn(r));
    assert.equal(s.status7(), 'Evaluated');
  } finally { s.cleanup(); }
});
