// funnel-velocity.mjs must handle help and reject unknown flags before it
// reads report inputs. A typo must never fall through to a plausible JSON
// report at exit 0.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'funnel-velocity.mjs');
const SANDBOX = mkdtempSync(join(tmpdir(), 'career-ops-funnel-flags-'));
const NO_TRACKER = join(SANDBOX, 'applications.md');
const NO_BENCHMARKS = join(SANDBOX, 'benchmarks.yml');

after(() => rmSync(SANDBOX, { recursive: true, force: true }));

function runFunnel(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_TRACKER: NO_TRACKER },
  });
  assert.equal(result.error, undefined, `funnel-velocity.mjs failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `funnel-velocity.mjs was killed by ${result.signal} (timeout?)`);
  return { ...result, all: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('--help prints usage and exits 0', () => {
  const result = runFunnel('--help');
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.all}`);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /node funnel-velocity\.mjs/);
  assert.match(result.stdout, /--summary/);
  assert.match(result.stdout, /--benchmarks <path>/);
});

test('-h prints usage and exits 0', () => {
  const result = runFunnel('-h');
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.all}`);
  assert.match(result.stdout, /Usage:/);
});

test('help exits before reading report inputs', () => {
  const result = runFunnel('--benchmarks', NO_BENCHMARKS, '--help');
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.all}`);
  assert.match(result.stdout, /Usage:/);
  assert.doesNotMatch(result.all, /benchmark file not found/i);
});

test('an unknown flag exits 1 and names the flag', () => {
  const result = runFunnel('--bogus');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /unrecognized flag\(s\): --bogus/);
  assert.match(result.stderr, /Valid flags:/);
});

test('--help plus an unknown flag still fails', () => {
  const result = runFunnel('--help', '--bogus');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /unrecognized flag\(s\): --bogus/);
  assert.doesNotMatch(result.stdout, /Usage:/);
});

test('--benchmarks=value is recognized and reaches normal validation', () => {
  const result = runFunnel(`--benchmarks=${NO_BENCHMARKS}`);
  assert.equal(result.status, 1, `expected missing benchmark to fail, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /Cannot read benchmarks/i);
  assert.doesNotMatch(result.stderr, /unrecognized flag/i);
});

test('--benchmarks without a value is rejected instead of using the default', () => {
  const result = runFunnel('--benchmarks');
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--benchmarks requires a value/);
});

test('a normal run preserves the existing no-tracker JSON bytes', () => {
  const result = runFunnel();
  const expected = `${JSON.stringify({
    calibration: null,
    waiting: null,
    velocity: null,
    dataQuality: {
      trackerRows: 0,
      note: `no tracker at ${NO_TRACKER}`,
    },
  }, null, 2)}\n`;

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.all}`);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, expected);
});
