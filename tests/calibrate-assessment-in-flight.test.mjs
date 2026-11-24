// tests/calibrate-assessment-in-flight.test.mjs — a tracker row in Assessment
// is an application in flight, and calibrate counts it as one.
//
// computeCalibration() counted only Applied and Responded as in flight. The
// Assessment state (#4317) came later and sits between Responded and
// Interview, but it reached `else continue` beside Evaluated and SKIP, so the
// row left calibration without a word: "in flight (not counted)" was short by
// every application waiting on an online assessment, while stats.mjs listed
// the same rows as active.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { computeCalibration } from '../calibrate.mjs';

const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

const row = (num, status, score = 4.6) => ({ num, company: `C${num}`, score, status });

test('an Assessment row counts as in flight, like Applied and Responded', () => {
  const result = computeCalibration([row(1, 'Applied'), row(2, 'Assessment'), row(3, 'Responded'), row(4, 'Evaluated')], new Map());
  assert.equal(result.inFlight, 3);
  assert.equal(result.resolved, 0);
});

test('an Assessment row with a recorded outcome still resolves from it', () => {
  const journals = new Map([[2, { latestType: 'rejected', feedback: [] }]]);
  const result = computeCalibration([row(1, 'Applied'), row(2, 'Assessment')], journals);
  assert.equal(result.inFlight, 1);
  assert.equal(result.resolved, 1);
});

test('the report counts the Assessment row in flight', () => {
  const dir = mkdtempSync(join(tmpdir(), 'calibrate-assessment-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-09-01 | Acme | Data Engineer | 4.6/5 | Applied | ✅ | — | |',
    '| 2 | 2026-09-02 | Globex | Data Engineer | 4.6/5 | Assessment | ✅ | — | |',
    '| 3 | 2026-09-03 | Initech | Analyst | 4.7/5 | Responded | ✅ | — | |',
    '',
  ].join('\n'));
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = dir;
  const r = spawnSync(NODE, [join(ROOT, 'calibrate.mjs')], { cwd: dir, env, encoding: 'utf-8', timeout: 30000 });
  assert.equal(r.status, 0, describeSpawn(r));
  assert.match(r.stdout, /in flight \(not counted\): 3 /, describeSpawn(r));
});
