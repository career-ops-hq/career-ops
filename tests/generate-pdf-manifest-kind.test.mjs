// tests/generate-pdf-manifest-kind.test.mjs — a report's CV and cover letter
// must both survive in data/pdf-index.tsv (#3967). updatePDFManifest() used to
// dedupe by report number alone, so generating the cover letter for a report
// silently dropped that report's CV row (and vice versa).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { updatePDFManifest } from '../generate-pdf.mjs';

// Rows for a given report, as [report, kind] pairs (skips the header/comment).
function rowsFor(manifestPath, reportNum) {
  return readFileSync(manifestPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split('\t'))
    .filter((f) => f[0] === reportNum)
    .map((f) => ({ pdf: f[1], kind: (f[5] || '').trim() || 'cv' }));
}

function withManifest(body) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-pdf-manifest-'));
  const manifestPath = join(dir, 'pdf-index.tsv');
  const oldEnv = process.env.CAREER_OPS_PDF_INDEX;
  process.env.CAREER_OPS_PDF_INDEX = manifestPath;
  try {
    return body(manifestPath);
  } finally {
    if (oldEnv === undefined) delete process.env.CAREER_OPS_PDF_INDEX;
    else process.env.CAREER_OPS_PDF_INDEX = oldEnv;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a cover letter does not drop the report's CV row (#3967)", () => {
  withManifest((manifestPath) => {
    updatePDFManifest('052', 'output/052-cv.pdf', 'output/052-cv.html', 'letter', 'cv');
    updatePDFManifest('052', 'output/052-cover.pdf', '', 'letter', 'cover');

    const rows = rowsFor(manifestPath, '052');
    assert.equal(rows.length, 2, 'both the CV and cover-letter rows should remain');
    assert.equal(rows.filter((r) => r.kind === 'cv').length, 1, 'the CV row survives');
    assert.equal(rows.filter((r) => r.kind === 'cover').length, 1, 'the cover-letter row is added');
  });
});

test('regenerating the same kind still replaces its own stale row', () => {
  withManifest((manifestPath) => {
    updatePDFManifest('052', 'output/052-cv.pdf', 'output/052-cv.html', 'letter', 'cv');
    updatePDFManifest('052', 'output/052-cover.pdf', '', 'letter', 'cover');
    // Regenerate the cover letter to a different path: its old row is superseded,
    // the CV row is untouched.
    updatePDFManifest('052', 'output/052-cover-v2.pdf', '', 'letter', 'cover');

    const rows = rowsFor(manifestPath, '052');
    assert.equal(rows.filter((r) => r.kind === 'cover').length, 1, 'only one cover-letter row');
    assert.equal(rows.find((r) => r.kind === 'cover').pdf, 'output/052-cover-v2.pdf');
    assert.equal(rows.filter((r) => r.kind === 'cv').length, 1, 'the CV row is untouched');
  });
});

test('a legacy row with no kind column reads as cv and is preserved by a cover write', () => {
  withManifest((manifestPath) => {
    // A pre-existing 5-column row written before the kind column existed.
    writeFileSync(
      manifestPath,
      '# report\tpdf\thtml\tformat\tdate\n099\toutput/099-cv.pdf\toutput/099-cv.html\tletter\t2026-01-01\n',
    );
    updatePDFManifest('099', 'output/099-cover.pdf', '', 'letter', 'cover');

    const rows = rowsFor(manifestPath, '099');
    assert.equal(rows.length, 2, 'the legacy CV row survives alongside the new cover row');
    assert.equal(rows.filter((r) => r.kind === 'cv').length, 1);
    assert.equal(rows.filter((r) => r.kind === 'cover').length, 1);
  });
});
