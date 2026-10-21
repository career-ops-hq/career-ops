import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkJdArchive, mapTrackerCaptureLinks, findUnarchivedApplications } from '../check-jd-archive.mjs';

const header = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|';
for (const ext of ['pdf', 'txt', 'md']) {
  test(`the tracker's explicit ${ext} capture satisfies both archive checks`, () => {
    const root = mkdtempSync(join(tmpdir(), 'jd-linked-format-'));
    try {
      const reports = join(root, 'reports');
      const jds = join(root, 'jds');
      mkdirSync(reports);
      mkdirSync(jds);
      const filename = `freely-named-company-role.${ext}`;
      writeFileSync(join(jds, filename), ext === 'pdf' ? '%PDF-1.7 synthetic capture' : 'Synthetic job description.');
      writeFileSync(join(reports, '042-acme-2026-01-01.md'), '# Evaluation: Acme\n');
      const tracker = join(root, 'applications.md');
      writeFileSync(tracker, `${header}\n` +
        `| 42 | 2026-01-01 | Acme | Engineer | 8 | Applied | — | [42](reports/042-acme-2026-01-01.md) | [JD](jds/${filename}) |\n` +
        `| 43 | 2026-01-01 | Beta | Engineer | 8 | Applied | — | [JD](jds/${filename}) | — |\n` +
        `| 44 | 2026-01-01 | Missing | Engineer | 8 | Applied | — | [JD](jds/missing.${ext}) | — |\n`);
      const linked = mapTrackerCaptureLinks(tracker, jds);
      assert.equal(linked.get(42), join(jds, filename));
      assert.equal(linked.get(43), join(jds, filename));
      assert.ok(!linked.has(44));
      assert.deepEqual(checkJdArchive(reports, jds, { trackerPath: tracker }).findings, []);
      assert.deepEqual(findUnarchivedApplications(tracker, reports, jds).map(row => row.row), [44]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('a file outside the supported capture formats is not credited', () => {
  const root = mkdtempSync(join(tmpdir(), 'jd-linked-format-control-'));
  try {
    const jds = join(root, 'jds');
    mkdirSync(jds);
    writeFileSync(join(jds, 'capture.pdf.bak'), 'Backup, not a capture.');
    const tracker = join(root, 'applications.md');
    writeFileSync(tracker, `${header}\n| 42 | 2026-01-01 | Acme | Engineer | 8 | Applied | — | [JD](jds/capture.pdf.bak) | — |\n`);
    assert.equal(mapTrackerCaptureLinks(tracker, jds).size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const reference of [
  'see jds/capture.md.',
  'see jds/capture.pdf.',
  'see jds/capture.txt; archived locally',
  '[JD](<jds/capture.md>)',
  '[JD](<jds/capture.pdf>)',
  '[JD](<jds/capture.txt>)',
]) {
  test(`capture references keep prose and Markdown delimiters: ${reference}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'jd-capture-delimiter-'));
    try {
      const jds = join(root, 'jds');
      mkdirSync(jds);
      const filename = /capture\.(?:md|pdf|txt)/.exec(reference)[0];
      writeFileSync(join(jds, filename), 'Synthetic JD capture.');
      const tracker = join(root, 'applications.md');
      writeFileSync(tracker, `${header}\n| 42 | 2026-01-01 | Acme | Engineer | 8 | Applied | — | — | ${reference} |\n`);
      assert.equal(mapTrackerCaptureLinks(tracker, jds).get(42), join(jds, filename));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const filename of ['capture.pdf.bak', 'capture.md.backup']) {
  test(`unsupported suffix does not borrow an existing capture: ${filename}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'jd-capture-delimiter-control-'));
    try {
      const jds = join(root, 'jds');
      mkdirSync(jds);
      // A valid file with the supported prefix must exist too, so a regex
      // that truncates the backup suffix would visibly credit the wrong file.
      writeFileSync(join(jds, filename.replace(/\.(?:bak|backup)$/, '')), 'Synthetic valid capture.');
      writeFileSync(join(jds, filename), 'Backup, not a supported capture.');
      const tracker = join(root, 'applications.md');
      writeFileSync(tracker, `${header}\n| 42 | 2026-01-01 | Acme | Engineer | 8 | Applied | — | — | [JD](jds/${filename}) |\n`);
      assert.equal(mapTrackerCaptureLinks(tracker, jds).size, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const ext of ['md', 'pdf', 'txt']) {
  test(`a tracker link cannot credit an external ${ext} file through parent segments`, () => {
    const root = mkdtempSync(join(tmpdir(), 'jd-capture-parent-control-'));
    try {
      const workspace = join(root, 'workspace');
      const jds = join(workspace, 'jds');
      mkdirSync(jds, { recursive: true });
      const filename = `notes.${ext}`;
      writeFileSync(join(root, filename), 'External notes, not a JD archive.');
      // Even the same basename inside jds/ must not make a traversal link valid.
      writeFileSync(join(jds, filename), 'A different local capture.');
      const tracker = join(workspace, 'applications.md');
      writeFileSync(tracker, `${header}\n| 42 | 2026-01-01 | Acme | Engineer | 8 | Applied | — | [JD](jds/../../${filename}) | — |\n`);
      assert.equal(mapTrackerCaptureLinks(tracker, jds).size, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
