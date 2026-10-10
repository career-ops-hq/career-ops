// tests/present-pdf-reports.test.mjs — presentPdfReports() counts a report only
// when its CV row names a regular file inside output/ (#4777).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { presentPdfReports } from '../tracker-utils.mjs';

test('presentPdfReports counts only CV rows that are regular files inside output/ (#4777)', () => {
  const work = mkdtempSync(join(tmpdir(), 'career-ops-present-pdf-'));
  try {
    mkdirSync(join(work, 'output', 'nested'), { recursive: true });
    writeFileSync(join(work, 'output', '1-cv.pdf'), 'pdf');
    writeFileSync(join(work, 'output', '3-cover.pdf'), 'pdf');
    writeFileSync(join(work, 'outside.pdf'), 'pdf');
    const manifest = [
      '# report\tpdf\thtml\tformat\tdate\tkind',
      '001\toutput/1-cv.pdf\t\ta4\t2026-01-01\tcv',        // regular file: present
      '2\toutput/2-cv.pdf\t\ta4\t2026-01-02\tcv',          // missing file
      '3\toutput/3-cover.pdf\t\ta4\t2026-01-03\tcover',    // cover letter, not a CV
      '4\toutput/../outside.pdf\t\ta4\t2026-01-04\tcv',    // escapes output/
      '5\toutput/\t\ta4\t2026-01-05\tcv',                  // the output dir itself
      '6\toutput/nested\t\ta4\t2026-01-06\tcv',            // a directory inside output/
      'x\toutput/1-cv.pdf\t\ta4\t2026-01-07\tcv',          // non-numeric report id
      '',
    ].join('\n');
    assert.deepEqual([...presentPdfReports(manifest, work)], ['1']);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
