// tests/sync-pdf-flags.test.mjs — regression coverage for syncing tracker PDF flags.

import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nsync-pdf-flags.mjs — PDF flag reconciliation');

const TRACKER_HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-01-01 | Acme | ML Eng | 4.5/5 | Evaluated | ❌ | [1](reports/1-acme.md) | |',
  '| 2 | 2026-01-02 | Globex | Data Eng | 4.0/5 | Evaluated | — | [2](reports/2-globex.md) | |',
  '| 3 | 2026-01-03 | Initech | SE | 3.5/5 | Evaluated | ✅ | [3](reports/3-initech.md) | |',
  '| 4 | 2026-01-04 | Massive Dynamic | SE | 4.0/5 | Evaluated | ❌ | [4](reports/4-massive.md) | |',
  '',
].join('\n');

const PDF_MANIFEST = [
  '# report\tpdf\thtml\tformat\tdate',
  '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
  '002\toutput/2-globex-cv.pdf\toutput/2-globex.html\ta4\t2026-01-02',
  '3\toutput/3-initech-cv.pdf\toutput/3-initech.html\ta4\t2026-01-03',
  '',
].join('\n');

function runSync() {
  const work = mkdtempSync(join(tmpdir(), 'cops-sync-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, PDF_MANIFEST);
    
    execFileSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });
    
    return readFileSync(tracker, 'utf-8');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  const synced = runSync();
  const rows = synced.split('\n');
  
  const acme = rows.find(l => /\bAcme\b/.test(l)) || '';
  if (/\|\s*✅\s*\|\s*\[1\]/.test(acme)) {
    pass('sync-pdf-flags flips ❌ to ✅ when present in manifest');
  } else {
    fail(`sync-pdf-flags failed to flip Acme (report 1): ${acme.trim()}`);
  }

  const globex = rows.find(l => /\bGlobex\b/.test(l)) || '';
  if (/\|\s*✅\s*\|\s*\[2\]/.test(globex)) {
    pass('sync-pdf-flags handles zero-padded report numbers in manifest (002 matches [2])');
  } else {
    fail(`sync-pdf-flags failed to flip Globex (report 2): ${globex.trim()}`);
  }

  const initech = rows.find(l => /\bInitech\b/.test(l)) || '';
  if (/\|\s*✅\s*\|\s*\[3\]/.test(initech)) {
    pass('sync-pdf-flags leaves existing ✅ alone');
  } else {
    fail(`sync-pdf-flags broke Initech: ${initech.trim()}`);
  }

  const massive = rows.find(l => /\bMassive\b/.test(l)) || '';
  if (/\|\s*❌\s*\|\s*\[4\]/.test(massive)) {
    pass('sync-pdf-flags ignores rows missing from manifest');
  } else {
    fail(`sync-pdf-flags wrongly flipped Massive: ${massive.trim()}`);
  }
} catch (e) {
  fail(`sync-pdf-flags.mjs tests crashed: ${e.message}`);
}
