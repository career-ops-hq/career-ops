// tests/merge-tracker-pdf-disk.test.mjs — merge-tracker's own PDF sync must not
// set the flag from a manifest row whose PDF is missing, is a cover letter, or
// sits outside output/ (#4777).

import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nmerge-tracker.mjs — disk-aware PDF-flag sync');

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

const seed = '| 1 | 2026-01-01 | Acme | Eng | 4.0/5 | Evaluated | ❌ | [1](reports/1-acme.md) | |\n';

// A manifest row whose PDF is gone, is a cover letter, or escapes output/ must not set the flag (#4777)
for (const [label, manifestRow, fileOnDisk] of [
  ['missing PDF', '1\toutput/1.pdf\toutput/1.html\ta4\t2026-01-01\tcv', null],
  ['cover-letter row', '1\toutput/1-cover.pdf\toutput/1.html\ta4\t2026-01-01\tcover', 'output/1-cover.pdf'],
  ['path outside output/', '1\toutput/../outside.pdf\toutput/1.html\ta4\t2026-01-01\tcv', 'outside.pdf'],
]) {
  const workGone = mkdtempSync(join(tmpdir(), 'cops-merge-pdf-sync-gone-'));
  try {
    const tracker = join(workGone, 'applications.md');
    const addsDir = join(workGone, 'adds');
    const pdfIndex = join(workGone, 'pdf-index.tsv');
    mkdirSync(addsDir, { recursive: true });
    writeFileSync(tracker, TRACKER_HEADER + seed);
    writeFileSync(pdfIndex, '# report\tpdf\thtml\tformat\tdate\tkind\n' + manifestRow + '\n');
    mkdirSync(join(workGone, 'output'), { recursive: true });
    if (fileOnDisk) writeFileSync(join(workGone, fileOnDisk), 'pdf-content');
    execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: addsDir, CAREER_OPS_PDF_INDEX: pdfIndex },
    });
    const trackerContent = readFileSync(tracker, 'utf-8');
    if (/\|\s*❌\s*\|\s*\[1\]/.test(trackerContent)) {
      pass(`merge-tracker does not set ✅ from a ${label} (#4777)`);
    } else {
      fail(`merge-tracker set ✅ from a ${label}: row is ${trackerContent.split('\n').find(l => /Acme/.test(l))}`);
    }
  } catch (e) {
    fail(`merge-tracker disk-aware PDF sync test (${label}) crashed: ${e.message}`);
  } finally {
    rmSync(workGone, { recursive: true, force: true });
  }
}
