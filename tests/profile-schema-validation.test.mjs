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
  // rejection_latency and table_freshness have real readers. Warning on them
  // would flag a correct profile — the failure mode that makes a validator
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

test('a section the example ships commented out is known, not "no effect"', () => {
  // style (#1837) and page_format (#4405) are documented only as commented-out
  // blocks, and theme-style.mjs / lib/page-format.mjs read them. Deriving keys
  // from the parsed example alone told a user who set them that the setting had
  // no effect. scan is the same case: the example shows `# scan:`.
  const profile = [
    'candidate:', '  full_name: X',
    'page_format: a4',
    'style:', '  accent_color: "#2563eb"',
    'scan:', '  extractor: cli',
    '',
  ].join('\n');
  assert.deepEqual(validateProfile(profile, EXAMPLE).findings, []);
});

test('prose comments and keys nested in a commented block are not top-level keys', () => {
  // Lines taken from the shipped example. A looser rule (`#`, any spaces, then
  // `word:`) also matches every nested key there, so a misplaced top-level
  // `margin:`, which theme-style.mjs never reads, would pass as known.
  const example = [
    'candidate:',
    '  full_name: x',
    '  # title: "Senior Backend Engineer"',
    '# Controls which model tier evaluates your offers. Valid values:',
    '# Default (key absent OR commented out): 3.0',
    '# greeting_max_chars is the hard character budget for that message. Default when',
    '# style:',
    '#   accent_color:    "#2563eb"           # section headings, competency tags, project badges',
    '#   margin:          "0.5in"             # page margin (@page)',
    '',
  ].join('\n');
  assert.deepEqual(knownKeysFromExample(example), ['candidate', 'style']);
  const { findings } = validateProfile('margin: "0.5in"\n', example);
  assert.equal(findings.find((f) => f.code === 'unknown-key')?.key, 'margin');
});

test('a misspelled commented-out section still gets its suggestion', () => {
  const { findings } = validateProfile('styel:\n  accent_color: "#2563eb"\npage_fromat: a4\n', EXAMPLE);
  const unknown = findings.filter((f) => f.code === 'unknown-key');
  assert.equal(unknown.length, 2, `expected both typos: ${JSON.stringify(findings)}`);
  assert.equal(unknown.find((f) => f.key === 'styel')?.suggestion, 'style');
  assert.equal(unknown.find((f) => f.key === 'page_fromat')?.suggestion, 'page_format');
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
    // page_format and style are documented as commented-out sections, so a
    // profile that sets them is as clean as one that does not.
    writeFileSync(join(dir, 'config', 'profile.yml'),
      'language:\n  output: ja\npage_format: a4\nstyle:\n  accent_color: "#2563eb"\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--target', dir], {
      cwd: dir, encoding: 'utf-8', timeout: 60_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /profile\.yml: \d+ issue/, 'a correct profile was warned about');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
