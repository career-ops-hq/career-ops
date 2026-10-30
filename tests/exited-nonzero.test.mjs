// tests/exited-nonzero.test.mjs — "this command must fail" has to mean the
// command RAN and failed.
//
// `assert.notEqual(result.status, 0)` is how 42 sites in this suite say it, and
// it passes for three different reasons:
//
//   the CLI rejected the input   status 1     <- the only one meant
//   the child was killed         status null  <- timeout, SIGTERM
//   the child never started      status null  <- ENOENT
//
// `null !== 0`, so a command killed at its `timeout:` satisfies the assertion.
// A slow CI runner then turns "the CLI refuses a malformed bound" green without
// the CLI ever having parsed the bound.
//
// This is the opposite failure from the one describeSpawn addresses, and the
// worse of the two: a confusing red costs an afternoon, a false green hides a
// regression for as long as it lasts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { exitedNonZero, describeSpawn } from './helpers/describe-spawn.mjs';

test('a real non-zero exit is the case this allows', () => {
  const r = spawnSync(process.execPath, ['-e', 'process.exitCode = 1'], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'premise');
  assert.equal(exitedNonZero(r), true);
});

test('a successful exit is not a failure', () => {
  const r = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'premise');
  assert.equal(exitedNonZero(r), false);
});

test('a timeout kill is NOT a non-zero exit, though notEqual(status, 0) accepts it', () => {
  // THE BUG. Both assertions below are about the same result: the old form
  // passes, which is why a timeout reads as "the command failed as expected".
  const r = spawnSync(process.execPath, ['-e', 'while(true){}'], { timeout: 500, encoding: 'utf8' });
  assert.equal(r.status, null, 'premise: a killed child has no exit status');
  assert.notEqual(r.status, 0, 'premise: this is exactly what the old assertion checked, and it passes');

  assert.equal(exitedNonZero(r), false, 'a child that was killed did not choose to fail');
  // And the message says which of the three happened.
  assert.match(describeSpawn(r), /ETIMEDOUT/);
});

test('a child that never started is NOT a non-zero exit either', () => {
  const r = spawnSync('definitely-not-a-real-binary-xyz', [], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'premise: the old assertion passes here too');
  assert.equal(exitedNonZero(r), false, 'ENOENT proves nothing about the CLI under test');
  assert.match(describeSpawn(r), /ENOENT/);
});

test('a signal kill is not a decision the program made (POSIX)', () => {
  // Explicit SIGTERM rather than a timeout, so the `signal` branch is covered
  // on its own.
  const r = spawnSync(process.execPath,
    ['-e', "process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 5000);"],
    { timeout: 4000, encoding: 'utf8' });

  if (process.platform === 'win32') {
    // Windows has no POSIX signal delivery: Node emulates SIGTERM as forced
    // termination with a non-zero NATIVE status and no signal, so nothing in
    // the result tells it apart from a chosen non-zero exit — exitedNonZero
    // answers true here, and cannot do better from a spawnSync result alone.
    // web/tests/lib/server-launcher.test.mjs records the same platform limit.
    //
    // This is narrow: a `timeout:` kill still sets result.error to ETIMEDOUT on
    // every platform, which is the case these 42 assertions were actually
    // exposed to. Nothing in this suite sends a bare signal to its children.
    assert.equal(r.signal, null, 'Windows reports no signal');
    assert.notEqual(r.status, 0, 'but it does report a non-zero native status');
    return;
  }

  assert.equal(r.signal, 'SIGTERM', 'premise: POSIX reports the signal');
  assert.equal(r.status, null, 'premise: and no exit status');
  assert.equal(exitedNonZero(r), false, `a signal kill is not a chosen exit: ${describeSpawn(r)}`);
});

test('a malformed result object is not a pass', () => {
  for (const value of [null, undefined, {}, { status: undefined }, { status: '1' }]) {
    assert.equal(exitedNonZero(value), false, `exitedNonZero(${JSON.stringify(value)})`);
  }
});
