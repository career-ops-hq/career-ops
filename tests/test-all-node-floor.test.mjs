// test-all.mjs must stop at once, with the reason, on a Node below the floor.
//
// Below lib/node-floor.mjs's NODE_MIN the tracker's node:sqlite cannot load,
// so a full run spent its whole length failing every suite that runs
// tracker.mjs or doctor.mjs, each with "needs Node >= 22.13" buried in its own
// output. The suite now checks the floor the way doctor.mjs does and runs
// nothing below it. --help still answers on any Node.
//
// The child's Node version is faked with a preload that overrides
// process.versions.node before test-all.mjs reads it. The children run with
// the queue off and one job, so an unfixed run is a single process the timeout
// can end instead of a fan-out of workers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const SCRIPT = join(ROOT, 'test-all.mjs');

function runAs(version, args) {
  const preload = `Object.defineProperty(process, 'versions', { value: { ...process.versions, node: ${JSON.stringify(version)} }, configurable: true });`;
  return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 15000,
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_TEST_QUEUE: '0', CAREER_OPS_TEST_JOBS: '1' },
  });
}

test('below the Node floor the suite stops at once and says why', () => {
  const result = runAs('22.12.0', []);
  assert.equal(result.signal, null, 'the suite was still running when the timeout fired');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Node\.js >= 22\.13 required \(found v22\.12\.0\)/);
  assert.match(result.stdout, /https:\/\/nodejs\.org/);
  assert.doesNotMatch(result.stdout, /test suite/, 'a run started below the floor');
});

test('an --only run below the floor stops the same way', () => {
  const result = runAs('22.12.0', ['--only', 'test-all-flags']);
  assert.equal(result.signal, null, 'the suite was still running when the timeout fired');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Node\.js >= 22\.13 required/);
  assert.doesNotMatch(result.stdout, /test suite/);
});

test('23.x below 23.4 is below the floor too', () => {
  const result = runAs('23.3.0', []);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Node\.js 23 needs 23\.4 or later/);
});

test('--help still prints usage below the floor', () => {
  const result = runAs('22.12.0', ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage:/);
});

test('a usage error is still reported as one below the floor', () => {
  const result = runAs('22.12.0', ['--only']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /--only requires a path substring/);
  assert.doesNotMatch(result.stdout, /required \(found/);
});

test('on the floor itself the check lets the suite start', () => {
  // --only with a filter that matches nothing reaches the runner and returns
  // fast, without running a suite.
  const result = runAs('22.13.0', ['--only', 'no-such-suite-matches-this-filter']);
  assert.equal(result.signal, null, 'the suite was still running when the timeout fired');
  assert.doesNotMatch(result.stdout, /required \(found/);
  assert.match(result.stdout, /test suite/);
});
