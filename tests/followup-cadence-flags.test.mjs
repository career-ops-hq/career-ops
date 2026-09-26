// followup-cadence.mjs must handle help and reject unknown flags before it
// reads report inputs. A typo (or a `--applied-days=N` the old indexOf lookup
// couldn't see) must never fall through to a plausible JSON report at exit 0.
//
// followup-cadence.mjs's tracker/follow-ups paths are fixed to CAREER_OPS's
// own data/ dir (unlike funnel-velocity.mjs, there is no env override), so
// these tests only assert on flag validation itself — everything checked here
// happens before analyze() ever touches disk, except the one test that
// deliberately stops short of asserting on the (machine-dependent) analysis
// result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'followup-cadence.mjs');

function runCadence(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, `followup-cadence.mjs failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `followup-cadence.mjs was killed by ${result.signal} (timeout?)`);
  return { ...result, all: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('--help prints usage and exits 0', () => {
  const result = runCadence('--help');
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.all}`);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /node followup-cadence\.mjs/);
  assert.match(result.stdout, /--applied-days 10/);
});

test('-h prints usage and exits 0', () => {
  const result = runCadence('-h');
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.all}`);
  assert.match(result.stdout, /Usage:/);
});

test('an unknown flag exits 1 and names the flag', () => {
  const result = runCadence('--summry');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /unrecognized flag\(s\): --summry/);
  assert.match(result.stderr, /Valid flags:/);
});

test('--help plus an unknown flag still fails', () => {
  const result = runCadence('--help', '--bogus');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /unrecognized flag\(s\): --bogus/);
  assert.doesNotMatch(result.stdout, /Usage:/);
});

test('--applied-days without a value is rejected instead of using the default', () => {
  const result = runCadence('--applied-days');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--applied-days requires a value/);
});

test('--applied-days abc is rejected instead of silently falling back to the default', () => {
  const result = runCadence('--applied-days', 'abc');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--applied-days requires a non-negative integer, got "abc"/);
});

test('--applied-days -5 is rejected instead of silently accepting a negative window', () => {
  const result = runCadence('--applied-days', '-5');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--applied-days requires a non-negative integer, got "-5"/);
});

test('--applied-days 1.5 is rejected, not truncated to 1', () => {
  const result = runCadence('--applied-days', '1.5');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--applied-days requires a non-negative integer, got "1\.5"/);
});

test('--applied-days 10days is rejected, not truncated to 10', () => {
  const result = runCadence('--applied-days', '10days');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--applied-days requires a non-negative integer, got "10days"/);
});

test('--applied-days=10 (equals form) reaches analysis instead of being silently discarded', () => {
  // Whether analysis then succeeds depends on this machine's own
  // data/applications.md (there is no path override for this script), so this
  // only asserts the flag itself was recognized and accepted — not the result.
  const result = runCadence('--applied-days=10');
  assert.doesNotMatch(result.stderr, /unrecognized flag/i);
  assert.doesNotMatch(result.stderr, /requires a value/);
  assert.doesNotMatch(result.stderr, /requires a non-negative integer/);
});
