// A profile can name spend_tier, language.output, and cv.output_format and
// still be ignored. batch/batch-runner.sh falls back to standard, profile
// language folds a non-string into English, and a CV format other than
// html, latex, or text takes the PDF path. validate-profile used to exit 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProfile, EXAMPLE_PATH } from '../validate-profile.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXAMPLE = readFileSync(EXAMPLE_PATH, 'utf8');

const BROKEN = [
  'spend_tier: gold',
  'language:',
  '  output: 12',
  'cv:',
  '  output_format: 1',
  'notes: kept',
  '',
].join('\n');

test('a bad known value names the file, the key, and an example', () => {
  const { findings } = validateProfile(BROKEN, EXAMPLE);
  const errors = findings.filter((f) => f.level === 'error');
  assert.equal(errors.length, 3, JSON.stringify(findings));
  const spend = errors.find((f) => f.key === 'spend_tier');
  const output = errors.find((f) => f.key === 'language.output');
  const format = errors.find((f) => f.key === 'cv.output_format');
  assert.ok(spend && output && format);
  for (const hit of [spend, output, format]) {
    assert.match(hit.message, /config\/profile\.yml/);
    assert.match(hit.message, /Example:/);
  }
  assert.match(spend.message, /spend_tier: standard/);
  assert.match(output.message, /output: en/);
  assert.match(format.message, /output_format: html/);
  assert.equal(findings.filter((f) => f.code === 'unknown-key').length, 1);
});

test('case variants and omitted keys stay valid', () => {
  const mixed = validateProfile('spend_tier: Standard\nlanguage:\n  output: EN\ncv:\n  output_format: HTML\n', EXAMPLE);
  assert.deepEqual(mixed.findings, []);
  const empty = validateProfile('candidate:\n  full_name: A\n', EXAMPLE);
  assert.deepEqual(empty.findings, []);
});

test('the cli exits 2 for a bad spend tier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-profile-'));
  try {
    const profile = join(dir, 'profile.yml');
    writeFileSync(profile, 'spend_tier: gold\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'validate-profile.mjs'), '--profile', profile, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(r.status, 2, r.stderr);
    const body = JSON.parse(r.stdout);
    assert.equal(body.findings[0].key, 'spend_tier');
    assert.match(body.findings[0].message, /spend_tier: standard/);
    assert.match(body.findings[0].message, /profile\.yml/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
