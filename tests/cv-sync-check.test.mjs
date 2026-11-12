// tests/cv-sync-check.test.mjs — the setup validator has to reach its checks.
//
// cv-sync-check.mjs threw a ReferenceError at module scope (#3440): the
// CODE_ROOT/DATA_ROOT split left three `join(projectRoot, …)` call sites naming
// an identifier that no longer existed, so `npm run sync-check` died before the
// first check and printed a stack instead of a report.
//
// It sat because a crash and a correct run look identical from outside. The
// script exits 1 when cv.md is missing — which is normal in this repo — and
// exits 1 on a ReferenceError too. test-all.mjs's own entry says as much:
//
//   { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }
//
// (`expectExit` is not read by the runner at all; `allowFail` was doing the
// work, and it excused everything.) So this asserts what an exit code cannot:
// that the run produced the validator's REPORT rather than a stack trace.
//
// Run:  node --test tests/cv-sync-check.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Run the validator against a throwaway DATA root, leaving the repo alone. */
function runAgainst(dataRoot) {
  // Keep the validator off the developer's exported profile override: with
  // CAREER_OPS_PROFILE set in the parent shell, the child validator would read
  // that file instead of the fixture's config/profile.yml, and the profile
  // assertions would pass or fail on the developer's own data.
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };
  delete env.CAREER_OPS_PROFILE;
  const r = spawnSync(process.execPath, [join(ROOT, 'cv-sync-check.mjs')], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env,
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Node prints an uncaught error as `SomeError: …` plus a stack. */
function looksLikeCrash(text) {
  return /^[A-Za-z]*Error(?: \[[^\]]+\])?: /m.test(text) && /\n\s+at /.test(text);
}

test('it reaches its checks instead of throwing at module scope', () => {
  // The regression itself. Nothing here is about WHAT it reports — only that it
  // got far enough to report anything.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    const r = runAgainst(dir);
    assert.ok(!looksLikeCrash(r.all), `crashed instead of running:\n${r.all.slice(0, 400)}`);
    assert.match(r.stdout, /career-ops sync check/, 'no report header — the run never reached its checks');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a missing cv.md is reported as an error, not a crash', () => {
  // The legitimate non-zero exit, which is what makes the crash invisible: both
  // leave status 1. The difference is that this one says something useful.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    const r = runAgainst(dir);
    assert.equal(r.status, 1, describeSpawn(r));
    assert.match(r.stdout, /cv\.md not found/);
    assert.ok(!looksLikeCrash(r.all));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a complete setup passes', () => {
  // The other side, so "always errors" cannot satisfy the tests above.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'cv.md'), `# Jane Roe\n\n## Experience\n\n${'Backend engineer. '.repeat(12)}\n`);
    writeFileSync(join(dir, 'config', 'profile.yml'),
      'candidate:\n  full_name: "Jane Roe"\n  email: jane@example.com\n  location: Lisbon\n');
    const r = runAgainst(dir);
    assert.ok(!looksLikeCrash(r.all), r.all.slice(0, 400));
    assert.equal(r.status, 0, describeSpawn(r, `expected a clean pass, got ${r.status}:\n${r.all.slice(0, 400)}`));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('the prompt-file checks read the CODE root, not the data root', () => {
  // What the three broken call sites were for. modes/ and batch/ ship with the
  // code, so an externalized data root (the whole point of CAREER_OPS_ROOT)
  // must not make them unreadable — pointing DATA_ROOT at an empty directory
  // must not produce "file not found" warnings for them.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    const r = runAgainst(dir);
    for (const name of ['_shared.md', '_writing.md', 'batch-prompt.md']) {
      assert.doesNotMatch(r.all, new RegExp(`${name.replace('.', '\\.')} not found`),
        `${name} was looked for under the DATA root instead of the code root`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('the shipped prompt files raise no hardcoded-metric warning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    const r = runAgainst(dir);
    assert.match(r.stdout, /career-ops sync check/);
    assert.doesNotMatch(r.stdout, /Possible hardcoded metric/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('a candidate metric is flagged and a time window is not', async () => {
  const { hardcodedMetrics } = await import('../cv-sync-check.mjs');
  const found = (line) => hardcodedMetrics(line).map(m => m.match);
  assert.deepEqual(found('Saved 170+ hours of manual review'), ['170+ hours']);
  assert.deepEqual(found('Wrote 300+ tests for the billing service'), ['300+ tests']);
  assert.deepEqual(found('A hit requires facts **less than 24 hours** old'), []);
  assert.deepEqual(found('Re-check the posting within 48 hours'), []);
  assert.deepEqual(found('Refresh the cache every 12 hours'), []);
  assert.deepEqual(found('Facts captured 36 hours ago are stale'), []);
  assert.deepEqual(found('Facts 72 hours old are stale'), []);
});

test('importing the module runs no checks', async () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(ROOT, 'cv-sync-check.mjs')).href)}); console.log('imported');`], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(r.status, 0, describeSpawn(r, r.stderr));
  assert.equal(r.stdout.trim(), 'imported');
});

// The profile check used to ask whether the file CONTAINED the string
// `"Jane Smith"`. The shipped template documents optional fields with
// commented-out examples, including `#   # signature_name: "Jane Smith"`, so a
// fully filled-in profile that kept the template's comments still warned — and
// named `full_name`, the first field checked, rather than the comment that
// matched. Reported as "is my name wrong?"; it was not.

/** Run the validator against a throwaway root holding `profileBody`. */
function runWithProfile(profileBody) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-check-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'cv.md'), `# Jane Roe\n\n## Experience\n\n${'Backend engineer. '.repeat(12)}\n`);
    writeFileSync(join(dir, 'config', 'profile.yml'), profileBody);
    return runAgainst(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

test('a commented-out template example is not mistaken for an unedited field', () => {
  const r = runWithProfile([
    'candidate:',
    '  full_name: "Jane Roe"',
    '  email: "jane@example.com"',
    '  location: "Lisbon"',
    '',
    '#   # signature_name: "Jane Smith"',
    '',
  ].join('\n'));
  assert.doesNotMatch(r.all, /may still have example data/,
    `a comment tripped the check:\n${r.all.slice(0, 400)}`);
  assert.equal(r.status, 0, describeSpawn(r));
});

test('a profile still carrying the template values does warn, naming the field', () => {
  const r = runWithProfile([
    'candidate:',
    '  full_name: "Jane Smith"',
    '  email: "jane@example.com"',
    '  location: "Lisbon"',
    '',
  ].join('\n'));
  assert.match(r.all, /Check field: full_name/,
    `the real unedited-template case was not reported:\n${r.all.slice(0, 400)}`);
});

test('a missing required field is reported by name', () => {
  const r = runWithProfile([
    'candidate:',
    '  full_name: "Jane Roe"',
    '  email: "jane@example.com"',
    '',
  ].join('\n'));
  assert.match(r.all, /Check field: location/,
    `a missing field was not named:\n${r.all.slice(0, 400)}`);
});

// A required field holding a YAML mapping used to pass: String({first: 'Jane'})
// is "[object Object]", which is non-empty and not the template name. Same for a
// bare number. Both are unusable values for these fields, so both must warn.
test('a non-string required field is rejected, not stringified', () => {
  const mapping = runWithProfile([
    'candidate:',
    '  full_name: {first: Jane}',
    '  email: "jane@example.com"',
    '  location: "Lisbon"',
    '',
  ].join('\n'));
  assert.match(mapping.all, /Check field: full_name/,
    `a mapping was accepted as a name:\n${mapping.all.slice(0, 400)}`);
  assert.match(mapping.all, /not a text value/,
    `the reason did not say the value is not text:\n${mapping.all.slice(0, 400)}`);
  assert.doesNotMatch(mapping.all, /\[object Object\]/, 'the mapping was stringified');

  const numeric = runWithProfile([
    'candidate:',
    '  full_name: "Jane Roe"',
    '  email: 12345',
    '  location: "Lisbon"',
    '',
  ].join('\n'));
  assert.match(numeric.all, /Check field: email/,
    `a number was accepted as an email:\n${numeric.all.slice(0, 400)}`);
});

// An empty or whitespace-only string is a text value with no content, so the
// warning must say "missing or empty" rather than "not a text value".
test('an empty or blank string is reported as missing, not as a wrong type', () => {
  for (const blank of ['""', '"   "']) {
    const r = runWithProfile([
      'candidate:',
      `  full_name: ${blank}`,
      '  email: "jane@example.com"',
      '  location: "Lisbon"',
      '',
    ].join('\n'));
    assert.match(r.all, /Check field: full_name \(missing or empty\)/,
      `full_name: ${blank} was not reported as empty:\n${r.all.slice(0, 400)}`);
    assert.doesNotMatch(r.all, /not a text value/,
      `full_name: ${blank} was reported as a wrong type:\n${r.all.slice(0, 400)}`);
  }
});

// A profile holding only the template's comments is an empty config, not a
// parse error (js-yaml 5 throws on it; loadYaml returns null). It must warn
// about the missing field, not about unparseable YAML.
test('a comment-only profile warns about the missing field, not a parse error', () => {
  const r = runWithProfile([
    '# Career-Ops Profile Configuration',
    '# candidate:',
    '#   full_name: "Jane Smith"',
    '',
  ].join('\n'));
  assert.match(r.all, /Check field: full_name/,
    `a comment-only profile did not warn about the field:\n${r.all.slice(0, 400)}`);
  assert.doesNotMatch(r.all, /could not be parsed/,
    `an empty document was reported as malformed:\n${r.all.slice(0, 400)}`);
});
