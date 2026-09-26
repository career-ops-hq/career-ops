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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, copyFileSync, symlinkSync } from 'node:fs';
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
    assert.doesNotMatch(r.all, /Refusing to write the PDF outside the tracker workspace/i,
      `the containment boundary came from the code directory, not the data root:\n${r.all.slice(0, 500)}`);
    assert.doesNotMatch(r.all, /escapes the tracker workspace/i,
      `a path inside the data root was reported as an escape:\n${r.all.slice(0, 500)}`);

    // Positive proof that the containment checks actually RAN and passed, not
    // merely that their message is absent: generate-pdf.mjs prints this line
    // only after assertInsideWorkspace() has cleared the input and the output
    // (generate-pdf.mjs:1325-1335). Without it a child that died earlier would
    // satisfy both doesNotMatch assertions vacuously. (CodeRabbit, PR #4486.)
    assert.match(r.all, /\u{1F4C4} Input:/u,
      `validation never got far enough to report its input, so the assertions above prove `
      + `nothing:\n${r.all.slice(0, 500)}`);

    // Past that marker the browser launches, so a machine with no Chromium may
    // still fail here. That is tolerated; anything failing EARLIER is not.
    if (r.status !== 0) {
      assert.match(r.all, /browser|chromium|playwright|executable|Failed to launch/i,
        `generate-pdf failed after validation for an unexpected reason:\n${r.all.slice(0, 500)}`);
    }
  } finally { cleanup(f); }
});

// ── the .career-ops-data marker ─────────────────────────────────────────────
//
// The cases above drive CAREER_OPS_ROOT, which is precedence rule 1. #4389 was
// reported against the MARKER, which is rule 3, and no existing suite exercises
// it for either of these scripts. Both rules end at the same getCareerOpsRoot()
// call, but only a marker case proves that path end to end.
//
// The marker has to live beside the script, so the script is run from a COPIED
// code root rather than the checkout -- writing .career-ops-data into the repo
// would leak into other tests and survive a crash. Same shape as
// tests/story-provenance-data-root.test.mjs.

// Local import closure of each script, measured from its `from './...'`
// specifiers. Small enough to copy; kept explicit so a new import that is not
// copied fails loudly here instead of silently resolving to the checkout.
const CLOSURE = {
  'set-status.mjs': [
    'set-status.mjs', 'path-resolver.mjs', 'tracker-utils.mjs', 'pipeline-lock.mjs',
    'tracker-parse.mjs', 'lib/local-today.mjs', 'role-matcher.mjs', 'templates/states.yml',
    // Runtime assets, not imports: an import scan does not see these and each
    // one only announces itself by crashing the child.
    'tracker-aliases.json',
  ],
  'generate-pdf.mjs': [
    'generate-pdf.mjs', 'path-resolver.mjs', 'tracker-utils.mjs', 'pipeline-lock.mjs',
    'tracker-parse.mjs', 'theme-style.mjs', 'lib/page-format.mjs', 'lib/is-main-module.mjs',
    'cv-sections-core.mjs',
    'tracker-aliases.json',
  ],
};

function markerFixture(script) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-marker-')));
  const codeRoot = join(dir, 'code');
  const dataRoot = join(dir, 'data');
  for (const sub of ['lib', 'templates']) mkdirSync(join(codeRoot, sub), { recursive: true });
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(join(dataRoot, 'output'), { recursive: true });

  for (const file of CLOSURE[script]) copyFileSync(join(ROOT, file), join(codeRoot, file));
  // generate-pdf.mjs imports playwright at module scope, so without this the
  // child dies before it can print anything and the assertions say nothing.
  try { symlinkSync(join(ROOT, 'node_modules'), join(codeRoot, 'node_modules'), 'dir'); } catch { /* already there */ }

  // The marker: rule 3. No CAREER_OPS_* variable is set when this is used.
  writeFileSync(join(codeRoot, '.career-ops-data'), `${dataRoot}\n`);

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
  return { dir, codeRoot, dataRoot };
}

function runFromCodeRoot(f, script, args) {
  const r = spawnSync(process.execPath, [join(f.codeRoot, script), ...args], {
    cwd: f.dir,
    encoding: 'utf-8',
    timeout: 120_000,
    // Every override blank on purpose: the marker must be what is doing the work.
    env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '' },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const markerCleanup = (f) => rmSync(f.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

test('set-status honours a .career-ops-data marker, not just CAREER_OPS_ROOT', () => {
  const f = markerFixture('set-status.mjs');
  try {
    const r = runFromCodeRoot(f, 'set-status.mjs', ['1', 'Interview', '--note', 'marker check']);
    // Positive first. Every assertion below is an ABSENCE, and a child that
    // died at module load satisfies all of them while proving nothing -- the
    // same vacuity CodeRabbit caught in the generate-pdf case on #4486.
    assert.equal(r.status, 0, `set-status exited ${r.status}:\n${r.all.slice(0, 600)}`);
    assert.doesNotMatch(r.all, /No tracker found/i,
      `the marker was ignored and it looked beside the script:\n${r.all.slice(0, 400)}`);
    const tracker = readFileSync(join(f.dataRoot, 'data', 'applications.md'), 'utf-8');
    assert.match(tracker, /\|\s*Interview\s*\|/, `the status never reached the marked tracker:\n${tracker}`);
  } finally { markerCleanup(f); }
});

test('generate-pdf honours a .career-ops-data marker for its workspace boundary', () => {
  const f = markerFixture('generate-pdf.mjs');
  try {
    const r = runFromCodeRoot(f, 'generate-pdf.mjs',
      [join(f.dataRoot, 'output', 'cv.html'), join(f.dataRoot, 'output', 'cv.pdf')]);
    assert.doesNotMatch(r.all, /escapes the tracker workspace/i,
      `a path inside the marked data root was reported as an escape:\n${r.all.slice(0, 500)}`);
    assert.match(r.all, /\u{1F4C4} Input:/u,
      `validation never reported its input, so the assertion above proves nothing:\n${r.all.slice(0, 500)}`);
  } finally { markerCleanup(f); }
});
