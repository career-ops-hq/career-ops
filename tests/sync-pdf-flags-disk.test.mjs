// tests/sync-pdf-flags-disk.test.mjs — the default sync sets the PDF flag only
// for a CV row whose file is on disk inside output/ (#4777).

import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nsync-pdf-flags.mjs — disk-aware PDF flag sync');

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-01-01 | Acme | ML Eng | 4.5/5 | Evaluated | ❌ | [1](reports/1-acme.md) | |',
  '| 2 | 2026-01-02 | Globex | Data Eng | 4.0/5 | Evaluated | — | [2](reports/2-globex.md) | |',
  '| 3 | 2026-01-03 | Initech | SE | 3.5/5 | Evaluated | ❌ | [3](reports/3-initech.md) | |',
  '| 4 | 2026-01-04 | Massive Dynamic | SE | 4.0/5 | Evaluated | ❌ | [4](reports/4-massive.md) | |',
  '| 5 | 2026-01-05 | Umbrella | SE | 4.0/5 | Evaluated | ❌ | [5](reports/5-umbrella.md) | |',
  '',
].join('\n');

// Regression for #4777: a manifest row whose PDF is gone must not restore the flag.
{
  const work = mkdtempSync(join(tmpdir(), 'cops-sync-disk-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    mkdirSync(join(work, 'output'), { recursive: true });
    // Report 1: CV on disk. Report 2: CV row, file deleted. Report 3: only a
    // cover row on disk. Report 4: row points outside output/. Report 5: row
    // names a directory inside output/, which exists but is not a PDF.
    writeFileSync(join(work, 'output', '1-acme-cv.pdf'), 'pdf-content');
    writeFileSync(join(work, 'output', '3-initech-cover.pdf'), 'pdf-content');
    writeFileSync(join(work, 'outside.pdf'), 'pdf-content');
    mkdirSync(join(work, 'output', '5-umbrella-cv.pdf'));
    const manifest = [
      '# report\tpdf\thtml\tformat\tdate\tkind',
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01\tcv',
      '2\toutput/2-globex-cv.pdf\toutput/2-globex.html\ta4\t2026-01-02\tcv',
      '3\toutput/3-initech-cover.pdf\toutput/3-initech.html\ta4\t2026-01-03\tcover',
      '4\toutput/../outside.pdf\toutput/4.html\ta4\t2026-01-04\tcv',
      '5\toutput/5-umbrella-cv.pdf\toutput/5.html\ta4\t2026-01-05\tcv',
      '',
    ].join('\n');
    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, manifest);

    execFileSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });
    const rows = readFileSync(tracker, 'utf-8').split('\n');
    const row = (name) => rows.find(l => l.includes(name)) || '';

    if (/\|\s*✅\s*\|\s*\[1\]/.test(row('Acme'))) pass('sync-pdf-flags sets ✅ when the CV PDF is on disk');
    else fail(`Acme should be ✅: ${row('Acme').trim()}`);

    if (/\|\s*—\s*\|\s*\[2\]/.test(row('Globex'))) pass('sync-pdf-flags does not set ✅ from a manifest row whose PDF is missing (#4777)');
    else fail(`Globex should stay unflagged: ${row('Globex').trim()}`);

    if (/\|\s*❌\s*\|\s*\[3\]/.test(row('Initech'))) pass('sync-pdf-flags ignores a cover-letter row when setting the CV flag');
    else fail(`Initech should stay ❌: ${row('Initech').trim()}`);

    if (/\|\s*❌\s*\|\s*\[4\]/.test(row('Massive'))) pass('sync-pdf-flags ignores a manifest path outside output/');
    else fail(`Massive should stay ❌: ${row('Massive').trim()}`);

    if (/\|\s*❌\s*\|\s*\[5\]/.test(row('Umbrella'))) pass('sync-pdf-flags does not set ✅ from a manifest row that names a directory');
    else fail(`Umbrella should stay ❌: ${row('Umbrella').trim()}`);
  } catch (e) {
    fail(`sync-pdf-flags disk-aware test crashed: ${e.message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
