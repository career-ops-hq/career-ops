// tests/liveness-browser-timeout-retry.test.mjs — a navigation that times out is
// retried once with a longer budget; nothing else is retried.
//
// block.xyz's careers page took longer than the 15 s navigation budget on a cold
// load, so a live posting came back `uncertain` (navigation_error) and stayed
// unresolved. The retry is the whole fix; the properties that keep it safe:
//   1. only a TimeoutError is retried — a refused connection or DNS failure would
//      fail identically and only double the cost;
//   2. a guard block is never retried (the guard's verdict must stand);
//   3. exactly one retry, with the longer timeout.
//
// Run:  node --test tests/liveness-browser-timeout-retry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gotoWithTimeoutRetry } from '../liveness-browser.mjs';

const timeoutError = () => Object.assign(new Error('page.goto: Timeout 15000ms exceeded.'), { name: 'TimeoutError' });

function fakePage(script) {
  const calls = [];
  return {
    calls,
    _blockedByGuard: null,
    async goto(url, opts) {
      calls.push(opts.timeout);
      const step = script[calls.length - 1];
      if (step instanceof Error) throw step;
      return { status: () => step };
    },
  };
}

test('a timeout is retried once with the longer budget', async () => {
  const page = fakePage([timeoutError(), 200]);
  const res = await gotoWithTimeoutRetry(page, 'https://acme.example/jobs/1', { timeoutMs: 15, retryTimeoutMs: 30 });
  assert.equal(res.status(), 200);
  assert.deepEqual(page.calls, [15, 30]);
});

test('a second timeout is thrown, not retried again', async () => {
  const page = fakePage([timeoutError(), timeoutError(), 200]);
  await assert.rejects(gotoWithTimeoutRetry(page, 'https://acme.example/jobs/1', { timeoutMs: 15, retryTimeoutMs: 30 }), { name: 'TimeoutError' });
  assert.equal(page.calls.length, 2);
});

test('a non-timeout failure is not retried', async () => {
  const page = fakePage([new Error('net::ERR_CONNECTION_REFUSED'), 200]);
  await assert.rejects(gotoWithTimeoutRetry(page, 'https://acme.example/jobs/1', { timeoutMs: 15, retryTimeoutMs: 30 }), /CONNECTION_REFUSED/);
  assert.equal(page.calls.length, 1);
});

test('a guard block is never retried', async () => {
  const page = fakePage([timeoutError(), 200]);
  page._blockedByGuard = { code: 'blocked_host', reason: 'private target' };
  await assert.rejects(gotoWithTimeoutRetry(page, 'https://acme.example/jobs/1', { timeoutMs: 15, retryTimeoutMs: 30 }), { name: 'TimeoutError' });
  assert.equal(page.calls.length, 1);
});

test('a first navigation that succeeds makes one call', async () => {
  const page = fakePage([200]);
  await gotoWithTimeoutRetry(page, 'https://acme.example/jobs/1', { timeoutMs: 15, retryTimeoutMs: 30 });
  assert.deepEqual(page.calls, [15]);
});

test('a retry budget no larger than the first disables the retry', async () => {
  const page = fakePage([timeoutError(), 200]);
  await assert.rejects(gotoWithTimeoutRetry(page, 'https://acme.example/jobs/1', { timeoutMs: 15, retryTimeoutMs: 0 }), { name: 'TimeoutError' });
  assert.equal(page.calls.length, 1);
});
