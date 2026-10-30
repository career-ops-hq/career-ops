// tests/describe-spawn.test.mjs — a failed child process must name its cause.
//
// The shape this replaces is everywhere in the suite:
//
//   assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
//
// which reads well for a child that ran and complained, and says NOTHING for a
// child that never got to print. spawnSync with a `timeout` answers
//
//   status null · signal SIGTERM · error ETIMEDOUT · stdout "" · stderr ""
//
// so the message is the empty string, and the failure reads
// "AssertionError: --status Applied:" with no reason in it.
//
// That is a real failure, not a hypothetical: tests/tracker-mode-query.test.mjs
// failed exactly that way on windows-latest, where a slow runner hit its 20s
// timeout. The report could not say so, so it looked like a logic failure in
// tracker.mjs rather than a runner that ran out of time.
//
// `status` can be null, `signal` says a kill happened, and `error` carries
// ETIMEDOUT or ENOENT. All three live on the result; all three were discarded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

test('a timeout kill is named, where the old message was empty', () => {
  const result = spawnSync(process.execPath, ['-e', 'while(true){}'], { timeout: 500, encoding: 'utf8' });

  // Establish the premise rather than assuming it: this really is the shape
  // that produced an empty message.
  assert.equal(`${result.stdout}${result.stderr}`, '', 'premise: both streams are empty on a timeout kill');
  assert.equal(result.status, null, 'premise: a killed child has no exit status');

  const described = describeSpawn(result, 'node -e while(true){}');
  assert.match(described, /ETIMEDOUT/, 'the timeout must be named');
  assert.match(described, /did not exit on its own/, 'a null status must be explained, not printed as null');
  assert.match(described, /node -e while\(true\)\{\}/, 'the label says what was run');
  // Silence must be stated, so a reader can tell it from a truncated message.
  assert.match(described, /stdout: \(empty\)/);
  assert.match(described, /stderr: \(empty\)/);
});

test('a child that ran and complained still shows what it said', () => {
  // The case the old form handled, which must not regress.
  // `process.exitCode = 3` rather than process.exit(3): test-all.mjs lints
  // discovered suites for /\bprocess\.exit\s*\(/ after stripping COMMENT lines
  // but not string literals, so the child's own code in a string trips a guard
  // meant for the suite itself. Setting exitCode and falling off the end exits
  // with the same status and keeps the guard's intent intact.
  const result = spawnSync(process.execPath, ['-e', 'console.error("boom"); process.exitCode = 3'], { encoding: 'utf8' });
  const described = describeSpawn(result, 'failing child');
  assert.match(described, /exit status 3/);
  assert.match(described, /stderr:\n\s*boom/);
  assert.doesNotMatch(described, /spawn error/, 'an ordinary non-zero exit is not a spawn error');
  assert.doesNotMatch(described, /killed by signal/);
});

test('a binary that does not exist is named too', () => {
  const result = spawnSync('definitely-not-a-real-binary-xyz', [], { encoding: 'utf8' });
  const described = describeSpawn(result, 'missing binary');
  assert.match(described, /spawn error/);
  assert.match(described, /ENOENT/);
});

test('a result with nothing usable still produces a cause, not an empty string', () => {
  // Defensive: whatever the caller hands over, the message must not be blank,
  // because a blank message is the bug.
  for (const value of [{}, null, undefined]) {
    const described = describeSpawn(value, 'odd result');
    assert.ok(described.trim().length > 0, `describeSpawn(${JSON.stringify(value)}) must say something`);
    assert.match(described, /exit status/);
  }
});
