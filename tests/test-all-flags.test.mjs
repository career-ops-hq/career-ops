// test-all.mjs must answer --help and refuse a flag it does not know.
//
// It had no unknown-flag check at all: only --only, --needs, --jobs and
// --inline-child were read, so any other token — --help included — fell
// through to a full run. `node test-all.mjs --help` executed the whole suite,
// and a mistyped filter (--onl providers/gupy) ran everything and could report
// green, which reads as "the subset passed". report-watch.mjs and the scripts
// around it already reject unknown flags (#2743/#2745); this pins the same
// contract for the suite entrypoint.
//
// The children run with the queue off and one job, so an unfixed run is a
// single process the timeout can end instead of a fan-out of workers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const SCRIPT = join(ROOT, 'test-all.mjs');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 15000,
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_TEST_QUEUE: '0', CAREER_OPS_TEST_JOBS: '1' },
  });
}

test('--help prints usage and exits 0 instead of running the suite', () => {
  const result = run(['--help']);
  assert.equal(result.signal, null, 'the suite was still running when the timeout fired');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage:/);
  assert.doesNotMatch(result.stdout, /test suite/, 'a run started instead of printing usage');
});

test('-h prints the same usage block', () => {
  const long = run(['--help']);
  const short = run(['-h']);
  assert.equal(short.status, 0);
  assert.equal(short.stdout, long.stdout);
});

test('an unknown flag is a usage error, not a full run', () => {
  const result = run(['--bogus']);
  assert.equal(result.signal, null, 'the suite was still running when the timeout fired');
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /unknown flag --bogus/);
  assert.doesNotMatch(result.stdout, /test suite/);
});

test('--help beside an unknown flag is still a usage error', () => {
  const result = run(['--help', '--bogus']);
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /unknown flag --bogus/);
});

test('an unknown single-dash flag is a usage error too', () => {
  const result = run(['-x']);
  assert.equal(result.signal, null, 'the suite was still running when the timeout fired');
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}${result.stderr}`, /unknown flag -x/);
  assert.doesNotMatch(result.stdout, /test suite/);
});

test('a flag operand that starts with a dash is still that flag\'s operand', () => {
  const jobs = run(['--jobs', '-1']);
  assert.equal(jobs.status, 1);
  assert.match(jobs.stdout, /--jobs must be a positive integer/);
  assert.doesNotMatch(jobs.stdout, /unknown flag/);
});

test('an attached value on a valueless flag is a usage error, not help', () => {
  const help = run(['--help=1']);
  assert.equal(help.signal, null, 'the suite was still running when the timeout fired');
  assert.equal(help.status, 1);
  assert.match(`${help.stdout}${help.stderr}`, /unknown flag --help=1/);
  assert.doesNotMatch(help.stdout, /^Usage:/m);
  const quick = run(['--quick=1']);
  assert.equal(quick.status, 1);
  assert.match(`${quick.stdout}${quick.stderr}`, /unknown flag --quick=1/);
});

test('-h consumed as a flag operand does not select help', () => {
  const result = run(['--jobs', '-h']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /--jobs must be a positive integer/);
  assert.doesNotMatch(result.stdout, /^Usage:/m);
});

test('--only and --jobs keep their own validation', () => {
  const misplaced = run(['--only']);
  assert.equal(misplaced.status, 1);
  assert.match(misplaced.stdout, /--only requires a path substring/);
  const jobs = run(['--jobs', 'many']);
  assert.equal(jobs.status, 1);
  assert.match(jobs.stdout, /--jobs must be a positive integer/);
});