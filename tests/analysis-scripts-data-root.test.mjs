// tests/analysis-scripts-data-root.test.mjs — the analysis scripts read the
// USER's data root, not the directory they happen to live in (#3510's family).
//
// #3511 fixed this for the scanners and added a structural guard against a new
// bare cwd-relative literal. These three had a different spelling of the same
// bug and that guard does not see it: the constant was named CAREER_OPS and
// assigned `dirname(fileURLToPath(import.meta.url))`, so it reads as the
// project root and is in fact the CODE root. Both documented overrides —
// CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR and the .career-ops-data marker — were
// ignored, and getCareerOpsRoot() is the only thing that honours them.
//
// The failures were quiet in the way that matters:
//
//   funnel-velocity   "No tracker found at <CHECKOUT>/applications.md"
//   calibrate         "... nothing to calibrate yet"   <- reads as "you have no data"
//   weekly-digest     "no session files fall inside this range"  <- blames the DATES
//
// Each runs in a child with the data root and the cwd pointed at DIFFERENT
// directories. A path following the cwd or the checkout finds nothing; one
// following the data root finds the fixture. If those were the same directory
// this suite could not tell them apart, which is exactly how the drift survived.
//
// Run:  node --test tests/analysis-scripts-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-analysisroot-'));
  const decoyCwd = mkdtempSync(join(tmpdir(), 'career-ops-analysiscwd-'));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(join(dataRoot, 'interview-prep', 'sessions'), { recursive: true });
  writeFileSync(join(dataRoot, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-01-05 | Acme | Backend Engineer | 4.2/5 | Applied | ✅ | [1](r1.md) | n |',
    '| 2 | 2026-02-05 | Globex | ML Engineer | 4.4/5 | Interview | ✅ | [2](r2.md) | n |',
    '',
  ].join('\n'));
  writeFileSync(join(dataRoot, 'interview-prep', 'sessions', 'acme-backend-r1.md'), [
    '---', 'company: Acme', 'role: Backend Engineer', 'round: 1',
    'date: 2026-08-26', 'competencies: [system-design]', '---', 'Round 1 notes.', '',
  ].join('\n'));
  return { dataRoot, decoyCwd };
}

function run(script, args, { dataRoot, decoyCwd }) {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: decoyCwd,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const cleanup = (f) => {
  for (const d of [f.dataRoot, f.decoyCwd]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};

test('funnel-velocity reads the configured data root', () => {
  const f = fixture();
  try {
    const r = run('funnel-velocity.mjs', ['--summary'], f);
    assert.doesNotMatch(r.all, /No tracker found/i, `it looked in the checkout, not the data root:\n${r.all.slice(0, 400)}`);
    assert.match(r.all, /Funnel Calibration/i, `no report was produced:\n${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('calibrate reads the configured data root', () => {
  const f = fixture();
  try {
    const r = run('calibrate.mjs', ['--summary'], f);
    assert.doesNotMatch(
      r.all,
      /No tracker found/i,
      'calibrate reported no tracker — for the advisory that answers "do my scores predict outcomes", '
      + `that reads as "you have no data":\n${r.all.slice(0, 400)}`,
    );
  } finally { cleanup(f); }
});

test('weekly-digest reads the configured data root', () => {
  const f = fixture();
  try {
    const r = run('weekly-digest.mjs', ['--summary', '--from', '2026-08-24', '--to', '2026-08-30'], f);
    assert.match(
      r.all,
      /Sessions:\s+1 in range/,
      'the digest found no sessions. Note the message it prints instead blames the date range for a '
      + `directory it never opened:\n${r.all.slice(0, 400)}`,
    );
  } finally { cleanup(f); }
});

test('and none of them writes into the cwd it was launched from', () => {
  // A path that follows the cwd would create its data/ there. Nothing here is a
  // writer, so the decoy must come back untouched.
  const f = fixture();
  try {
    run('funnel-velocity.mjs', ['--summary'], f);
    run('calibrate.mjs', ['--summary'], f);
    run('weekly-digest.mjs', ['--summary'], f);
    assert.deepEqual(readdirSync(f.decoyCwd), [], 'a script wrote into the directory it was launched from');
  } finally { cleanup(f); }
});

test('system files still resolve from the CODE root, not the data root', () => {
  // The other half of the split. funnel-velocity reads templates/states.yml and
  // templates/benchmarks.yml, which ship with the code and are NOT in the user's
  // data root — pointing everything at DATA_ROOT would have broken those.
  const f = fixture();
  try {
    const r = run('funnel-velocity.mjs', ['--summary'], f);
    assert.doesNotMatch(r.all, /states\.yml|benchmarks\.yml/i, `a system template was reported missing:\n${r.all.slice(0, 400)}`);
    assert.equal(r.status, 0, `exited ${r.status}: ${r.all.slice(0, 400)}`);
  } finally { cleanup(f); }
});

test('no analysis script derives a data path from its own directory', () => {
  // The structural half, in the spirit of #3511's check 6. That one greps for a
  // bare relative string literal; this spelling assigns __dirname to a constant
  // and joins user-layer paths onto it, which reads as correct and is not.
  const offenders = [];
  const USER_LAYER = /join\(\s*(CAREER_OPS|CODE_ROOT)\s*,\s*'(data|interview-prep|reports|output|jds|documents)[/']/;
  for (const file of ['funnel-velocity.mjs', 'calibrate.mjs', 'weekly-digest.mjs', 'stats.mjs', 'company-history.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    for (const line of src.split('\n')) {
      if (USER_LAYER.test(line)) offenders.push(`${file}: ${line.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], `user-layer path(s) joined onto the code root:\n${offenders.join('\n')}`);
});
