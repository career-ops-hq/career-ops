// tests/writer-scripts-data-root.test.mjs — the WRITER scripts read the user's
// data root, not the directory they live in (#4389, the same family as
// #3510/#3511 and tests/analysis-scripts-data-root.test.mjs).
//
// Those covered readers. These two write, and each had its own spelling of the
// bug:
//
//   set-status.mjs    `const CAREER_OPS = dirname(fileURLToPath(...))` then
//                     `resolveTrackerPath(CAREER_OPS)` — the exact constant the
//                     sibling suite's header calls out, still present in a writer.
//                     Failed with "No tracker found at <CHECKOUT>/applications.md".
//
//   generate-pdf.mjs  disagreed with ITSELF: line 49 derived the tracker from
//                     getCareerOpsRoot(), while refreshRootCache() derived the
//                     containment boundary from __dirname. Every path under the
//                     real data root then read as an escape and the PDF was
//                     refused outright.
//
// Each child runs with the data root and the cwd pointed at DIFFERENT
// directories, so a path following the cwd or the checkout cannot pass by
// accident.
//
// Run:  node --test tests/writer-scripts-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture() {
  // realpathSync because generate-pdf.mjs compares a canonical workspace root
  // against the paths it is handed. On macOS the temp dir is reached through a
  // symlink (/tmp -> /private/tmp), so a lexical fixture path would be reported
  // as outside its own workspace and the test would fail for a reason that has
  // nothing to do with which root was used.
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-writerroot-')));
  const decoyCwd = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-writercwd-')));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(join(dataRoot, 'output'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-01-05 | Acme | Backend Engineer | 4.2/5 | Applied | ❌ | — | seed |',
    '',
  ].join('\n'));
  writeFileSync(join(dataRoot, 'output', 'cv.html'),
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>CV</title></head><body>'
    + '<h1>Jane Doe</h1><div>jane@example.com | +1 415 555 0100</div>'
    + '<h2>Experience</h2><p>Process engineering across deposition, etch and yield analysis '
    + 'in high volume semiconductor manufacturing over more than a decade of practice.</p>'
    + '<h2>Education</h2><p>BS Chemical Engineering, 2014.</p>'
    + '<h2>Skills</h2><p>Python, MATLAB, SPC.</p></body></html>');
  return { dataRoot, decoyCwd };
}

function run(script, args, { dataRoot, decoyCwd }) {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: decoyCwd,
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '' },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const cleanup = (f) => {
  for (const d of [f.dataRoot, f.decoyCwd]) {
    rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
};

test('set-status finds the tracker under the configured data root', () => {
  const f = fixture();
  try {
    const r = run('set-status.mjs', ['1', 'Interview', '--note', 'data-root check'], f);
    assert.doesNotMatch(r.all, /No tracker found/i,
      `it looked in the checkout, not the data root:\n${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('set-status writes the new status into the data-root tracker', () => {
  const f = fixture();
  try {
    run('set-status.mjs', ['1', 'Interview', '--note', 'data-root check'], f);
    const tracker = readFileSync(join(f.dataRoot, 'data', 'applications.md'), 'utf-8');
    assert.match(tracker, /\|\s*Interview\s*\|/,
      `the status never reached the data-root tracker:\n${tracker}`);
    assert.doesNotMatch(tracker, /\|\s*Applied\s*\|/, 'the old status is still there');
  } finally { cleanup(f); }
});

test('set-status does not create a tracker in the checkout or the cwd', () => {
  const f = fixture();
  try {
    run('set-status.mjs', ['1', 'Interview'], f);
    assert.ok(!existsSync(join(f.decoyCwd, 'applications.md')), 'wrote a tracker into the cwd');
    assert.ok(!existsSync(join(f.decoyCwd, 'data', 'applications.md')), 'wrote data/ into the cwd');
  } finally { cleanup(f); }
});

test('generate-pdf does not treat the data root as outside its workspace', () => {
  const f = fixture();
  try {
    const r = run('generate-pdf.mjs', [join(f.dataRoot, 'output', 'cv.html'), join(f.dataRoot, 'output', 'cv.pdf')], f);
    // Asserting the ABSENCE of the containment refusal, not a finished PDF, so
    // this stays meaningful on a machine with no Chromium available.
    assert.doesNotMatch(r.all, /Refusing to write the PDF outside the tracker workspace/i,
      `the containment boundary came from the code directory, not the data root:\n${r.all.slice(0, 500)}`);
    assert.doesNotMatch(r.all, /escapes the tracker workspace/i,
      `a path inside the data root was reported as an escape:\n${r.all.slice(0, 500)}`);
  } finally { cleanup(f); }
});
