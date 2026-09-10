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

    // The files exist, but one is outside the workspace.
    writeFileSync(join(outputDir, '1-acme-cv.pdf'), 'pdf-content');
    const externalPdf = join(outOfBounds, 'outside.pdf');
    writeFileSync(externalPdf, 'pdf-content');

    const manifest = [
      '# report\tpdf\thtml\tformat\tdate',
      '1\toutput/1-acme-cv.pdf\toutput/1-acme.html\ta4\t2026-01-01',
      `2\t${externalPdf.replace(/\\/g, '/')}\toutput/2-gone.html\ta4\t2026-01-02`,
      '3\toutput/../../outside.pdf\toutput/3-gone.html\ta4\t2026-01-02',
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
      pass('sync-pdf-flags --prune prunes paths outside the workspace');
    } else {
      fail(`path traversal JSON wrong: status=${result.status}, stdout=${result.stdout.trim()}`);
    }

    if (!manifestAfter.includes('outside.pdf') && manifestAfter.includes('1-acme-cv.pdf')) {
      pass('sync-pdf-flags --prune removes out-of-bounds files from manifest');
    } else {
      fail(`path traversal manifest content wrong:\n${manifestAfter}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outOfBounds, { recursive: true, force: true });
  }
}
