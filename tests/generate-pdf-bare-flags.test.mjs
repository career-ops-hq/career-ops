// tests/generate-pdf-bare-flags.test.mjs — generate-pdf refuses `--format` and
// `--batch` written without `=`, instead of dropping them.
//
// The parse loop read both only as `--format=<sheet>` and `--batch=<manifest>`.
// A bare one fell through to the positional arms and, once the input and output
// paths were set, was discarded with its value at exit 0: `--format letter`
// rendered on the profile's sheet, and `in.html out.pdf --batch m.json` rendered
// the single file and never read the manifest. #3959 gave --kind and --report a
// bare-form guard and named --batch, --format and --max-pages as still open;
// --country and --max-pages have one since. This closes the last two.
//
// Run:  node --test tests/generate-pdf-bare-flags.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const workspaces = [];
after(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
});

// A workspace whose profile prints on A4, so a dropped `--format letter` shows.
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-pdf-bare-flags-'));
  workspaces.push(dir);
  for (const sub of ['config', 'data', 'output']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, 'config', 'profile.yml'), 'name: Test Candidate\npage_format: a4\n');
  return dir;
}

// The input does not exist: every case here must stop before it is read.
function runPdf(...flags) {
  const dir = workspace();
  const env = { ...process.env };
  // Any inherited path override would point the run at the developer's files.
  // Environment names are case-insensitive on Windows, so every spelling goes.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = dir;
  return spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs'), join(dir, 'absent.html'), join(dir, 'output', 'cv.pdf'), ...flags], {
    env, encoding: 'utf-8', timeout: 30000,
  });
}

test('a bare --format fails instead of falling back to the profile sheet', () => {
  for (const flags of [['--format', 'letter'], ['--format']]) {
    const res = runPdf(...flags);
    assert.equal(res.status, 1, describeSpawn(res));
    assert.match(res.stderr, /Invalid format ""/, describeSpawn(res));
    // On main the run printed "📏 Format: A4" here, the profile's sheet.
    assert.doesNotMatch(res.stdout, /📏 Format:/, describeSpawn(res));
  }
});

test('a bare or empty --batch fails instead of rendering the positional paths', () => {
  for (const flags of [['--batch', 'manifest.json'], ['--batch'], ['--batch=']]) {
    const res = runPdf(...flags);
    assert.equal(res.status, 1, describeSpawn(res));
    assert.match(res.stderr, /Invalid --batch ""/, describeSpawn(res));
    assert.doesNotMatch(res.stdout, /📏 Format:/, describeSpawn(res));
  }
});

test('the = spellings are unchanged', () => {
  const format = runPdf('--format=letter');
  assert.match(format.stdout, /📏 Format: LETTER/, describeSpawn(format));
  const batch = runPdf('--batch=missing-manifest.json');
  assert.doesNotMatch(batch.stderr, /Invalid --batch/, describeSpawn(batch));
});
