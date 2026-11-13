// tests/github-evidence-paths.test.mjs — where github-evidence scan files live
// (#6667, #7006): written to output/diagnostics/, read from there and from the
// legacy output/. No gh call and no network: scans are written by hand.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync } from './helpers.mjs';
import { EVIDENCE_SUBDIR, evidenceWriteDir, listScanFiles } from '../lib/github-evidence-paths.mjs';
import { findPreviousScan } from '../github-evidence.mjs';
import { findLatestScan } from '../evidence-freshness.mjs';

console.log('\nlib/github-evidence-paths.mjs — scan files in output/diagnostics/ and the legacy output/');

const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const USER = 'jane-doe';

const roots = [];
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'co-evidence-paths-'));
  roots.push(root);
  return root;
}

/** Write a scan JSON into output/ (legacy) or output/diagnostics/. */
function scan(root, date, { legacy = false, user = USER } = {}) {
  const dir = legacy ? join(root, 'output') : join(root, 'output', EVIDENCE_SUBDIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `github-evidence-${date}.json`), `${JSON.stringify({ status: 'ok', generatedAt: date, user })}\n`);
}

try {
  // ── the write location ──
  {
    const out = join('/data', 'output');
    check(evidenceWriteDir(out) === join(out, 'diagnostics'), 'evidenceWriteDir: output/diagnostics/');
  }

  // ── listScanFiles ──
  {
    const root = sandbox();
    check(listScanFiles(join(root, 'output')).length === 0, 'listScanFiles: no output/ directory -> empty');
    mkdirSync(join(root, 'output', 'diagnostics'), { recursive: true });
    check(listScanFiles(join(root, 'output')).length === 0, 'listScanFiles: empty diagnostics/ -> empty');
  }
  {
    const root = sandbox();
    scan(root, '2026-10-10', { legacy: true });
    const found = listScanFiles(join(root, 'output'));
    check(found.length === 1 && found[0].legacy === true && found[0].rel === 'output/github-evidence-2026-10-10.json',
      'listScanFiles: a legacy scan in output/ is found, marked legacy, with an output/ rel path');
  }
  {
    const root = sandbox();
    scan(root, '2026-10-12');
    const found = listScanFiles(join(root, 'output'));
    check(found.length === 1 && found[0].legacy === false && found[0].rel === 'output/diagnostics/github-evidence-2026-10-12.json',
      'listScanFiles: a scan in diagnostics/ is found with an output/diagnostics/ rel path');
  }
  {
    const root = sandbox();
    scan(root, '2026-10-10', { legacy: true });
    scan(root, '2026-10-12');
    scan(root, '2026-10-11', { legacy: true });
    scan(root, '2026-10-12', { legacy: true }); // same date in both places
    writeFileSync(join(root, 'output', 'github-evidence-2026-10-13.md'), 'not a scan json');
    writeFileSync(join(root, 'output', 'github-evidence-notes.json'), '{}');
    const found = listScanFiles(join(root, 'output'));
    check(found.map((f) => f.date).join(',') === '2026-10-12,2026-10-12,2026-10-11,2026-10-10',
      `listScanFiles: both places merged, newest date first, non-scan names ignored (got ${found.map((f) => f.date)})`);
    check(found[0].legacy === false && found[1].legacy === true,
      'listScanFiles: on a date tie the diagnostics/ copy comes first');
  }

  // ── findPreviousScan (github-evidence --since baseline) ──
  {
    const root = sandbox();
    scan(root, '2026-10-15', { legacy: true });
    const found = findPreviousScan(join(root, 'output'), '2026-10-22');
    check(found.status === 'ok' && found.file === 'output/github-evidence-2026-10-15.json',
      `findPreviousScan: falls back to a legacy scan in output/ (got ${found.file})`);
  }
  {
    const root = sandbox();
    scan(root, '2026-10-15');
    const found = findPreviousScan(join(root, 'output'), '2026-10-22');
    check(found.status === 'ok' && found.file === 'output/diagnostics/github-evidence-2026-10-15.json',
      `findPreviousScan: reads a scan in diagnostics/ and reports its real path (got ${found.file})`);
  }
  {
    const root = sandbox();
    scan(root, '2026-10-15', { legacy: true });
    scan(root, '2026-10-18');
    const found = findPreviousScan(join(root, 'output'), '2026-10-22');
    check(found.date === '2026-10-18' && found.file === 'output/diagnostics/github-evidence-2026-10-18.json',
      'findPreviousScan: a newer diagnostics/ scan beats an older legacy one');
  }
  {
    const root = sandbox();
    scan(root, '2026-10-20', { legacy: true });
    scan(root, '2026-10-18');
    const found = findPreviousScan(join(root, 'output'), '2026-10-22');
    check(found.date === '2026-10-20' && found.file === 'output/github-evidence-2026-10-20.json',
      'findPreviousScan: a newer legacy scan beats an older diagnostics/ one (newest date wins, not the folder)');
  }
  {
    const root = sandbox();
    scan(root, '2026-10-22'); // today's own scan is never its baseline
    check(findPreviousScan(join(root, 'output'), '2026-10-22').status === 'none',
      'findPreviousScan: a scan dated today is not a previous scan');
  }

  // ── findLatestScan (evidence-freshness) ──
  {
    const root = sandbox();
    check(findLatestScan(root, USER) === null, 'findLatestScan: nothing anywhere -> null');
  }
  {
    const root = sandbox();
    scan(root, '2026-10-10', { legacy: true });
    const found = findLatestScan(root, USER);
    check(found?.date === '2026-10-10' && found.file === 'output/github-evidence-2026-10-10.json',
      `findLatestScan: finds a legacy scan in output/ (got ${found?.file})`);
  }
  {
    const root = sandbox();
    scan(root, '2026-10-10', { legacy: true });
    scan(root, '2026-10-14');
    const found = findLatestScan(root, USER);
    check(found?.date === '2026-10-14' && found.file === 'output/diagnostics/github-evidence-2026-10-14.json',
      `findLatestScan: finds the newer scan in diagnostics/ (got ${found?.file})`);
  }
  {
    const root = sandbox();
    scan(root, '2026-10-14', { user: 'someone-else' });
    scan(root, '2026-10-09', { legacy: true });
    const found = findLatestScan(root, USER);
    check(found?.date === '2026-10-09', 'findLatestScan: another user\'s newer scan is skipped across both places');
  }

  // ── the manifest ──
  {
    const manifest = readFileSync(new URL('../lib/update-manifest.mjs', import.meta.url), 'utf8');
    check(manifest.includes("'lib/github-evidence-paths.mjs'"), 'lib/github-evidence-paths.mjs is in lib/update-manifest.mjs SYSTEM_PATHS');
  }
} finally {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}
