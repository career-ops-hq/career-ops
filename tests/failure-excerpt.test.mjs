// tests/failure-excerpt.test.mjs — a failed node:test suite must surface the
// line that carries the measured value, not just the frames below it (#4017).
//
// The defect: test-all.mjs printed a failed node:test child's output as
// `.split('\n').filter(Boolean).slice(-12)` — the LAST twelve non-empty lines.
// node's runner prints the AssertionError message near the TOP of a failure
// block and the stack frames and error properties below it, so the twelve-line
// window keeps the frames and drops the message.
//
// The message is the only place an assertion's interpolated value appears.
// Measured on node 24 against a one-assertion suite: 25 non-empty lines, the
// message at line 15, so the window began three lines after it. What CI showed
// was `code: 'ERR_ASSERTION', actual: false, expected: true` — true of every
// failed assert.ok in the repository, and therefore of no diagnostic use.
//
// That made a timing flake undiagnosable by construction. #4017 reports
// `assert.ok(elapsed >= 400, ...)` failing intermittently on windows-latest;
// whether `elapsed` came back near 100 (the lock fingerprint degenerating, a
// real bug) or near 390 (clock jitter, a test-tuning problem) picks between two
// entirely different fixes, and the number lived on the dropped line.
//
// So the excerpt keeps the error headers the tail window cuts off, and keeps
// the tail as well — the frames are what locate the assertion, the message is
// what explains it. Neither alone is enough.
//
// Run:  node --test tests/failure-excerpt.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureExcerpt, childFailureExcerpt } from '../lib/failure-excerpt.mjs';

// `node --test` output for a single failing assert.ok, captured verbatim on
// node 24.20.0. Only the absolute path of the temporary suite is shortened, so
// the line ORDER and COUNT — the properties this test is about — are untouched.
// 25 non-empty lines; the twelve-line window begins at line 14; the message is
// line 13. It misses by one, which is why the defect was invisible: the output
// looks complete and the first frame is right there.
const REAL_FAILURE = `
✖ timing lower bound (0.981333ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 40.966542
✖ failing tests:
test at tests/pipeline-lock.test.mjs:3:1
✖ timing lower bound (0.981333ms)
  AssertionError [ERR_ASSERTION]: gave up after 103ms, before the caller's maxWaitMs
      at TestContext.<anonymous> (file:///repo/tests/pipeline-lock.test.mjs:447:10)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.start (node:internal/test_runner/test:1262:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
`;

test('the assertion message survives, which is the whole regression', () => {
  const out = failureExcerpt(REAL_FAILURE).join('\n');

  // The interpolated value. Without this line the reader cannot tell a
  // degenerate-fingerprint failure (~100ms) from clock jitter (~390ms).
  assert.match(out, /gave up after 103ms/);

  // And prove the old window genuinely dropped it, so this test would have
  // failed against the code it replaces rather than passing either way.
  const oldWindow = REAL_FAILURE.split('\n').filter(Boolean).slice(-12).join('\n');
  assert.doesNotMatch(oldWindow, /gave up after 103ms/,
    'fixture is too short to reproduce the defect — the old slice(-12) already kept the message');
});

test('the frames and error properties are still there', () => {
  const out = failureExcerpt(REAL_FAILURE).join('\n');
  // The tail is what locates the failure. Replacing it with the message alone
  // would trade one half of the diagnosis for the other.
  assert.match(out, /pipeline-lock\.test\.mjs:447:10/);
  assert.match(out, /code: 'ERR_ASSERTION'/);
});

test('a header already inside the tail is not printed twice', () => {
  // A short failure whose message falls within the last twelve lines.
  const short = [
    'TypeError: cannot read x of undefined',
    '    at one (file:///repo/a.mjs:1:1)',
    '    at two (file:///repo/b.mjs:2:2)',
  ].join('\n');
  const out = failureExcerpt(short);
  const headerCount = out.filter((l) => l.includes('TypeError: cannot read x of undefined')).length;
  assert.equal(headerCount, 1, `header duplicated: ${JSON.stringify(out)}`);
});

test('every failure in a multi-failure suite gets its message surfaced', () => {
  const many = [
    'AssertionError [ERR_ASSERTION]: first failure detail',
    '    at a (file:///repo/x.mjs:1:1)',
    'AssertionError [ERR_ASSERTION]: second failure detail',
    ...Array.from({ length: 20 }, (_, i) => `    at frame${i} (file:///repo/y.mjs:${i}:1)`),
  ].join('\n');
  const out = failureExcerpt(many).join('\n');
  assert.match(out, /first failure detail/);
  assert.match(out, /second failure detail/);
});

test('output stays bounded when a suite fails in bulk', () => {
  // 200 distinct failures must not dump 200 lines into a CI log. The cap is a
  // deliberate ceiling, not an accident of the window size.
  const bulk = Array.from({ length: 200 }, (_, i) =>
    `AssertionError [ERR_ASSERTION]: failure number ${i}`).join('\n');
  const out = failureExcerpt(bulk);
  assert.ok(out.length <= 20, `excerpt grew to ${out.length} lines`);
});

// node's runner writes its failure report to stdout. A warning from the child
// lands on stderr. Choosing `stderr || stdout` printed the warning and dropped
// the assertion, so any suite that warned lost the message again.
const WARNING = [
  '(node:4242) ExperimentalWarning: VM Modules is an experimental feature',
  '(Use `node --trace-warnings ...` to show where the warning was created)',
].join('\n');

test('a warning on stderr does not hide the assertion on stdout', () => {
  const out = childFailureExcerpt({ stdout: REAL_FAILURE, stderr: WARNING }).join('\n');
  assert.match(out, /gave up after 103ms/);
  assert.match(out, /pipeline-lock\.test\.mjs:447:10/);

  // The selection it replaces lost the message on this exact input.
  const old = failureExcerpt(WARNING || REAL_FAILURE).join('\n');
  assert.doesNotMatch(old, /gave up after 103ms/);
});

test('a crash reported only on stderr still surfaces', () => {
  const crash = 'SyntaxError: Unexpected token \'}\'\n    at file:///repo/tests/broken.test.mjs:9:1';
  const out = childFailureExcerpt({ stdout: '', stderr: crash }).join('\n');
  assert.match(out, /SyntaxError: Unexpected token/);
});

test('both streams together stay inside the single-stream bound', () => {
  const bulk = (tag) => Array.from({ length: 200 }, (_, i) =>
    `AssertionError [ERR_ASSERTION]: ${tag} failure ${i}`).join('\n');
  const out = childFailureExcerpt({ stdout: bulk('stdout'), stderr: bulk('stderr') });
  assert.ok(out.length <= 20, `excerpt grew to ${out.length} lines`);
});

test('a run with no output on either stream produces nothing', () => {
  assert.deepEqual(childFailureExcerpt({ stdout: '', stderr: '' }), []);
  assert.deepEqual(childFailureExcerpt(undefined), []);
  assert.deepEqual(childFailureExcerpt(null), []);
});

test('empty and whitespace-only input produce nothing', () => {
  // run() hands back whatever the child wrote; a child killed by a signal can
  // write nothing at all. Returning [] prints no lines rather than one blank.
  assert.deepEqual(failureExcerpt(''), []);
  assert.deepEqual(failureExcerpt('\n\n  \n'), []);
  assert.deepEqual(failureExcerpt(undefined), []);
  assert.deepEqual(failureExcerpt(null), []);
});

// The same one-assertion failure as `node --test` prints it on node 22.22.0
// with stdout piped, which is how test-all.mjs runs every suite. node 20 and 22
// default to the TAP reporter there (node 23 switched to spec), and TAP has no
// `AssertionError [ERR_ASSERTION]: ...` line: the message is under `error: |-`
// and the code is a YAML key. Captured verbatim; only the local path of the
// suite is shortened. 33 non-empty lines; the twelve-line window starts at the
// last frame, eight lines below the message.
const REAL_TAP_FAILURE = String.raw`TAP version 13
# Subtest: d fails
not ok 1 - d fails
  ---
  duration_ms: 0.854
  type: 'test'
  location: 'C:\\repo\\tests\\d-runner-fail.test.mjs:3:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    1 !== 2

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 2
  actual: 1
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///C:/repo/tests/d-runner-fail.test.mjs:3:32)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 67.8509
`;

test('the TAP reporter: the message and the error code survive', () => {
  const out = failureExcerpt(REAL_TAP_FAILURE).join('\n');
  assert.match(out, /^\s*error: \|-$/m);
  assert.match(out, /Expected values to be strictly equal:/);
  assert.match(out, /1 !== 2/);
  assert.match(out, /code: 'ERR_ASSERTION'/);

  // The window on its own had neither, so this would fail against the code
  // before TAP was read.
  const window = REAL_TAP_FAILURE.split('\n').filter((l) => l.trim()).slice(-12).join('\n');
  assert.doesNotMatch(window, /1 !== 2|ERR_ASSERTION/,
    'fixture too short to reproduce the defect — the window already kept the message');
});

test('the TAP message ends at the next key', () => {
  const out = failureExcerpt(REAL_TAP_FAILURE);
  // Keys below the message are not the message. They sit above the window here,
  // so a block that ran on past `error:` would pull them in.
  assert.equal(out.some((l) => /^\s*(?:name|expected|actual|operator): /.test(l)), false,
    `keys after the message were taken as part of it: ${JSON.stringify(out)}`);
  // The first frame, which locates the assertion, is kept even though the
  // window starts four frames below it; the frames between are not.
  const text = out.join('\n');
  assert.match(text, /TestContext\.<anonymous> \(file:\/\/\/C:\/repo\/tests\/d-runner-fail\.test\.mjs:3:32\)/);
  assert.doesNotMatch(text, /Test\.runInAsyncScope/);
  assert.match(text, /# fail 1/);
});

test('a one-line TAP message is kept on its own', () => {
  const lines = [
    'not ok 1 - throws',
    '  ---',
    "  failureType: 'testCodeFailure'",
    "  error: 'boom at offset 17'",
    "  code: 'ERR_TEST_FAILURE'",
    "  name: 'Error'",
    ...Array.from({ length: 14 }, (_, i) => `# filler ${i}`),
  ].join('\n');
  const out = failureExcerpt(lines);
  assert.ok(out.includes("  error: 'boom at offset 17'"), JSON.stringify(out));
  assert.ok(out.includes("  code: 'ERR_TEST_FAILURE'"), JSON.stringify(out));
  assert.ok(!out.includes("  name: 'Error'"), JSON.stringify(out));
});

test('TAP output stays bounded when a suite fails in bulk', () => {
  const bulk = Array.from({ length: 200 }, (_, i) => [
    `not ok ${i + 1} - case ${i}`,
    '  error: |-',
    `    failure number ${i}`,
    "  code: 'ERR_ASSERTION'",
  ].join('\n')).join('\n');
  const out = failureExcerpt(bulk);
  assert.ok(out.length <= 20, `excerpt grew to ${out.length} lines`);
  assert.match(out.join('\n'), /failure number 0/);
});
