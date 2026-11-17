// tests/script-subprocess-timeouts.test.mjs — the two blocking subprocess calls
// that had no bound, and the diagnosis a bound makes possible.
//
// `github-evidence.mjs` shells out to `gh` and `hired-share.mjs` asks the OS to
// open a browser. Both modules degrade by design when their tool is missing or
// fails — gh missing is exit 3, a failed query is exit 2, the opener returns
// false — so an unbounded wait was the one outcome neither could describe: a
// stalled socket or a wedged `gh` hung the run with no output at all.
//
// A bound alone is not the fix. `checkGh` reads a null exit status as "gh was
// not found on PATH", and a timeout kill produces exactly that status, so
// bounding the call without teaching the reader what a timeout is would replace
// a hang with a wrong diagnosis. Both halves are pinned here.
//
// Run:  node --test tests/script-subprocess-timeouts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGhRunner, checkGh, GH_TIMEOUT_MS } from '../github-evidence.mjs';
import { openInBrowser, OPENER_TIMEOUT_MS } from '../hired-share.mjs';

/** A recorded spawnSync stand-in. */
function fakeSpawn(result) {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return result;
  };
  return { spawn, calls };
}

test('the gh runner bounds its call and reports the bound as a timeout', () => {
  const okSpawn = fakeSpawn({ status: 0, stdout: 'ok', stderr: '' });
  const ok = defaultGhRunner(['api', 'user'], okSpawn.spawn);
  const options = okSpawn.calls[0].options;
  assert.equal(okSpawn.calls[0].cmd, 'gh');
  assert.ok(Number.isFinite(options.timeout) && options.timeout > 0, 'gh must be given a finite timeout');
  assert.equal(options.timeout, GH_TIMEOUT_MS);
  assert.equal(options.windowsHide, true, 'gh must not flash a console window on Windows');
  assert.equal(ok.timedOut, false, 'a completed call is not a timeout');

  // Node reports a timed-out child as ETIMEDOUT with a null status; the runner
  // has to name it, because the status alone reads as "never started".
  const hung = defaultGhRunner(['api', 'user'], fakeSpawn({ status: null, signal: 'SIGTERM', stdout: '', stderr: '', error: { code: 'ETIMEDOUT' } }).spawn);
  assert.equal(hung.timedOut, true, 'ETIMEDOUT must be reported as a timeout');
  assert.equal(hung.notFound, false, 'a timeout is not a missing binary');
});

test('a timed-out gh is diagnosed as a timeout, never as "not installed"', () => {
  // The version probe times out: gh IS installed, so "not installed" would send
  // the user to install something they already have.
  assert.throws(
    () => checkGh(() => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '', notFound: false, timedOut: true })),
    (error) => error.constructor.name === 'GhQueryError' && /timed out/i.test(error.message),
    'a timed-out version probe must raise a query error naming the timeout',
  );

  // A genuinely missing binary keeps its own answer.
  assert.equal(checkGh(() => ({ status: null, stdout: '', stderr: '', notFound: true, timedOut: false })).reason, 'not-installed');

  // A timed-out API probe is a query failure that says so.
  assert.throws(
    () => checkGh((args) => (args[0] === 'api'
      ? { status: null, signal: 'SIGTERM', stdout: '', stderr: '', notFound: false, timedOut: true }
      : { status: 0, stdout: 'gh version 2', stderr: '', notFound: false, timedOut: false })),
    (error) => error.constructor.name === 'GhQueryError' && /timed out/i.test(error.message),
  );
});

test('the browser opener is bounded, hidden on Windows, and fails quietly', () => {
  const calls = [];
  const exec = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return Buffer.alloc(0);
  };
  assert.equal(openInBrowser('https://example.com/x', exec), true);
  const { options } = calls[0];
  assert.ok(Number.isFinite(options.timeout) && options.timeout > 0, 'the opener must be given a finite timeout');
  assert.equal(options.timeout, OPENER_TIMEOUT_MS);
  assert.equal(options.windowsHide, true, 'cmd /c start must not flash a console window');
  assert.equal(options.stdio, 'ignore');

  // A wedged or absent opener is "could not open", which already has a message.
  const throwing = () => { throw Object.assign(new Error('spawn ETIMEDOUT'), { code: 'ETIMEDOUT' }); };
  assert.equal(openInBrowser('https://example.com/x', throwing), false, 'a timed-out opener must report failure, not throw');
});