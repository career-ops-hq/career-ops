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
import { failureExcerpt } from '../lib/failure-excerpt.mjs';

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

test('empty and whitespace-only input produce nothing', () => {
  // run() hands back whatever the child wrote; a child killed by a signal can
  // write nothing at all. Returning [] prints no lines rather than one blank.
  assert.deepEqual(failureExcerpt(''), []);
  assert.deepEqual(failureExcerpt('\n\n  \n'), []);
  assert.deepEqual(failureExcerpt(undefined), []);
  assert.deepEqual(failureExcerpt(null), []);
});
