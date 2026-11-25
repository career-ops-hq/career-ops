// tests/writer-timeout.test.mjs — what tests/tracker-writer-lock.test.mjs says
// when a writer runs out of time (#5514). See tests/helpers/writer-timeout.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWriterTimeout } from './helpers/writer-timeout.mjs';

const T0 = 1_000_000;

test('a writer that exited but kept its streams open is not called stuck', () => {
  const line = describeWriterTimeout({
    launchedAt: T0, reachedLockAt: T0 + 400, markerExpected: true, releasedAt: T0 + 500, exitedAt: T0 + 7_600, waitMs: 10_000,
  });
  assert.match(line, /^its process exited 7\.1s after the lock release, but its output streams were still open 10\.0s after the release$/);
});

test('a writer that exited before the release is said to have exited before it', () => {
  const line = describeWriterTimeout({
    launchedAt: T0, reachedLockAt: null, markerExpected: true, releasedAt: T0 + 10_300, exitedAt: T0 + 8_000, waitMs: 10_000,
  });
  assert.equal(line, 'its process exited 2.3s before the lock release, but its output streams were still open 10.0s after the release');
});

test('a writer that had not reached the lock is reported as still starting', () => {
  const line = describeWriterTimeout({
    launchedAt: T0, reachedLockAt: null, markerExpected: true, releasedAt: T0 + 10_300, exitedAt: null, waitMs: 10_000,
  });
  assert.match(line, /^it had not reached the lock 10\.3s after it was started, so it was still starting up/);
});

test('a writer that reached the lock and kept running is reported as running', () => {
  const line = describeWriterTimeout({
    launchedAt: T0, reachedLockAt: T0 + 400, markerExpected: true, releasedAt: T0 + 500, exitedAt: null, waitMs: 10_000,
  });
  assert.equal(line, 'it reached the lock 0.4s after it was started and it was still running 10.0s after the lock release');
});

test('a case that watches no marker never claims the writer was still starting', () => {
  const line = describeWriterTimeout({
    launchedAt: T0, reachedLockAt: null, markerExpected: false, releasedAt: T0 + 500, exitedAt: null, waitMs: 10_000,
  });
  assert.equal(line, 'it was still running 10.0s after the lock release');
});

test('an exit seen only after the wait is not counted as an exit in time', () => {
  const line = describeWriterTimeout({
    launchedAt: T0, reachedLockAt: T0 + 400, markerExpected: true, releasedAt: T0 + 500, exitedAt: T0 + 10_600, waitMs: 10_000,
  });
  assert.match(line, /still running 10\.0s after the lock release$/);
});
