/**
 * livePdfIndex: a row in data/pdf-index.tsv records that a PDF was generated,
 * not that it still exists (#4777). This is the one place that decides which
 * rows are still backed by a file, so merge-tracker.mjs and sync-pdf-flags.mjs
 * cannot disagree about it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

import { livePdfIndex } from '../find.mjs';

// The workspace root follows CAREER_OPS_TRACKER, so a stray value from the
// environment would move the fixture's root out from under these tests.
function withoutTrackerEnv(fn) {
  const saved = process.env.CAREER_OPS_TRACKER;
  delete process.env.CAREER_OPS_TRACKER;
  try {
    return fn();
  } finally {
    if (saved !== undefined) process.env.CAREER_OPS_TRACKER = saved;
  }
}

function fixture(fn) {
  const parent = mkdtempSync(join(tmpdir(), 'live-pdf-index-'));
  try {
    const root = join(parent, 'repo');
    mkdirSync(join(root, 'output'), { recursive: true });
    return withoutTrackerEnv(() => fn({ parent, root }));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

const rows = (...pairs) => new Map(pairs);

test('a row whose file is on disk is kept', () => fixture(({ root }) => {
  writeFileSync(join(root, 'output', '1-acme-cv.pdf'), '%PDF-1.4\n');
  const warnings = [];
  const live = livePdfIndex(rows(['1', 'output/1-acme-cv.pdf']), root, (m) => warnings.push(m));
  assert.deepEqual([...live], [['1', 'output/1-acme-cv.pdf']]);
  assert.deepEqual(warnings, []);
}));

test('a row whose file is gone is dropped without a warning', () => fixture(({ root }) => {
  const warnings = [];
  const live = livePdfIndex(rows(['2', 'output/2-globex-cv.pdf']), root, (m) => warnings.push(m));
  assert.equal(live.size, 0);
  assert.deepEqual(warnings, [], 'a deleted file is the ordinary case, not news');
}));

test('a row that names a directory is dropped', () => fixture(({ root }) => {
  mkdirSync(join(root, 'output', 'folder.pdf'));
  const live = livePdfIndex(rows(['3', 'output/folder.pdf']), root, () => {});
  assert.equal(live.size, 0);
}));

test('only the dead rows are dropped, so one bad path does not fail the batch', () => fixture(({ root }) => {
  writeFileSync(join(root, 'output', '1-acme-cv.pdf'), '%PDF-1.4\n');
  const live = livePdfIndex(
    rows(['1', 'output/1-acme-cv.pdf'], ['2', 'output/2-gone.pdf'], ['3', 'output/1-acme-cv.pdf']),
    root,
    () => {},
  );
  assert.deepEqual([...live.keys()], ['1', '3']);
}));

test('a path that climbs out of the workspace is dropped and reported', () => fixture(({ parent, root }) => {
  const outside = join(parent, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'cv.pdf'), '%PDF-1.4\n');
  const warnings = [];
  const live = livePdfIndex(rows(['4', `../${basename(outside)}/cv.pdf`]), root, (m) => warnings.push(m));
  assert.equal(live.size, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /outside the workspace/);
}));

test('a path that spells its way out is reported whatever it points at, and is never statted', () => fixture(({ parent, root }) => {
  // A directory and a name that does not exist: neither is a file, so a check
  // that stats first drops them silently and never says they left the workspace.
  mkdirSync(join(parent, 'outside-dir'));
  const warnings = [];
  const live = livePdfIndex(
    rows(['4', '../outside-dir'], ['5', '../does-not-exist.pdf']),
    root,
    (m) => warnings.push(m),
  );
  assert.equal(live.size, 0);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((m) => /outside the workspace/.test(m)), warnings.join('\n'));
}));

test('a link inside the workspace that leads outside it is dropped and reported', () => fixture(({ parent, root }) => {
  const outside = join(parent, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'cv.pdf'), '%PDF-1.4\n');
  // A directory link, so the same fixture works on Windows with a junction.
  symlinkSync(outside, join(root, 'output', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const warnings = [];
  const live = livePdfIndex(rows(['5', 'output/linked/cv.pdf']), root, (m) => warnings.push(m));
  assert.equal(live.size, 0);
  assert.match(warnings.join('\n'), /outside the workspace/);
}));

test('a stat failure other than "not found" leaves the row out and says so', { skip: process.platform === 'win32' && 'a self-referential link needs symlink privilege on Windows' }, () => fixture(({ root }) => {
  // A link to itself fails stat with ELOOP, which is not the same as "absent":
  // presence is unknown, so no flag may be set from this row.
  symlinkSync('loop.pdf', join(root, 'output', 'loop.pdf'));
  writeFileSync(join(root, 'output', '1-acme-cv.pdf'), '%PDF-1.4\n');
  const warnings = [];
  const live = livePdfIndex(
    rows(['6', 'output/loop.pdf'], ['1', 'output/1-acme-cv.pdf']),
    root,
    (m) => warnings.push(m),
  );
  assert.deepEqual([...live.keys()], ['1'], 'the readable row still counts');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cannot tell/);
  assert.match(warnings[0], /ELOOP/);
}));

test('paths resolve against the workspace root generate-pdf wrote them for, even with data/ symlinked out', () => fixture(({ parent, root }) => {
  // The natural #524 workaround: only data/ lives elsewhere. Deriving the root
  // from the canonical tracker path would follow that link out of the repo and
  // look for output/ in the wrong place (#3169).
  const external = join(parent, 'external');
  mkdirSync(join(external, 'data'), { recursive: true });
  writeFileSync(join(external, 'data', 'applications.md'), '# tracker\n');
  symlinkSync(join(external, 'data'), join(root, 'data'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(root, 'output', '1-acme-cv.pdf'), '%PDF-1.4\n');
  const live = livePdfIndex(rows(['1', 'output/1-acme-cv.pdf']), root, () => {});
  assert.deepEqual([...live.keys()], ['1']);
}));

test('CAREER_OPS_TRACKER moves the workspace the paths resolve against', () => fixture(({ parent, root }) => {
  // generate-pdf.mjs writes into the workspace the tracker override names, so
  // that, not the script's own root, is where output/ has to be looked for.
  const external = join(parent, 'external');
  mkdirSync(join(external, 'data'), { recursive: true });
  mkdirSync(join(external, 'output'), { recursive: true });
  writeFileSync(join(external, 'data', 'applications.md'), '# tracker\n');
  writeFileSync(join(external, 'output', '1-acme-cv.pdf'), '%PDF-1.4\n');
  process.env.CAREER_OPS_TRACKER = join(external, 'data', 'applications.md');
  try {
    const live = livePdfIndex(rows(['1', 'output/1-acme-cv.pdf']), root, () => {});
    assert.deepEqual([...live.keys()], ['1']);
  } finally {
    delete process.env.CAREER_OPS_TRACKER;
  }
}));

test('a path through a file is a missing PDF, not a warning', () => fixture(({ root }) => {
  // stat reports ENOTDIR here rather than ENOENT; both mean there is no such file.
  writeFileSync(join(root, 'output', 'blocker'), 'not a directory\n');
  const warnings = [];
  const live = livePdfIndex(rows(['1', 'output/blocker/1-acme-cv.pdf']), root, (m) => warnings.push(m));
  assert.equal(live.size, 0);
  assert.deepEqual(warnings, []);
}));

test('a path with stray whitespace or a trailing CR still resolves', () => fixture(({ root }) => {
  writeFileSync(join(root, 'output', '1-acme-cv.pdf'), '%PDF-1.4\n');
  const live = livePdfIndex(rows(['1', ' output/1-acme-cv.pdf\r']), root, () => {});
  assert.deepEqual([...live.keys()], ['1']);
}));

test('an empty index stays empty', () => fixture(({ root }) => {
  assert.equal(livePdfIndex(new Map(), root, () => {}).size, 0);
}));
