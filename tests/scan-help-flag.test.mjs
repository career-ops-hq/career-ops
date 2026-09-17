// tests/scan-help-flag.test.mjs — scan.mjs must not run a live scan on
// --help or on an unrecognized flag (#2270).
//
// Before this fix, `node scan.mjs --help` never looked at --help at all: it
// fell straight through argument parsing into a full live scan, reading
// portals.yml, hitting every configured ATS, and appending to
// pipeline.md/scan-history.tsv — the exact "unrecognized/mistyped flag
// silently falls through to live behavior" failure class already fixed
// (identically) in scan-ats-full.mjs (#1633/#1635), reply-watch.mjs
// (#2743/#2745) and dedup-tracker.mjs (#2744/#2746), now shared via
// lib/cli-flags.mjs's validateFlags() (#2775).
//
// HERMETIC: every run pins CAREER_OPS_PORTALS at a path that does not exist.
// If --help or an unrecognized flag were NOT handled before the portals
// check, the run would reach "portals.yml not found" instead of exiting on
// the flag itself — so that message doubles as proof a live scan was
// attempted. Each assertion also checks the subprocess actually ran (no
// spawn error, no signal), so a timeout cannot pass silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NO_PORTALS = join(tmpdir(), 'career-ops-no-such-portals.yml');
const PORTALS_NOT_FOUND = /portals\.yml not found/i;

function runScan(...args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scan.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_PORTALS: NO_PORTALS },
  });
  assert.equal(r.error, undefined, `scan.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `scan.mjs was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('--help prints usage and exits 0, without reaching the portals check', () => {
  const r = runScan('--help');
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.all}`);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /node scan\.mjs/);
  assert.doesNotMatch(r.all, PORTALS_NOT_FOUND, '--help must exit before any scan logic runs');
});

test('-h prints usage and exits 0, without reaching the portals check', () => {
  const r = runScan('-h');
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.all}`);
  assert.match(r.stdout, /Usage:/);
  assert.doesNotMatch(r.all, PORTALS_NOT_FOUND);
});

test('an unrecognized flag errors and exits 1, without reaching the portals check', () => {
  const r = runScan('--bogus-flag');
  assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.all}`);
  assert.match(r.stderr, /unrecognized flag\(s\): --bogus-flag/);
  assert.match(r.stderr, /Valid flags:/);
  assert.doesNotMatch(r.all, PORTALS_NOT_FOUND, 'an unrecognized flag must not fall through to a live scan');
});

test('--help plus an unrecognized flag still errors (unrecognized check runs before --help)', () => {
  const r = runScan('--help', '--bogus-flag');
  assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.all}`);
  assert.match(r.stderr, /unrecognized flag\(s\): --bogus-flag/);
  assert.doesNotMatch(r.stdout, /Usage:/, '--help must not print/exit 0 while an unrecognized flag is present');
});

test('a mistyped known flag (--dryrun for --dry-run) is rejected, not silently ignored', () => {
  const r = runScan('--dryrun');
  assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.all}`);
  assert.match(r.stderr, /unrecognized flag\(s\): --dryrun/);
  assert.doesNotMatch(r.all, PORTALS_NOT_FOUND, 'a mistyped flag must not fall through to a live scan');
});

test('a genuinely empty argv still reaches normal scan logic (regression: recognized flags are unaffected)', () => {
  const r = runScan();
  assert.match(r.all, PORTALS_NOT_FOUND, 'no flags at all must proceed past flag validation into the real run');
});

test('--since 7 (a recognized value-taking flag) still reaches normal scan logic', () => {
  const r = runScan('--since', '7');
  assert.match(r.all, PORTALS_NOT_FOUND, '--since 7 must be accepted and proceed into the real run');
});

test('--since -5 (negative value) is not misread as an unrecognized flag', () => {
  // The value itself is rejected by scan.mjs's own --since validator further
  // down the pipeline, not by the flag allowlist — so this must NOT print
  // "unrecognized flag(s): -5".
  const r = runScan('--since', '-5');
  assert.doesNotMatch(r.stderr, /unrecognized flag\(s\)/, '-5 must not be misread as an unrecognized flag');
});
