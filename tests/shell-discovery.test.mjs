// Covers the shell-discovery half of #2344: getBash() returns the bare string
// 'bash' from three different branches, so its return value alone cannot tell
// a caller which shell is about to run. bashSource() records the branch, and
// run() names a fallback shell out loud when a command under it fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { getBash, bashSource, run, lastRunFailure } from './helpers.mjs';

const SOURCES = ['posix', 'git-bash', 'wsl', 'path', 'unresolved'];

test('bashSource() is null until getBash() has resolved', () => {
  // Import order matters here: nothing above may call getBash() first.
  assert.equal(bashSource(), null);
  getBash();
  assert.ok(SOURCES.includes(bashSource()), `unexpected source: ${bashSource()}`);
});

test('resolution is memoized and the source stays consistent with it', () => {
  const first = getBash();
  const source = bashSource();
  assert.equal(getBash(), first);
  assert.equal(bashSource(), source);
});

test('a literal-path bash is reported as git-bash and actually exists', () => {
  const bash = getBash();
  if (bash === 'bash') {
    // Fallback shell — the branch this test is not about.
    assert.notEqual(bashSource(), 'git-bash');
    return;
  }
  assert.equal(bashSource(), 'git-bash');
  assert.ok(existsSync(bash), `getBash() returned a path that does not exist: ${bash}`);
});

test('on posix the source says so, on win32 it never does', () => {
  getBash();
  if (process.platform === 'win32') assert.notEqual(bashSource(), 'posix');
  else assert.equal(bashSource(), 'posix');
});

test('a failing shell command exposes its real exit status instead of a bare null', () => {
  // The #2344 symptom was `run(...) || ''` turning exit 127 into an empty
  // string that the assertion blamed on the code under test.
  const out = run(getBash(), ['-c', 'exit 7']);
  assert.equal(out, null);
  const failure = lastRunFailure();
  assert.ok(failure, 'lastRunFailure() lost the failure');
  assert.equal(failure.status, 7);
});

test('lastRunFailure() clears after a command succeeds', () => {
  assert.equal(run(getBash(), ['-c', 'echo ok']), 'ok');
  assert.equal(lastRunFailure(), null);
});
