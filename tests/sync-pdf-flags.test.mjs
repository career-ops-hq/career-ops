// tests/sync-pdf-flags.test.mjs — regression coverage for syncing tracker PDF flags.

import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, symlinkSync } from 'fs';
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

// ---------------------------------------------------------------------------
// Prune fails closed (review on #3898, 13 Sep): a row goes only when its PDF is
// provably gone, and never the whole manifest by accident. On main, output/ at
// mode 000 gave `{ "pruned": 2, "kept": 0 }`, exit 0, and a header-only manifest.
// ---------------------------------------------------------------------------

const PRUNE_HEADER = '# report\tpdf\thtml\tformat\tdate';

function runPrune(work, args) {
  const result = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--prune', ...args], {
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, CAREER_OPS_TRACKER: join(work, 'applications.md'), CAREER_OPS_PDF_INDEX: join(work, 'pdf-index.tsv') },
  });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* asserted by the caller */ }
  return { ...result, json };
}

// chmod cannot deny root anything, and a POSIX mode does not bind on Windows, so
// the unreadable-directory cases skip there (same guard as intake.test.mjs).
const cannotDenyRead = process.platform === 'win32'
  ? 'win32: a POSIX mode does not deny reads'
  : (process.getuid?.() === 0 ? 'running as root, permission bits do not apply' : null);

{
  // (a) No output/ at all: a fresh clone, another machine, a moved workspace.
  // Every row would stat as missing, so prune must stop before judging any.
  // One row on purpose: the all-rows cap needs two, so only the output/ check
  // can be what keeps this manifest intact.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-no-output-'));
  try {
    const manifest = [PRUNE_HEADER, '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01', ''].join('\n');
    writeFileSync(join(work, 'applications.md'), TRACKER_HEADER);
    writeFileSync(join(work, 'pdf-index.tsv'), manifest);

    const write = runPrune(work, ['--write', '--json']);
    const manifestAfter = readFileSync(join(work, 'pdf-index.tsv'), 'utf-8');
    if (write.status === 2 && write.json?.code === 'no-output-dir' && manifestAfter === manifest) {
      pass('sync-pdf-flags --prune --write refuses to run without output/ and leaves the manifest intact');
    } else {
      fail(`missing output/ was not refused: status=${write.status}, stdout=${write.stdout.trim()}, manifest=${JSON.stringify(manifestAfter)}`);
    }

    const dry = runPrune(work, ['--json']);
    if (dry.status === 2 && dry.json?.code === 'no-output-dir') {
      pass('sync-pdf-flags --prune dry run reports the missing output/ instead of listing every row as stale');
    } else {
      fail(`missing output/ dry run: status=${dry.status}, stdout=${dry.stdout.trim()}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (cannotDenyRead) {
  console.log(`  ⏭  skipped (unreadable output/): ${cannotDenyRead}`);
} else {
  // (b) output/ exists but cannot be read (mode 000), with both PDFs intact
  // inside it: the reproduction from the review.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-locked-output-'));
  const outputDir = join(work, 'output');
  try {
    mkdirSync(outputDir);
    writeFileSync(join(outputDir, '1-acme-cv.pdf'), 'pdf-content');
    writeFileSync(join(outputDir, '2-globex-cv.pdf'), 'pdf-content');
    const manifest = [
      PRUNE_HEADER,
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      '2\toutput/2-globex-cv.pdf\toutput/2-globex.html\ta4\t2026-01-02',
      '',
    ].join('\n');
    writeFileSync(join(work, 'applications.md'), TRACKER_HEADER);
    writeFileSync(join(work, 'pdf-index.tsv'), manifest);
    chmodSync(outputDir, 0o000);

    const write = runPrune(work, ['--write', '--json']);
    const manifestAfter = readFileSync(join(work, 'pdf-index.tsv'), 'utf-8');
    if (write.status === 2 && write.json?.code === 'output-dir-unreadable' && manifestAfter === manifest) {
      pass('sync-pdf-flags --prune --write refuses an unreadable output/ and leaves the manifest intact');
    } else {
      fail(`unreadable output/ was not refused: status=${write.status}, stdout=${write.stdout.trim()}, manifest=${JSON.stringify(manifestAfter)}`);
    }
  } finally {
    try { chmodSync(outputDir, 0o755); } catch {}
    rmSync(work, { recursive: true, force: true });
  }
}

if (cannotDenyRead) {
  console.log(`  ⏭  skipped (row that cannot be checked): ${cannotDenyRead}`);
} else {
  // (c) One row cannot be checked: its PDF sits in a mode-000 folder, so stat
  // fails with EACCES, not ENOENT. It is kept and reported, while a PDF that
  // really was deleted beside it still goes.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-locked-row-'));
  const lockedDir = join(work, 'output', 'locked');
  try {
    mkdirSync(lockedDir, { recursive: true });
    writeFileSync(join(work, 'output', '1-acme-cv.pdf'), 'pdf-content');
    writeFileSync(join(lockedDir, '2-globex-cv.pdf'), 'pdf-content');
    const manifest = [
      PRUNE_HEADER,
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      '2\toutput/locked/2-globex-cv.pdf\toutput/2-globex.html\ta4\t2026-01-02',
      '3\toutput/3-gone-cv.pdf\toutput/3-gone.html\ta4\t2026-01-03',
      '',
    ].join('\n');
    writeFileSync(join(work, 'applications.md'), TRACKER_HEADER);
    writeFileSync(join(work, 'pdf-index.tsv'), manifest);
    chmodSync(lockedDir, 0o000);

    // Human-readable dry run first, while the manifest is still pristine: the
    // warning goes to stderr and the row is not listed as stale.
    const human = runPrune(work, []);
    if (human.status === 0 && human.stderr.includes('output/locked/2-globex-cv.pdf') && !human.stdout.includes('prune: output/locked/')) {
      pass('sync-pdf-flags --prune warns on stderr about a row it cannot check instead of listing it as stale');
    } else {
      fail(`unchecked row in human output: status=${human.status}, stdout=${human.stdout.trim()}, stderr=${human.stderr.trim()}`);
    }

    const write = runPrune(work, ['--write', '--json']);
    const manifestAfter = readFileSync(join(work, 'pdf-index.tsv'), 'utf-8');
    const warning = write.json?.warnings?.find(w => w.report === '2');
    if (write.status === 0 && write.json?.pruned === 1 && write.json?.kept === 2
      && warning?.code === 'cannot-check' && ['EACCES', 'EPERM'].includes(warning?.reason)) {
      pass('sync-pdf-flags --prune --write keeps a row whose stat fails with EACCES and reports it in warnings');
    } else {
      fail(`unchecked row JSON wrong: status=${write.status}, stdout=${write.stdout.trim()}`);
    }

    if (manifestAfter.includes('output/locked/2-globex-cv.pdf') && manifestAfter.includes('1-acme-cv.pdf') && !manifestAfter.includes('3-gone-cv.pdf')) {
      pass('sync-pdf-flags --prune --write keeps the unchecked row and still drops the deleted one');
    } else {
      fail(`unchecked row manifest content wrong:\n${manifestAfter}`);
    }
  } finally {
    try { chmodSync(lockedDir, 0o755); } catch {}
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // (d) output/ is there but holds none of the manifest's PDFs, so every row
  // would go. That is the signature of an environment problem (a manifest from
  // another machine, PDFs kept elsewhere), so --write refuses unless
  // --allow-empty says the user really deleted them all.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-all-gone-'));
  try {
    mkdirSync(join(work, 'output'));
    const manifest = [
      PRUNE_HEADER,
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      '2\toutput/2-globex-cv.pdf\toutput/2-globex.html\ta4\t2026-01-02',
      '3\toutput/3-initech-cv.pdf\toutput/3-initech.html\ta4\t2026-01-03',
      '',
    ].join('\n');
    writeFileSync(join(work, 'applications.md'), TRACKER_HEADER);
    writeFileSync(join(work, 'pdf-index.tsv'), manifest);

    const dry = runPrune(work, ['--json']);
    if (dry.status === 0 && dry.json?.pruned === 3 && dry.json?.warnings?.some(w => w.code === 'would-empty-manifest')) {
      pass('sync-pdf-flags --prune dry run warns when every row would be pruned');
    } else {
      fail(`all-rows dry run: status=${dry.status}, stdout=${dry.stdout.trim()}`);
    }

    const refused = runPrune(work, ['--write', '--json']);
    const afterRefusal = readFileSync(join(work, 'pdf-index.tsv'), 'utf-8');
    if (refused.status === 3 && refused.json?.code === 'would-empty-manifest' && afterRefusal === manifest) {
      pass('sync-pdf-flags --prune --write refuses to empty the manifest without --allow-empty');
    } else {
      fail(`all-rows prune was not refused: status=${refused.status}, stdout=${refused.stdout.trim()}, manifest=${JSON.stringify(afterRefusal)}`);
    }

    const allowed = runPrune(work, ['--write', '--allow-empty', '--json']);
    const afterAllowed = readFileSync(join(work, 'pdf-index.tsv'), 'utf-8');
    if (allowed.status === 0 && allowed.json?.pruned === 3 && allowed.json?.kept === 0 && afterAllowed === `${PRUNE_HEADER}\n`) {
      pass('sync-pdf-flags --prune --write --allow-empty prunes every row and keeps the header');
    } else {
      fail(`--allow-empty did not prune every row: status=${allowed.status}, stdout=${allowed.stdout.trim()}, manifest=${JSON.stringify(afterAllowed)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // --allow-empty only qualifies --prune; on its own it is rejected like --write.
  // The first run proves --prune accepts it, otherwise the rejection would hold
  // for any unknown word and prove nothing about this guard.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-allow-empty-only-'));
  try {
    const tracker = join(work, 'applications.md');
    const pdfIndex = join(work, 'pdf-index.tsv');
    mkdirSync(join(work, 'output'));
    writeFileSync(tracker, TRACKER_HEADER);
    writeFileSync(pdfIndex, PDF_MANIFEST);

    const withPrune = runPrune(work, ['--allow-empty', '--json']);
    const alone = spawnSync(NODE, [join(ROOT, 'sync-pdf-flags.mjs'), '--allow-empty', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PDF_INDEX: pdfIndex },
    });

    if (withPrune.status === 0 && alone.status === 1 && /unknown option.*--allow-empty/i.test(alone.stderr) && readFileSync(tracker, 'utf-8') === TRACKER_HEADER) {
      pass('sync-pdf-flags accepts --allow-empty with --prune and rejects it outside of --prune mode');
    } else {
      fail(`--allow-empty scoping wrong: with --prune status=${withPrune.status} (${withPrune.stderr.trim()}), alone status=${alone.status} (${alone.stderr.trim()})`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // (e) The fix must not stop prune from doing its job: a PDF that really was
  // deleted (ENOENT) is still pruned next to live ones, and so is a path that
  // runs through a file (ENOTDIR: nothing can exist below a file). Neither is
  // a warning.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-real-delete-'));
  try {
    const outputDir = join(work, 'output');
    mkdirSync(outputDir);
    writeFileSync(join(outputDir, '1-acme-cv.pdf'), 'pdf-content');
    writeFileSync(join(outputDir, '2-globex-cv.pdf'), 'pdf-content');
    const manifest = [
      PRUNE_HEADER,
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      '2\toutput/2-globex-cv.pdf\toutput/2-globex.html\ta4\t2026-01-02',
      '3\toutput/3-deleted-cv.pdf\toutput/3-deleted.html\ta4\t2026-01-03',
      '4\toutput/1-acme-cv.pdf/4-below-a-file.pdf\toutput/4.html\ta4\t2026-01-04',
      '',
    ].join('\n');
    writeFileSync(join(work, 'applications.md'), TRACKER_HEADER);
    writeFileSync(join(work, 'pdf-index.tsv'), manifest);

    const write = runPrune(work, ['--write', '--json']);
    const manifestAfter = readFileSync(join(work, 'pdf-index.tsv'), 'utf-8');
    if (write.status === 0 && write.json?.pruned === 2 && write.json?.kept === 2 && !write.json?.warnings?.length) {
      pass('sync-pdf-flags --prune --write still prunes a deleted PDF (ENOENT/ENOTDIR) next to live ones, without warnings');
    } else {
      fail(`real deletion JSON wrong: status=${write.status}, stdout=${write.stdout.trim()}`);
    }

    if (manifestAfter.includes('1-acme-cv.pdf\t') && manifestAfter.includes('2-globex-cv.pdf') && !manifestAfter.includes('3-deleted-cv.pdf') && !manifestAfter.includes('4-below-a-file.pdf')) {
      pass('sync-pdf-flags --prune --write drops only the deleted rows');
    } else {
      fail(`real deletion manifest content wrong:\n${manifestAfter}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  // Symlink containment survives the rewrite: a link inside output/ that leads
  // to a real PDF outside it is still pruned, and a link that stays inside is kept.
  const work = mkdtempSync(join(tmpdir(), 'cops-prune-symlink-'));
  const outside = mkdtempSync(join(tmpdir(), 'cops-prune-symlink-target-'));
  try {
    const outputDir = join(work, 'output');
    mkdirSync(outputDir);
    writeFileSync(join(outputDir, '1-acme-cv.pdf'), 'pdf-content');
    writeFileSync(join(outside, 'elsewhere.pdf'), 'pdf-content');
    let linked = true;
    try {
      symlinkSync(join(outside, 'elsewhere.pdf'), join(outputDir, '2-link-out.pdf'));
      symlinkSync(join(outputDir, '1-acme-cv.pdf'), join(outputDir, '3-link-in.pdf'));
    } catch {
      linked = false; // Windows without Developer Mode cannot create symlinks
    }

    if (!linked) {
      console.log('  ⏭  skipped (symlink containment): symlinks cannot be created here');
    } else {
      const manifest = [
        PRUNE_HEADER,
        '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
        '2\toutput/2-link-out.pdf\toutput/2.html\ta4\t2026-01-02',
        '3\toutput/3-link-in.pdf\toutput/3.html\ta4\t2026-01-03',
        '',
      ].join('\n');
      writeFileSync(join(work, 'applications.md'), TRACKER_HEADER);
      writeFileSync(join(work, 'pdf-index.tsv'), manifest);

      const write = runPrune(work, ['--write', '--json']);
      const manifestAfter = readFileSync(join(work, 'pdf-index.tsv'), 'utf-8');
      if (write.status === 0 && write.json?.pruned === 1 && write.json?.kept === 2
        && !manifestAfter.includes('2-link-out.pdf') && manifestAfter.includes('3-link-in.pdf')) {
        pass('sync-pdf-flags --prune still prunes a symlink that escapes output/ and keeps one that stays inside');
      } else {
        fail(`symlink containment wrong: status=${write.status}, stdout=${write.stdout.trim()}, manifest=${JSON.stringify(manifestAfter)}`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}
