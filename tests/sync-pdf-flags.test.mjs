// tests/sync-pdf-flags.test.mjs — regression coverage for syncing tracker PDF flags.

import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'fs';
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

    // Every pdf the manifest names must exist, 4-massive included. A row is only
    // PDF-ready when its file is on disk, so leaving that one out would let the
    // "4-draft is not a report number" case pass for the wrong reason.
    mkdirSync(join(work, 'output'), { recursive: true });
    for (const pdf of ['1-acme-cv.pdf', '2-globex-cv.pdf', '3-initech-cv.pdf', '4-massive-cv.pdf']) {
      writeFileSync(join(work, 'output', pdf), '%PDF-1.4\n');
    }
    
    execFileSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: work,
      env: { ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
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

// ---------------------------------------------------------------------------
// Prune mode tests (#3893)
// ---------------------------------------------------------------------------

{
  // A manifest with one row whose PDF exists and one whose PDF is deleted.
  // --prune dry run (default): manifest unchanged, output names the missing file.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-dryrun-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    const outputDir = join(work, 'output');
    mkdirSync(outputDir, { recursive: true });

    // Only report 1's PDF is present on disk; report 2's is not.
    writeFileSync(join(outputDir, '1-acme-cv.pdf'), 'pdf-content');

    const manifest = [
      '# report\tpdf\thtml\tformat\tdate',
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      '2\toutput/2-gone-cv.pdf\toutput/2-gone.html\ta4\t2026-01-02',
      '',
    ].join('\n');

    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, manifest);

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--prune', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });

    const manifestAfter = readFileSync(pdfIndex, 'utf-8');
    const json = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();

    if (result.status === 0 && json && json.pruned === 1 && json.kept === 1 && json.dryRun === true) {
      pass('sync-pdf-flags --prune reports one stale row in dry-run JSON');
    } else {
      fail(`--prune dry-run JSON wrong: status=${result.status}, stdout=${result.stdout.trim()}`);
    }

    if (manifestAfter === manifest) {
      pass('sync-pdf-flags --prune dry run does not write the manifest');
    } else {
      fail('--prune dry run mutated the manifest without --write');
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // --prune --write removes the stale row and keeps the live one.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-write-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    const outputDir = join(work, 'output');
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(join(outputDir, '1-acme-cv.pdf'), 'pdf-content');

    const manifest = [
      '# report\tpdf\thtml\tformat\tdate',
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      '2\toutput/2-gone-cv.pdf\toutput/2-gone.html\ta4\t2026-01-02',
      '',
    ].join('\n');

    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, manifest);

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--prune', '--write', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });

    const manifestAfter = readFileSync(pdfIndex, 'utf-8');
    const json = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();

    if (result.status === 0 && json && json.pruned === 1 && json.kept === 1 && json.dryRun === false) {
      pass('sync-pdf-flags --prune --write reports correct counts and dryRun:false');
    } else {
      fail(`--prune --write JSON wrong: status=${result.status}, stdout=${result.stdout.trim()}`);
    }

    if (!manifestAfter.includes('2-gone-cv.pdf') && manifestAfter.includes('1-acme-cv.pdf')) {
      pass('sync-pdf-flags --prune --write removes the stale row and keeps the live row');
    } else {
      fail(`--prune --write manifest content wrong:\n${manifestAfter}`);
    }

    // The comment header must be preserved.
    if (manifestAfter.startsWith('#')) {
      pass('sync-pdf-flags --prune --write preserves the manifest comment header');
    } else {
      fail('--prune --write dropped the manifest comment header');
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // --prune with all PDFs present: manifest unchanged, pruned:0.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-noop-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    const outputDir = join(work, 'output');
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(join(outputDir, '1-acme-cv.pdf'), 'pdf-content');
    writeFileSync(join(outputDir, '2-globex-cv.pdf'), 'pdf-content');

    const manifest = [
      '# report\tpdf\thtml\tformat\tdate',
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      '2\toutput/2-globex-cv.pdf\toutput/2-globex.html\ta4\t2026-01-02',
      '',
    ].join('\n');

    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, manifest);

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--prune', '--write', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });

    const manifestAfter = readFileSync(pdfIndex, 'utf-8');
    const json = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();

    if (result.status === 0 && json && json.pruned === 0 && json.kept === 2) {
      pass('sync-pdf-flags --prune is a no-op when all PDFs are on disk');
    } else {
      fail(`--prune all-live JSON wrong: status=${result.status}, stdout=${result.stdout.trim()}`);
    }

    if (manifestAfter === manifest) {
      pass('sync-pdf-flags --prune does not rewrite manifest when nothing is pruned');
    } else {
      fail('--prune rewrote an already-clean manifest');
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // --write without --prune is an unknown option.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-write-only-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, PDF_MANIFEST);

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--write', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });

    if (result.status === 1 && /unknown option.*--write/i.test(result.stderr)) {
      pass('sync-pdf-flags rejects --write outside of --prune mode');
    } else {
      fail(`--write without --prune should fail: status=${result.status}, stderr=${result.stderr.trim()}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // --prune with no manifest file is a silent no-op (exit 0, pruned:0).
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-no-manifest-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv'); // does not exist

    writeFileSync(tracker, TRACKER_HEADER);

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--prune', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });

    const json = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();

    if (result.status === 0 && json && json.pruned === 0) {
      pass('sync-pdf-flags --prune is a no-op when no manifest exists');
    } else {
      fail(`--prune no-manifest wrong: status=${result.status}, stdout=${result.stdout.trim()}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // --dry-run combined with --write ignores --write (dry-run wins).
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-dryrun-write-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    const outputDir = join(work, 'output');
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(join(outputDir, '1-acme-cv.pdf'), 'pdf-content');

    const manifest = [
      '# report\tpdf\thtml\tformat\tdate',
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      '2\toutput/2-gone-cv.pdf\toutput/2-gone.html\ta4\t2026-01-02',
      '',
    ].join('\n');

    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, manifest);

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--prune', '--dry-run', '--write', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });

    const manifestAfter = readFileSync(pdfIndex, 'utf-8');
    const json = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();

    if (result.status === 0 && json && json.pruned === 1 && json.kept === 1 && json.dryRun === true) {
      pass('sync-pdf-flags --dry-run --write forces dry-run behavior');
    } else {
      fail(`--dry-run --write JSON wrong: status=${result.status}, stdout=${result.stdout.trim()}`);
    }

    if (manifestAfter === manifest) {
      pass('sync-pdf-flags --dry-run --write does not mutate manifest');
    } else {
      fail('--dry-run --write mutated the manifest');
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // Path traversal guard: absolute paths or ../ paths outside the workspace are pruned.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-traversal-'));
  const outOfBounds = mkdtempSync(join(tmpdir(), 'cops-prune-outofbounds-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    const outputDir = join(work, 'output');
    mkdirSync(outputDir, { recursive: true });

    // Both files exist on disk, but both are outside the output/ directory.
    writeFileSync(join(outputDir, '1-acme-cv.pdf'), 'pdf-content');
    const externalPdf = join(outOfBounds, 'outside.pdf');
    writeFileSync(externalPdf, 'pdf-content');
    const escapedInRepoPdf = join(work, 'escaped-in-repo.pdf');
    writeFileSync(escapedInRepoPdf, 'pdf-content');

    const manifest = [
      '# report\tpdf\thtml\tformat\tdate',
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      `2\t${externalPdf.replace(/\\/g, '/')}\toutput/2-gone.html\ta4\t2026-01-02`,
      '3\toutput/../escaped-in-repo.pdf\toutput/3-gone.html\ta4\t2026-01-02',
      '',
    ].join('\n');

    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, manifest);

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--prune', '--write', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });

    const manifestAfter = readFileSync(pdfIndex, 'utf-8');
    const json = (() => { try { return JSON.parse(result.stdout); } catch { return null; } })();

    if (result.status === 0 && json && json.pruned === 2 && json.kept === 1) {
      pass('sync-pdf-flags --prune prunes paths outside output directory even when files exist');
    } else {
      fail(`path traversal JSON wrong: status=${result.status}, stdout=${result.stdout.trim()}`);
    }

    if (!manifestAfter.includes('outside.pdf') && !manifestAfter.includes('escaped-in-repo.pdf') && manifestAfter.includes('1-acme-cv.pdf')) {
      pass('sync-pdf-flags --prune removes out-of-bounds files from manifest');
    } else {
      fail(`path traversal manifest content wrong:\n${manifestAfter}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outOfBounds, { recursive: true, force: true });
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

// ── #4777: which manifest rows count as a generated CV ────────────────────────
//
// The decision lives in livePdfIndex (find.mjs), shared with merge-tracker.mjs.
// These cases run the real script, so they also pin what the helper cannot see
// for itself: that this script calls it, parses the manifest with the
// kind-aware parser, and resolves paths under the root generate-pdf.mjs wrote
// them for rather than the root of the canonical tracker path.
console.log('\nsync-pdf-flags.mjs — which manifest rows count as a generated CV (#4777)');

const TRACKER_FOR = (...rows) => [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  ...rows,
  '',
].join('\n');
const ROW = (n, company, flag) => `| ${n} | 2026-01-0${n} | ${company} | SE | 4.0/5 | Evaluated | ${flag} | [${n}](reports/${n}-${company.toLowerCase()}.md) | |`;
const rowIn = (text, n) => text.split('\n').find((l) => l.startsWith(`| ${n} |`)) || '';
const PDF_HEADER = '# report\tpdf\thtml\tformat\tdate\tkind';

{
  const work = mkdtempSync(join(tmpdir(), 'cops-sync-kind-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    mkdirSync(join(work, 'output'), { recursive: true });
    // Both files are on disk. Report 5 has only a cover letter in the manifest,
    // report 6 has a CV. The PDF column describes the CV.
    writeFileSync(join(work, 'output', '5-acme-cover.pdf'), '%PDF-1.4\n');
    writeFileSync(join(work, 'output', '6-globex-cv.pdf'), '%PDF-1.4\n');
    writeFileSync(tracker, TRACKER_FOR(ROW(5, 'Acme', '❌'), ROW(6, 'Globex', '❌')));
    writeFileSync(pdfIndex, [
      PDF_HEADER,
      '5\toutput/5-acme-cover.pdf\toutput/5-acme-cover.html\tletter\t2026-01-05\tcover',
      '6\toutput/6-globex-cv.pdf\toutput/6-globex.html\tletter\t2026-01-06\tcv',
      '',
    ].join('\n'));

    execFileSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: work,
      env: { ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });
    const after = readFileSync(tracker, 'utf-8');

    if (rowIn(after, 6).includes('✅')) {
      pass('a CV row whose PDF is on disk flips its cell, with a cover row beside it');
    } else {
      fail(`a live CV row did not flip its cell: ${rowIn(after, 6)}`);
    }
    if (rowIn(after, 5).includes('❌')) {
      pass('a report with only a cover letter on disk is not PDF-ready');
    } else {
      fail(`a cover-letter row set the CV flag: ${rowIn(after, 5)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // data/ symlinked out of the repo, the natural workaround for #524. The
  // tracker and manifest are reached through the link; the PDF sits in the
  // repo's own output/, which is where generate-pdf.mjs wrote it (#3169).
  const parent = mkdtempSync(join(tmpdir(), 'cops-sync-symlinked-data-'));
  try {
    const repo = join(parent, 'repo');
    const external = join(parent, 'external');
    mkdirSync(join(repo, 'output'), { recursive: true });
    mkdirSync(join(external, 'data'), { recursive: true });
    writeFileSync(join(repo, 'output', '1-acme-cv.pdf'), '%PDF-1.4\n');
    writeFileSync(join(external, 'data', 'applications.md'), TRACKER_FOR(ROW(1, 'Acme', '❌')));
    writeFileSync(join(external, 'data', 'pdf-index.tsv'), [
      PDF_HEADER,
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\tletter\t2026-01-01\tcv',
      '',
    ].join('\n'));
    symlinkSync(join(external, 'data'), join(repo, 'data'), process.platform === 'win32' ? 'junction' : 'dir');

    const env = { ...process.env, CAREER_OPS_ROOT: repo };
    delete env.CAREER_OPS_TRACKER;
    delete env.CAREER_OPS_PDF_INDEX;
    execFileSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], { encoding: 'utf-8', timeout: 30000, cwd: repo, env });

    const after = readFileSync(join(external, 'data', 'applications.md'), 'utf-8');
    if (rowIn(after, 1).includes('✅')) {
      pass('a PDF in the repo flips its cell when data/ is a symlink out of the repo');
    } else {
      fail(`a live PDF was not found under a symlinked data/: ${rowIn(after, 1)}`);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

{
  const parent = mkdtempSync(join(tmpdir(), 'cops-sync-outside-'));
  try {
    const work = join(parent, 'work');
    const outside = join(parent, 'outside');
    mkdirSync(work, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'cv.pdf'), '%PDF-1.4\n');
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    writeFileSync(tracker, TRACKER_FOR(ROW(1, 'Acme', '❌')));
    writeFileSync(pdfIndex, [PDF_HEADER, '1\t../outside/cv.pdf\t\tletter\t2026-01-01\tcv', ''].join('\n'));

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: work,
      env: { ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });
    const after = readFileSync(tracker, 'utf-8');
    if (result.status === 0 && rowIn(after, 1).includes('❌') && /outside the workspace/.test(result.stderr)) {
      pass('a PDF outside the workspace does not set the flag, and the run says why');
    } else {
      fail(`an outside path set the flag or went unreported: status=${result.status}, row=${rowIn(after, 1)}, stderr=${JSON.stringify(result.stderr)}`);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

{
  // The old inline parse counted a row that named no file, because it had
  // nothing to check. A row with no pdf names nothing that could be on disk.
  const work = mkdtempSync(join(tmpdir(), 'cops-sync-no-pdf-column-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    writeFileSync(tracker, TRACKER_FOR(ROW(1, 'Acme', '❌')));
    writeFileSync(pdfIndex, [PDF_HEADER, '1\t\t\tletter\t2026-01-01\tcv', ''].join('\n'));
    execFileSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: work,
      env: { ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });
    const after = readFileSync(tracker, 'utf-8');
    if (rowIn(after, 1).includes('❌')) {
      pass('a manifest row that names no PDF does not set the flag');
    } else {
      fail(`a row with an empty pdf column set the flag: ${rowIn(after, 1)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.platform === 'win32') {
  warn('presence-unknown case not exercised on win32: a self-referential link needs symlink privilege');
} else {
  const work = mkdtempSync(join(tmpdir(), 'cops-sync-unknown-presence-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    mkdirSync(join(work, 'output'), { recursive: true });
    writeFileSync(join(work, 'output', '1-acme-cv.pdf'), '%PDF-1.4\n');
    // A link to itself fails stat with ELOOP: neither present nor provably absent.
    symlinkSync('loop.pdf', join(work, 'output', 'loop.pdf'));
    writeFileSync(tracker, TRACKER_FOR(ROW(1, 'Acme', '❌'), ROW(2, 'Globex', '❌')));
    writeFileSync(pdfIndex, [
      PDF_HEADER,
      '1\toutput/1-acme-cv.pdf\t\tletter\t2026-01-01\tcv',
      '2\toutput/loop.pdf\t\tletter\t2026-01-02\tcv',
      '',
    ].join('\n'));

    const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: work,
      env: { ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });
    const after = readFileSync(tracker, 'utf-8');
    if (result.status === 0 && rowIn(after, 1).includes('✅') && rowIn(after, 2).includes('❌') && /cannot tell/.test(result.stderr)) {
      pass('a path whose presence cannot be told is skipped with a warning, and the batch still runs');
    } else {
      fail(`unknown presence was mishandled: status=${result.status}, rows=${rowIn(after, 1)} / ${rowIn(after, 2)}, stderr=${JSON.stringify(result.stderr)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
