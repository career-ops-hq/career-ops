// tests/sync-pdf-flags.test.mjs — regression coverage for syncing tracker PDF flags.

import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { execFileSync, spawnSync } from 'child_process';
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
  '4-draft\toutput/4-massive-cv.pdf\toutput/4-massive.html\ta4\t2026-01-04',
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
  
  if (/4-draft/.test(PDF_MANIFEST)) {
    pass('sync-pdf-flags correctly ignores partially numeric report IDs (4-draft)');
  }
} catch (e) {
  fail(`sync-pdf-flags.mjs tests crashed: ${e.message}`);
}

{
  const work = mkdtempSync(join(tmpdir(), 'cops-sync-unknown-flag-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, PDF_MANIFEST);

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--dry-rn', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });
    const unchanged = readFileSync(tracker, 'utf-8') === TRACKER_HEADER;

    if (result.status === 1 && /unknown option.*--dry-rn/i.test(result.stderr) && unchanged) {
      pass('sync-pdf-flags rejects unknown options before changing the tracker');
    } else {
      fail(`unknown option changed the tracker or returned the wrong result: status=${result.status}, stderr=${JSON.stringify(result.stderr)}, unchanged=${unchanged}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  const work = mkdtempSync(join(tmpdir(), 'cops-sync-unreadable-manifest-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndexDir = join(work, 'pdf-index.tsv'); // Make it a directory
    writeFileSync(tracker, TRACKER_HEADER);
    mkdirSync(pdfIndexDir);

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndexDir },
    });

    if (result.status === 2 && /manifest-read-error/i.test(result.stdout)) {
      pass('sync-pdf-flags handles unreadable/directory manifest gracefully');
    } else {
      fail(`sync-pdf-flags unreadable manifest failed: status=${result.status}, stdout=${JSON.stringify(result.stdout)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ── #3893: a deleted PDF leaves a stale manifest row that re-asserts ✅ ───────
//
// sync-pdf-flags.mjs:64-68 keeps only the report number when it parses
// data/pdf-index.tsv and throws the pdf path away, so from that point it cannot
// tell a live artifact from a deleted one. The decision at :108 degenerates to
// "is this report number mentioned in the manifest", and the only write is a
// monotonic ✅ at :110-118.
//
// Nothing prunes the manifest either. generate-pdf.mjs:1240-1244 evicts a row
// only on RE-generation, so `rm output/*.pdf` leaves every row standing. That is
// why neither half is fixable alone: correcting the tracker cell by hand is
// reverted on the next run by the row that outlived its file.
//
// Scope, per the maintainer in the issue thread: the kind-agnostic half only.
// Writing ❌ when no CV-kind row exists is unsayable until #3887 gives the
// manifest a kind-aware key, and is deliberately a follow-on.
console.log('\nsync-pdf-flags.mjs — a deleted PDF leaves a stale manifest row (#3893)');

{
  const work = mkdtempSync(join(tmpdir(), 'cops-sync-stale-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    mkdirSync(join(work, 'output'), { recursive: true });

    // Report 1's PDF is on disk. Report 2's is not: the file was deleted and
    // the operator corrected the tracker cell to ❌ by hand.
    writeFileSync(join(work, 'output', '1-acme-cv.pdf'), '%PDF-1.4\n');

    writeFileSync(tracker, [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-01 | Acme | ML Eng | 4.5/5 | Evaluated | ❌ | [1](reports/1-acme.md) | |',
      '| 2 | 2026-01-02 | Globex | Data Eng | 4.0/5 | Evaluated | ❌ | [2](reports/2-globex.md) | |',
      '',
    ].join('\n'));

    writeFileSync(pdfIndex, [
      '# report\tpdf\thtml\tformat\tdate',
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      '2\toutput/2-globex-cv.pdf\toutput/2-globex.html\ta4\t2026-01-02',
      '',
    ].join('\n'));

    execFileSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: work,
      env: { ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });

    const rows = readFileSync(tracker, 'utf-8').split('\n');
    const rowOf = (n) => rows.find((l) => l.startsWith(`| ${n} |`)) || '';

    // Positive control. Without it a script that simply stopped writing would
    // satisfy the assertion below while doing nothing.
    if (rowOf(1).includes('✅')) {
      pass('a manifest row whose PDF is on disk still flips the tracker cell to ✅');
    } else {
      fail(`a live PDF did not flip its tracker cell: ${rowOf(1)}`);
    }

    if (rowOf(2).includes('❌')) {
      pass('a manifest row whose PDF is gone leaves the corrected ❌ alone');
    } else {
      fail(`the corrected ❌ was reverted from a manifest row whose PDF is gone: ${rowOf(2)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
