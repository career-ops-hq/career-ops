// tests/verify-portals-help-flag.test.mjs — verify-portals.mjs must not run
// a live sweep on --help or on an unrecognized flag (#4250).
//
// Before this fix, `node verify-portals.mjs --help` never looked at --help
// at all: main() hand-rolled its argument parsing with args.indexOf() and
// had no --help/-h check anywhere, so it fell straight through into the same
// full portals.yml sweep as no flags at all. On a config with ~170 tracked
// companies that is minutes of sequential network probing with zero output
// until it finishes — reported as "verify-portals.mjs hangs with no output
// on Windows", with the specific clue that --help "behaves the same [as no
// args]". Same failure class already fixed identically in scan.mjs (#2270,
// see tests/scan-help-flag.test.mjs), scan-ats-full.mjs (#1633/#1635),
// reply-watch.mjs (#2743/#2745) and dedup-tracker.mjs (#2744/#2746), now
// shared via lib/cli-flags.mjs's validateFlags() (#2775).
//
// HERMETIC: every run pins CAREER_OPS_PORTALS at ENV_PORTALS, a path that
// does not exist. If --help or an unrecognized flag were NOT handled before
// the portals file is read, the run would print verify-portals's own "no
// portals file at ... — nothing to verify" line instead of exiting on the
// flag itself — so that message doubles as proof a real sweep was
// attempted. Each assertion also checks the subprocess actually ran (no
// spawn error, no signal), so a timeout cannot pass silently.
//
// ENV_PORTALS and FILE_PORTALS are deliberately DIFFERENT absent paths
// (CodeRabbit, #4254 review): the --file tests originally passed the same
// path as both the --file argument AND the CAREER_OPS_PORTALS env fallback,
// so a completely broken --file (its value silently discarded, falling back
// to the env default) would have produced byte-identical output and passed
// anyway. Naming the selected path in the assertion — not just checking
// "nothing to verify" appeared somewhere — is what actually proves --file's
// value reached verifyPortalsFile(), rather than the env fallback quietly
// standing in for it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NOTHING_TO_VERIFY = /nothing to verify/i;

let scratchDir;
let ENV_PORTALS;
let FILE_PORTALS;

before(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'career-ops-verify-portals-help-'));
  // Neither file is ever created — both stay absent for the whole suite —
  // but they are two distinct paths under the same fresh, unique-per-run
  // directory, so no other test or concurrent process can collide with
  // either one.
  ENV_PORTALS = join(scratchDir, 'env-default-portals.yml');
  FILE_PORTALS = join(scratchDir, 'file-arg-portals.yml');
});

after(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

function runVerify(...args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'verify-portals.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_PORTALS: ENV_PORTALS },
  });
  assert.equal(r.error, undefined, `verify-portals.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `verify-portals.mjs was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('--help prints usage and exits 0, without reaching the portals check', () => {
  const r = runVerify('--help');
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.all}`);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /node verify-portals\.mjs/);
  assert.doesNotMatch(r.all, NOTHING_TO_VERIFY, '--help must exit before any sweep logic runs');
});

test('-h prints usage and exits 0, without reaching the portals check', () => {
  const r = runVerify('-h');
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.all}`);
  assert.match(r.stdout, /Usage:/);
  assert.doesNotMatch(r.all, NOTHING_TO_VERIFY);
});

test('an unrecognized flag errors and exits 1, without reaching the portals check', () => {
  const r = runVerify('--bogus-flag');
  assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.all}`);
  assert.match(r.stderr, /unrecognized flag\(s\): --bogus-flag/);
  assert.match(r.stderr, /Valid flags:/);
  assert.doesNotMatch(r.all, NOTHING_TO_VERIFY, 'an unrecognized flag must not fall through to a live sweep');
});

test('--help plus an unrecognized flag still errors (unrecognized check runs before --help)', () => {
  const r = runVerify('--help', '--bogus-flag');
  assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.all}`);
  assert.match(r.stderr, /unrecognized flag\(s\): --bogus-flag/);
  assert.doesNotMatch(r.stdout, /Usage:/, '--help must not print/exit 0 while an unrecognized flag is present');
});

test('a mistyped known flag (--fil for --file) is rejected, not silently ignored', () => {
  const r = runVerify('--fil', FILE_PORTALS);
  assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.all}`);
  assert.match(r.stderr, /unrecognized flag\(s\): --fil/);
  assert.doesNotMatch(r.all, NOTHING_TO_VERIFY, 'a mistyped flag must not fall through to a live sweep');
});

test('a genuinely empty argv reaches normal sweep logic using the env-var default (regression: recognized flags are unaffected)', () => {
  const r = runVerify();
  assert.match(r.all, NOTHING_TO_VERIFY, 'no flags at all must proceed past flag validation into the real run');
  assert.match(r.all, new RegExp(ENV_PORTALS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'a bare run must select CAREER_OPS_PORTALS (ENV_PORTALS), not something else');
});

test('--file <path> is honored — the run selects FILE_PORTALS, not the env-var default', () => {
  const r = runVerify('--file', FILE_PORTALS);
  assert.match(r.all, NOTHING_TO_VERIFY, '--file <path> must be accepted and proceed into the real run');
  assert.match(r.all, new RegExp(FILE_PORTALS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    '--file\'s value must be the selected path — a silently-discarded --file falling back to ENV_PORTALS would print a different path and this would fail');
  assert.doesNotMatch(r.all, new RegExp(ENV_PORTALS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    '--file must override the env-var default, not merely coexist with it');
});

test('--file=<path> (the = form) is honored the same as the space-separated form', () => {
  const r = runVerify(`--file=${FILE_PORTALS}`);
  assert.match(r.all, NOTHING_TO_VERIFY, '--file=<path> must be accepted and proceed into the real run');
  assert.match(r.all, new RegExp(FILE_PORTALS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    '--file=\'s value must be the selected path, proving the = form is parsed, not merely tolerated');
});

// --file's operand is a value-taking flag with no dedicated value validation
// of its own, so a missing/swallowed operand must be caught by
// validateFlags()'s shared requireOperand mechanism (or, for the --file=
// empty-string case that requireOperand's bare-token check can't see, an
// explicit fallback check) rather than reaching resolve('') — the current
// directory — and crashing readFileSync() with a raw EISDIR (CodeRabbit,
// #4254 review).
test('a bare --file with nothing after it is rejected, not read as the current directory', () => {
  const r = runVerify('--file');
  assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.all}`);
  assert.match(r.stderr, /--file requires a value/);
  assert.doesNotMatch(r.all, /EISDIR/, 'a missing --file operand must be a usage error, not a raw fs crash');
});

test('--file followed by another flag treats neither as the file\'s value', () => {
  const r = runVerify('--file', '--strict');
  assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.all}`);
  assert.match(r.stderr, /--file requires a value/);
  assert.doesNotMatch(r.all, NOTHING_TO_VERIFY, '--strict must never be silently read as a filename');
});

test('--file= with an explicitly empty value is rejected, not read as the current directory', () => {
  const r = runVerify('--file=');
  assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.all}`);
  assert.match(r.stderr, /--file requires a value/);
  assert.doesNotMatch(r.all, /EISDIR/, 'an empty --file= value must be a usage error, not a raw fs crash');
});
