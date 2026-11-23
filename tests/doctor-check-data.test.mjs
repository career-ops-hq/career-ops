// doctor --check-data composes the three read-only integrity checks a user
// needs after moving a data root: the tracker parses, every Report link
// resolves, and every report carries an archived JD (or a jds/ capture).
// It must never write, and it must exit non-zero on a hard problem.
//
// Run:  node --test tests/doctor-check-data.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'doctor.mjs');

// Every path and byte under the temp root, so a test can prove a run wrote
// nothing (or nothing changed). The walk is the repo's shared one: a local
// recursion would be rejected by tests/walk-tree.test.mjs.
function snapshot(root) {
  return listTree(root)
    .map((full) => `${relative(root, full).split(sep).join('/')}:${readFileSync(full).toString('base64')}`)
    .sort();
}

const HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];

const JD_REPORT = [
  '# Evaluation: Acme — Dev',
  '',
  '## Job Description (archived verbatim)',
  '',
  'Build things. Requirements: TypeScript, tests.',
  '',
].join('\n');

function makeRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'doctor-check-data-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function run(root, extraArgs = [], envOverrides = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--check-data', '--json', ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_PROFILE: '',
      ...envOverrides,
    },
  });
}

test('a healthy root passes and writes nothing', () => {
  const root = makeRoot({
    'reports/001-acme-2026-01-01.md': JD_REPORT,
    'data/applications.md': [
      ...HEADER,
      '| 1 | 2026-01-01 | Acme | Dev | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-01.md) | n |',
      '',
    ].join('\n'),
  });
  try {
    const before = snapshot(root);
    const r = run(root);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.tracker.rows, 1);
    assert.equal(out.tracker.hasReportColumn, true);
    assert.deepEqual(out.reportLinks.dead, []);
    assert.deepEqual(out.jdArchive.missing, []);
    assert.equal(out.jdArchive.reportsScanned, 1);
    assert.deepEqual(snapshot(root), before, 'the command is read-only');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dead Report link fails the check and is named by row', () => {
  const root = makeRoot({
    'data/applications.md': [
      ...HEADER,
      '| 2 | 2026-01-02 | Bravo | Dev | 4.0/5 | Evaluated | ❌ | [2](../reports/999-bravo-2026-01-02.md) | n |',
      '',
    ].join('\n'),
  });
  try {
    const r = run(root);
    assert.equal(r.status, 1, 'a dead report link is a hard failure');
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.reportLinks.dead.length, 1);
    assert.equal(out.reportLinks.dead[0].num, 2);
    assert.match(out.reportLinks.dead[0].link, /999-bravo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a report without an archived JD is reported (soft while its tracker row is live)', () => {
  const root = makeRoot({
    'reports/001-acme-2026-01-01.md': '# Evaluation: Acme — Dev\n\nNo JD section here.\n',
    'data/applications.md': [
      ...HEADER,
      '| 1 | 2026-01-01 | Acme | Dev | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-01.md) | n |',
      '',
    ].join('\n'),
  });
  try {
    const r = run(root);
    const out = JSON.parse(r.stdout);
    assert.equal(out.jdArchive.reportsScanned, 1);
    const named = [...out.jdArchive.missing, ...out.jdArchive.reviewDue];
    assert.equal(named.length, 1, 'the report is named even when the miss is soft');
    assert.equal(named[0].file, '001-acme-2026-01-01.md');
    assert.equal(r.status, 0, 'a live tracker row makes the missing archive a warning, not a blocker');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing tracker fails the check', () => {
  const root = makeRoot({ 'reports/.keep': '' });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.tracker.exists, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('a tracker that exists but cannot be read is reported, not thrown', () => {
  const root = makeRoot({ 'reports/.keep': '' });
  // A directory where the tracker file should be: existsSync is true and
  // readFileSync throws EISDIR, the same shape as a moved file with no permission.
  mkdirSync(join(root, 'data', 'applications.md'), { recursive: true });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.tracker.readable, false);
    assert.match(out.tracker.readError, /EISDIR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a file that is not a tracker is a hard problem, not an empty success', () => {
  const root = makeRoot({
    'data/applications.md': 'notes about the search\nnothing tabular here\n',
  });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.tracker.hasHeader, false);
    assert.match(out.tracker.schemaError, /no recognisable tracker table header/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a header-only tracker is a fresh tracker, not a broken one', () => {
  const root = makeRoot({ 'data/applications.md': [...HEADER, ''].join('\n') });
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.tracker.hasHeader, true);
    assert.equal(out.tracker.rows, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--target checks the named root, not the environment root', () => {
  const healthy = makeRoot({
    'reports/001-acme-2026-01-01.md': JD_REPORT,
    'data/applications.md': [
      ...HEADER,
      '| 1 | 2026-01-01 | Acme | Dev | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-01.md) | n |',
      '',
    ].join('\n'),
  });
  const other = makeRoot({ 'reports/.keep': '' });
  try {
    const r = run(healthy, ['--target', other]);
    assert.equal(r.status, 1, 'the named root has no tracker');
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.dataRoot, other);
    assert.equal(out.tracker.exists, false);
  } finally {
    rmSync(healthy, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('a tracker header without a Report column is a hard failure', () => {
  const root = makeRoot({
    'data/applications.md': [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status |',
      '|---|------|---------|------|-------|--------|',
      '| 1 | 2026-01-01 | Acme | Dev | 4.0/5 | Evaluated |',
      '',
    ].join('\n'),
  });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.tracker.hasReportColumn, false);
    assert.match(out.tracker.schemaError, /no Report column/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a numbered row the parser rejects fails the check instead of disappearing', () => {
  const root = makeRoot({
    'reports/001-acme-2026-01-01.md': JD_REPORT,
    'data/applications.md': [
      ...HEADER,
      '| 1 | 2026-01-01 | Acme | Dev | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-01.md) | n |',
      // Cut off before the Notes cell: a real application whose Report link
      // would otherwise never be inspected.
      '| 2 | 2026-01-02 | Bravo | Dev |',
      '',
    ].join('\n'),
  });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.tracker.rows, 1);
    assert.equal(out.tracker.malformedRows.length, 1);
    assert.equal(out.tracker.malformedRows[0].line, 6);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable reports path is a structured failure, not a crash', () => {
  const root = makeRoot({
    'data/applications.md': [
      ...HEADER,
      '| 1 | 2026-01-01 | Acme | Dev | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-01.md) | n |',
      '',
    ].join('\n'),
  });
  // Replace the reports directory makeRoot always creates with a regular file.
  rmSync(join(root, 'reports'), { recursive: true, force: true });
  writeFileSync(join(root, 'reports'), 'not a directory\n');
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.jdArchive.error.path.endsWith('reports'), true);
    assert.match(out.jdArchive.error.error, /ENOTDIR|EISDIR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a single link with text around it is still inspected', () => {
  const root = makeRoot({
    'data/applications.md': [
      ...HEADER,
      '| 3 | 2026-01-03 | Charlie | Dev | 4.0/5 | Evaluated | ❌ | [3](../reports/999-charlie-2026-01-03.md) (old) | n |',
      '',
    ].join('\n'),
  });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.reportLinks.dead.length, 1);
    assert.match(out.reportLinks.dead[0].link, /999-charlie/);
    assert.equal(out.reportLinks.ambiguous.length, 0, 'one link is not ambiguous, even with surrounding text');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a cell with two links stays a manual review item', () => {
  const root = makeRoot({
    'data/applications.md': [
      ...HEADER,
      '| 4 | 2026-01-04 | Delta | Dev | 4.0/5 | Evaluated | ❌ | [4](../reports/one.md) [5](../reports/two.md) | n |',
      '',
    ].join('\n'),
  });
  try {
    const r = run(root);
    const out = JSON.parse(r.stdout);
    assert.equal(out.reportLinks.ambiguous.length, 1);
    assert.equal(out.reportLinks.dead.length, 0, 'the command cannot tell which link the row means');
    assert.equal(r.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an inspection failure on a cell with surrounding text is preserved and fails the check', () => {
  // A NUL byte in the path makes stat throw ERR_INVALID_ARG_VALUE on every
  // platform, which is the same "could not inspect" class as EACCES. (A long
  // name would not do: on Windows it is ENOENT, so it reads as a plain dead
  // link.) The cell has text around its one link, so it travels through the
  // skipped branch, whose error has to survive into the result.
  const root = makeRoot({
    'data/applications.md': [
      ...HEADER,
      '| 5 | 2026-01-05 | Echo | Dev | 4.0/5 | Evaluated | ❌ | [5](../reports/bad\u0000name.md) (old) | n |',
      '',
    ].join('\n'),
  });
  try {
    const r = run(root);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.reportLinks.inspectionErrors.length, 1, 'the error from the skipped branch survives');
    assert.match(out.reportLinks.inspectionErrors[0].errors[0].error, /ERR_INVALID_ARG_VALUE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--target ignores CAREER_OPS_TRACKER; a plain run still honours it', () => {
  const named = makeRoot({ 'reports/.keep': '' }); // the named root has no tracker
  const elsewhere = makeRoot({
    'reports/001-acme-2026-01-01.md': JD_REPORT,
    'data/applications.md': [
      ...HEADER,
      '| 1 | 2026-01-01 | Acme | Dev | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme-2026-01-01.md) | n |',
      '',
    ].join('\n'),
  });
  const envTracker = join(elsewhere, 'data', 'applications.md');
  try {
    // The override points at a healthy tracker, but --target names `named`, so
    // reading the override would report another tree's health as this one's.
    const withTarget = run(named, ['--target', named], { CAREER_OPS_TRACKER: envTracker });
    assert.equal(withTarget.status, 1, 'the named root has no tracker of its own');
    const outTarget = JSON.parse(withTarget.stdout);
    assert.equal(outTarget.dataRoot, named);
    // The reported path is canonicalized, and on macOS /var is a symlink to
    // /private/var, so compare against the real path of the named root.
    assert.equal(outTarget.tracker.path, join(realpathSync(named), 'applications.md'));
    assert.equal(outTarget.tracker.exists, false);

    // No --target: the override keeps its normal meaning.
    const plain = run(elsewhere, [], { CAREER_OPS_TRACKER: envTracker });
    assert.equal(plain.status, 0, plain.stderr || plain.stdout);
    const outPlain = JSON.parse(plain.stdout);
    assert.equal(outPlain.tracker.exists, true);
    assert.equal(outPlain.tracker.rows, 1);
  } finally {
    rmSync(named, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
