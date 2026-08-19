// tests/cli-flag-validation.test.mjs — CLIs must reject a mistyped flag
// instead of answering from their defaults (#2980).
//
// The failure class lib/cli-flags.mjs exists to end: an unrecognized flag is
// ignored, the value flag it was meant to be falls back to its default, and
// the script reports a result for inputs nobody asked for at exit 0. Already
// fixed in scan-ats-full.mjs (#1633/#1635), reply-watch.mjs (#2743/#2745),
// dedup-tracker.mjs (#2744/#2746), scan.mjs (#2270), doctor.mjs (#2874),
// and fix-slugs.mjs (#2980).
//
// HERMETIC: paths use tmpdir fixtures; nothing reads or writes the real data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function runScript(script, ...args) {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(r.error, undefined, `${script} failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `${script} was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// Each script paired with a realistic typo of one of ITS OWN flags
const SCRIPTS = [
  ['fix-slugs.mjs', '--dryrun'],
  ['fix-slugs.mjs', '--fle'],
];

for (const [script, typo] of SCRIPTS) {
  test(`${script} rejects ${typo} instead of falling back to its default`, () => {
    const r = runScript(script, typo, 'some-value');
    assert.equal(r.status, 1, `${script} ${typo} exited ${r.status}, want 1`);
    assert.match(r.all, /unrecognized flag/i, `${script} did not name the unrecognized flag`);
    assert.match(r.all, new RegExp(typo.replace(/^--/, '--')), `${script} did not echo ${typo} back`);
  });
}


test('fix-slugs.mjs --help exits 0 and prints usage', () => {
  const r = runScript('fix-slugs.mjs', '--help');
  assert.equal(r.status, 0, `fix-slugs.mjs --help exited ${r.status}, want 0`);
  assert.match(r.all, /Usage:/i, 'fix-slugs.mjs --help printed no usage block');
});

test('fix-slugs.mjs -h exits 0 and prints usage', () => {
  const r = runScript('fix-slugs.mjs', '-h');
  assert.equal(r.status, 0, `fix-slugs.mjs -h exited ${r.status}, want 0`);
  assert.match(r.all, /Usage:/i, 'fix-slugs.mjs -h printed no usage block');
});

test('fix-slugs.mjs --help --bogus still errors', () => {
  const r = runScript('fix-slugs.mjs', '--help', '--bogus');
  assert.equal(r.status, 1, `fix-slugs.mjs --help --bogus exited ${r.status}, want 1`);
  assert.match(r.all, /unrecognized flag/i);
});


test('fix-slugs rejects unknown flags before checking or reading portals file', () => {
  const r = runScript('fix-slugs.mjs', '--file', join(tmpdir(), 'non-existent-portals.yml'), '--unknown-flag');
  assert.equal(r.status, 1);
  assert.match(r.all, /unrecognized flag\(s\): --unknown-flag/);
  assert.doesNotMatch(r.all, /no portals file at/i);
});

test('fix-slugs honours both --file <path> and --file=<path> syntax', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-fixslugs-flag-'));
  try {
    const customPortals = join(dir, 'custom.yml');
    // Non-existent custom path should be reported when flags are valid
    const r1 = runScript('fix-slugs.mjs', '--file', customPortals);
    assert.match(r1.all, new RegExp(`no portals file at ${customPortals.replace(/\\/g, '\\\\')}`));

    const r2 = runScript('fix-slugs.mjs', `--file=${customPortals}`);
    assert.match(r2.all, new RegExp(`no portals file at ${customPortals.replace(/\\/g, '\\\\')}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix-slugs rejects missing --file values (bare, empty, or next-is-flag)', () => {
  const rBare = runScript('fix-slugs.mjs', '--file');
  assert.equal(rBare.status, 1, 'bare --file must exit 1');
  assert.match(rBare.all, /--file requires a value/);

  const rEmpty = runScript('fix-slugs.mjs', '--file=');
  assert.equal(rEmpty.status, 1, '--file= must exit 1');
  assert.match(rEmpty.all, /--file requires a value/);

  const rFlag = runScript('fix-slugs.mjs', '--file', '--fix');
  assert.equal(rFlag.status, 1, '--file --fix must exit 1 without treating --fix as a filename');
  assert.match(rFlag.all, /--file requires a value/);

  const rApply = runScript('fix-slugs.mjs', '--file', '--apply');
  assert.equal(rApply.status, 1, '--file --apply must exit 1');
  assert.match(rApply.all, /--file requires a value/);

  const rDryRun = runScript('fix-slugs.mjs', '--file', '--dry-run');
  assert.equal(rDryRun.status, 1, '--file --dry-run must exit 1');
  assert.match(rDryRun.all, /--file requires a value/);

  const rShortFlag = runScript('fix-slugs.mjs', '--file', '-h');
  assert.equal(rShortFlag.status, 1, '--file -h must exit 1 without treating -h as a filename');
  assert.match(rShortFlag.all, /--file requires a value/);
  assert.doesNotMatch(rShortFlag.all, /no portals file at/i);

  const rShortFlagEq = runScript('fix-slugs.mjs', '--file=-h');
  assert.equal(rShortFlagEq.status, 1, '--file=-h must exit 1 without treating -h as a filename');
  assert.match(rShortFlagEq.all, /--file requires a value/);
  assert.doesNotMatch(rShortFlagEq.all, /no portals file at/i);
});
