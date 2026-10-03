// tests/profile-schema-validation.test.mjs — config/profile.yml is the one
// config file nothing checked the shape of.
//
// It steers scoring targets, output language, spend tier, CV format and
// location policy. doctor.mjs checked that it EXISTS; every reader then does
// `profile?.language?.output` and takes the fallback when the key is absent —
// which is indistinguishable from the key being MISSPELLED:
//
//     langauge:          # <- parses cleanly, validates nowhere
//       output: ja
//     spend_teir: premium
//
// English output at the default tier, no signal anywhere. The user's only clue
// is noticing the wrong language in finished work.
//
// portals.yml has validate-portals.mjs and the plugin registry has
// validate-plugin-registry.mjs; this is the same family for the file that had
// none.
//
// Run:  node --test tests/profile-schema-validation.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { validateProfile, knownKeysFromExample, UNDOCUMENTED_KEYS, EXAMPLE_PATH } =
  await import(pathToFileURL(join(ROOT, 'validate-profile.mjs')).href);

const EXAMPLE = existsSync(EXAMPLE_PATH) ? readFileSync(EXAMPLE_PATH, 'utf-8') : '';

test('a misspelled key is named, with the key it was probably meant to be', () => {
  const { findings } = validateProfile('langauge:\n  output: ja\nspend_teir: premium\n', EXAMPLE);
  const unknown = findings.filter((f) => f.code === 'unknown-key');
  assert.equal(unknown.length, 2, `expected both typos: ${JSON.stringify(findings)}`);
  assert.equal(unknown.find((f) => f.key === 'langauge')?.suggestion, 'language');
  assert.equal(unknown.find((f) => f.key === 'spend_teir')?.suggestion, 'spend_tier');
});

test('the real shipped example validates clean against itself', () => {
  // The strongest guard available: if the example a user is told to copy would
  // itself warn, the check is wrong, not the user.
  assert.ok(EXAMPLE.trim(), 'config/profile.example.yml is missing or empty');
  assert.deepEqual(validateProfile(EXAMPLE, EXAMPLE).findings, []);
});

test('keys the code reads but the example omits are not called unknown', () => {
  // rejection_latency and table_freshness have real readers. Warning on
  // them would flag a correct profile — the failure mode that makes a validator
  // something users learn to ignore.
  for (const key of Object.keys(UNDOCUMENTED_KEYS)) {
    const { findings } = validateProfile(`${key}:\n  x: 1\n`, EXAMPLE);
    assert.ok(
      !findings.some((f) => f.code === 'unknown-key'),
      `${key} was reported unknown despite having a reader: ${JSON.stringify(findings)}`,
    );
  }
});

test('and their absence from the example is reported rather than hidden', () => {
  const { findings } = validateProfile('rejection_latency:\n  courtesy_days: 45\n', EXAMPLE);
  const undoc = findings.find((f) => f.code === 'undocumented-key');
  assert.ok(undoc, 'the doc gap was swallowed');
  assert.match(undoc.message, /rejection-latency\.mjs/, 'the finding does not name the reader');
});

test('the known-key set is derived from the example, not hardcoded here', () => {
  // A key added to config/profile.example.yml must be understood on the same
  // commit. A hardcoded roster can only chase the example, and drifts.
  const widened = `${EXAMPLE}\nbrand_new_section:\n  x: 0\n`;
  assert.deepEqual(validateProfile('brand_new_section:\n  x: 1\n', widened).findings, []);
  assert.ok(knownKeysFromExample(widened).includes('brand_new_section'));
});

test('opt-in keys the example ships commented out are not called unknown (#4736)', () => {
  // Every optional section in the example is a commented-out block, and the
  // YAML parser drops comments. "Validates clean against itself" above passes
  // only because those blocks stay commented; a user who enables one exactly as
  // shown was told the setting "has no effect" while it was in fact being read.
  // These two have readers in modes/pipeline.md and modes/_shared.md.
  for (const key of ['auto_pdf_score_threshold', 'culture_screen', 'page_format', 'style', 'scan']) {
    assert.match(EXAMPLE, new RegExp(`^# ?${key}:`, 'm'), `${key} is no longer a commented block in the example`);
    const { findings } = validateProfile(`${key}: 1\n`, EXAMPLE);
    assert.deepEqual(findings, [], `${key} was reported: ${JSON.stringify(findings)}`);
  }
});

test('the shipped example with every opt-in block uncommented still validates clean', () => {
  // The strongest form of the self-validation guard: un-comment each column-0
  // `# key:` block (and its indented `#   ...` body) and re-validate.
  const lines = EXAMPLE.split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^# ?[a-z_][a-z0-9_]*:(\s|$)/.test(line)) { out.push(line.replace(/^# ?/, '')); inBlock = true; continue; }
    if (inBlock && /^#\s{2,}\S/.test(line)) { out.push(line.replace(/^# ?/, '')); continue; }
    inBlock = false;
    out.push(line);
  }
  const uncommented = out.join('\n');
  assert.notEqual(uncommented, EXAMPLE, 'the example no longer has commented opt-in blocks to exercise');
  // All findings, not just unknown-key: an uncommented example that stopped
  // parsing would otherwise pass this test vacuously.
  const { findings } = validateProfile(uncommented, EXAMPLE);
  assert.deepEqual(findings, [], `the uncommented example produced findings: ${JSON.stringify(findings)}`);
});

test('commented prose and nested commented keys are not mistaken for top-level keys', () => {
  const example = 'candidate:\n  full_name: x\n# Optional. Note: this is prose\n#   nested_only: 1\n#e.g.: nope\n';
  const keys = knownKeysFromExample(example);
  assert.deepEqual(keys.sort(), ['candidate'], `unexpected keys: ${keys}`);
});

test('empty, comment-only and absent profiles are not errors', () => {
  // Legitimate starting states. doctor's existence check owns "not set up yet";
  // this one must not double-report it as a shape problem.
  for (const text of ['', '\n', '# nothing here yet\n']) {
    assert.deepEqual(validateProfile(text, EXAMPLE).findings, [], `"${text}" was reported`);
  }
});

test('a malformed or non-mapping profile is reported as such', () => {
  assert.equal(validateProfile('\tbroken: tab\n', EXAMPLE).findings[0]?.code, 'unparseable');
  assert.equal(validateProfile('just a string\n', EXAMPLE).findings[0]?.code, 'not-a-mapping');
});

test('doctor surfaces it as a warning, and does not fail the run', () => {
  // WARN not FAIL: an unknown key is a typo, not a broken install. Refusing to
  // run would be a worse answer than naming it.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-profile-shape-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config', 'profile.yml'), 'langauge:\n  output: ja\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--target', dir], {
      cwd: dir, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    const all = `${r.stdout}${r.stderr}`;
    assert.match(all, /config\/profile\.yml: 1 issue/, `doctor did not report the typo:\n${all.slice(0, 600)}`);
    assert.match(all, /did you mean "language"/, 'doctor did not carry the suggestion through');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a clean profile adds no doctor noise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-profile-clean-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config', 'profile.yml'), 'language:\n  output: ja\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--target', dir], {
      cwd: dir, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /profile\.yml: \d+ issue/, 'a correct profile was warned about');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
