// tests/verify-cv-facts-magnitude-words.test.mjs — a magnitude written out as a
// word has to count as part of the number.
//
// verify-cv-facts.mjs reads a number together with the magnitude that follows it,
// so "50k users" cannot be produced as evidence for a CV that says "50 users"
// (#2612). The spelled-out spelling fell through to the modifier window instead,
// where the magnitude was consumed as an ordinary word and dropped on the floor:
//
//   metricClaims('Served 50 users.')         -> ['50 users']
//   metricClaims('Served 50 million users.') -> ['50 users']   <- "million" gone
//
// A source saying 50 users therefore read as evidence for a CV claiming 50 million
// of them, and the gate answered {invented: [], forbidden: []} — a clean verdict
// after the count had moved six orders of magnitude. "50 thousand users" went the
// same way. The reverse direction misfired too: a CV writing "50M users" against a
// source spelled "50 million users" was reported as invented, because the two
// spellings of one quantity never reached the same claim key.
//
// The fix folds each spelled magnitude onto the suffix it abbreviates
// (thousand->k, million->m, billion->b), so both spellings of one quantity produce
// one claim. This file covers the exported checker and the CLI verdict and exit
// code, since the gate is only ever consumed through the CLI.
//
// Run:  node --test tests/verify-cv-facts-magnitude-words.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { metricClaims, auditClaims } from '../verify-cv-facts.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ──────────────────────────────────────────────────────────── the exported checker

test('a spelled-out magnitude is part of the claim, not a dropped modifier', () => {
  assert.deepEqual([...metricClaims('Served 50 million users.')], ['50m users']);
  assert.deepEqual([...metricClaims('Served 50 thousand users.')], ['50k users']);
  assert.deepEqual([...metricClaims('Served 2 billion users.')], ['2b users']);
});

test('a plain count cannot support a spelled-out magnitude', () => {
  const source = 'Served 50 users.';
  assert.deepEqual(auditClaims('Served 50 million users.', source).invented, ['50m users']);
  assert.deepEqual(auditClaims('Served 50 thousand users.', source).invented, ['50k users']);
});

test('the two spellings of one quantity compare equal, both directions', () => {
  // The CV may write the suffix where the source spelled the magnitude out, or the
  // other way round. Neither is a different number.
  assert.deepEqual(auditClaims('Served 50M users.', 'Served 50 million users.').invented, []);
  assert.deepEqual(auditClaims('Served 50 million users.', 'Served 50M users.').invented, []);
  assert.deepEqual(auditClaims('Served 50k users.', 'Served 50 thousand users.').invented, []);
});

test('decimal magnitudes fold the same way', () => {
  // A decimal magnitude is where a naive "count the words" reading would also
  // mistake the fraction for the magnitude.
  assert.deepEqual([...metricClaims('Served 1.5 million customers.')], ['1.5m customers']);
  assert.deepEqual(auditClaims('Served 1.5 million customers.', 'Served 1.5M customers.').invented, []);
  assert.deepEqual(
    auditClaims('Served 1.5 million customers.', 'Served 50 customers.').invented,
    ['1.5m customers'],
  );
});

test('ordinary modifiers are not magnitudes', () => {
  // The control the magnitude branch must not swallow: a word in the same position
  // that is not a magnitude still normalizes away, exactly as it did before.
  assert.deepEqual([...metricClaims('Served 50 active users.')], ['50 users']);
  assert.deepEqual([...metricClaims('Served 50 millionaire users.')], ['50 users']);
  assert.deepEqual(auditClaims('Served 50 active users.', 'Served 50 users.').invented, []);
});

test('the adjacent-suffix behaviour is unchanged', () => {
  // The #2612 regression, kept as this change's control.
  assert.deepEqual([...metricClaims('Grew to 50k users')], ['50k users']);
  assert.deepEqual(auditClaims('Grew the product to 50k users', 'Reached 50 users.').invented, ['50k users']);
  assert.deepEqual([...metricClaims('Drove 1.5M downloads')], ['1.5m downloads']);
  // A unit that merely STARTS with a suffix letter is still not a suffix.
  assert.deepEqual([...metricClaims('Shipped 50kg servers')], ['50 servers']);
});

// ────────────────────────────────────────────────────────────────── the CLI gate

function run({ source, generated }, args = []) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-magnitude-'));
  writeFileSync(join(dataRoot, 'cv.md'), `# CV\n\n- ${source}\n`);
  writeFileSync(join(dataRoot, 'generated.md'), `# Generated CV\n\n- ${generated}\n`);
  try {
    const r = spawnSync(
      process.execPath,
      [join(ROOT, 'verify-cv-facts.mjs'), join(dataRoot, 'generated.md'), ...args],
      {
        cwd: dataRoot,
        encoding: 'utf-8',
        timeout: 60_000,
        env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' },
      },
    );
    assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
    return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('the CLI blocks a count inflated by a spelled-out magnitude', () => {
  const r = run({ source: 'Served 50 users.', generated: 'Served 50 million users.' });
  assert.equal(r.status, 1, `an inflated count passed the gate:\n${r.all.slice(0, 400)}`);
  assert.match(r.all, /absent from sources/i);
  assert.match(r.all, /50m users/);
});

test('the CLI passes the same fact written two equivalent ways', () => {
  const r = run({ source: 'Served 50 million users.', generated: 'Served 50M users.' });
  assert.equal(r.status, 0, `an equivalent restatement failed the gate:\n${r.all.slice(0, 400)}`);
  assert.match(r.all, /passed/i);
});

test('the CLI still passes a count the source states plainly', () => {
  const r = run({ source: 'Served 50 users.', generated: 'Served 50 users.' });
  assert.equal(r.status, 0, `a plain count failed the gate:\n${r.all.slice(0, 400)}`);
});

test('the CLI reports the magnitude claim in --json', () => {
  const r = run({ source: 'Served 50 users.', generated: 'Served 50 million users.' }, ['--json']);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.verdict, 'block');
  assert.deepEqual(parsed.invented, ['50m users']);
});
