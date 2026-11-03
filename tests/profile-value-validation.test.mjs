// A profile can name spend_tier, language.output, and cv.output_format and
// still be ignored. batch/batch-runner.sh falls back to standard, profile
// language folds a non-string into English, and a CV format other than
// html, latex, or text takes the PDF path. validate-profile used to exit 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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
  const { findings } = validateProfile(BROKEN, EXAMPLE, 'config/profile.yml');
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
  const mixed = validateProfile('spend_tier: Standard\nlanguage:\n  output: EN\ncv:\n  output_format: HTML\n', EXAMPLE, 'config/profile.yml');
  assert.deepEqual(mixed.findings, []);
  const empty = validateProfile('candidate:\n  full_name: A\n', EXAMPLE, 'config/profile.yml');
  assert.deepEqual(empty.findings, []);
});

const errorKeys = (text) => validateProfile(text, EXAMPLE, 'config/profile.yml')
  .findings.filter((f) => f.level === 'error').map((f) => f.key);

test('latex and text must be exact, since the pipeline matches them as written', () => {
  for (const ok of ['latex', 'text', '" html "']) {
    assert.deepEqual(errorKeys(`cv:\n  output_format: ${ok}\n`), [], ok);
  }
  for (const bad of ['LaTeX', '" latex "', '" text "', 'Text', 'pdf']) {
    assert.deepEqual(errorKeys(`cv:\n  output_format: ${bad}\n`), ['cv.output_format'], bad);
  }
  const spaced = validateProfile('cv:\n  output_format: " latex "\n', EXAMPLE, 'config/profile.yml');
  assert.match(spaced.findings[0].message, /is " latex "/);
});

test('language.output allows 64 characters and one line only', () => {
  assert.deepEqual(errorKeys(`language:\n  output: ${'a'.repeat(64)}\n`), []);
  assert.deepEqual(errorKeys(`language:\n  output: ${'a'.repeat(65)}\n`), ['language.output']);
  assert.deepEqual(errorKeys('language:\n  output: "en\\nfr"\n'), ['language.output']);
});

test('language and cv must be mappings', () => {
  assert.deepEqual(errorKeys('language: en\n'), ['language']);
  assert.deepEqual(errorKeys('cv:\n  - html\n'), ['cv']);
});

test('a present but blank value is an error', () => {
  assert.deepEqual(errorKeys('spend_tier: ""\n'), ['spend_tier']);
  assert.deepEqual(errorKeys('language:\n  output: "  "\n'), ['language.output']);
  assert.deepEqual(errorKeys('cv:\n  output_format: ""\n'), ['cv.output_format']);
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

function doctorProfileWarning(t, profile) {
  const dir = mkdtempSync(join(tmpdir(), 'co-profile-doctor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'profile.yml'), profile);
  // The scratch root has no CV or portals, so doctor exits 1. Only the
  // profile line matters here, and --json does not carry it.
  const r = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--target', dir], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '' },
  });
  const line = r.stdout.split('\n').find((l) => l.includes('config/profile.yml: '));
  assert.ok(line, r.stdout + r.stderr);
  return line;
}

test('doctor calls a bad value a bad value, not an unrecognized key', (t) => {
  const bad = doctorProfileWarning(t, 'spend_tier: gold\n');
  assert.match(bad, /1 issue — known settings hold values the readers ignore/);
  const unknown = doctorProfileWarning(t, 'spend_teir: standard\n');
  assert.match(unknown, /settings under an unrecognized key have no effect/);
  const both = doctorProfileWarning(t, 'spend_tier: gold\nspend_teir: standard\n');
  assert.match(both, /2 issues — unrecognized keys and invalid values have no effect/);
});

test('doctor --target names the target profile even with CAREER_OPS_PROFILE set', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'co-profile-target-'));
  const other = mkdtempSync(join(tmpdir(), 'co-profile-other-'));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'profile.yml'), 'spend_tier: gold\n');
  const elsewhere = join(other, 'elsewhere.yml');
  writeFileSync(elsewhere, 'spend_tier: standard\n');
  const r = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--target', dir], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: elsewhere },
  });
  const out = r.stdout + r.stderr;
  assert.match(out, /config\/profile\.yml: spend_tier/, out);
  assert.doesNotMatch(out, /elsewhere\.yml: spend_tier/, out);
});

test('doctor names a CAREER_OPS_PROFILE outside the root in the warning summary', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'co-profile-root-'));
  const other = mkdtempSync(join(tmpdir(), 'co-profile-other-'));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'profile.yml'), 'spend_tier: standard\n');
  const elsewhere = join(other, 'elsewhere.yml');
  writeFileSync(elsewhere, 'spend_tier: gold\n');
  const r = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs')], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: elsewhere },
  });
  const out = r.stdout + r.stderr;
  const summary = out.split('\n').find((l) => l.includes('1 issue —'));
  assert.ok(summary, out);
  assert.ok(summary.includes(`${elsewhere}: 1 issue`), summary);
  assert.doesNotMatch(summary, /config\/profile\.yml/);
});
