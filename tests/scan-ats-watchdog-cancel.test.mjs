// #5570: a board's per-company watchdog must CANCEL the board, not just stop
// waiting on it. Before this, a timed-out Workday board kept paginating in the
// background — issuing requests and 4-attempt retries on a connection pool that
// had already been destroyed — so the process outlived its own summary.
//
// These exercise the carrier (the board's AbortController rides in the
// connection/abort scope), the watchdog→abort link in boardScope(), and the
// two fetch-layer effects: a retry storm stops once the board is aborted, and a
// timed-out board issues no further network requests.
//
// Run:  node --test tests/scan-ats-watchdog-cancel.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boardScope } from '../scan-ats-full.mjs';
import {
  withAbortScope,
  withConnectionScope,
  currentAbortSignal,
} from '../providers/_connection-scope.mjs';
import { fetchJsonWithRetry, fetchJson, abortableSleep } from '../providers/_http.mjs';

test('the board abort signal rides in the scope; none leaks outside it', async () => {
  assert.equal(currentAbortSignal(), null, 'no signal outside a board');

  const controller = new AbortController();
  let insideAbort = null;
  let insideConn = null;
  await withAbortScope(controller.signal, async () => {
    insideAbort = currentAbortSignal();
  });
  await withConnectionScope(async () => {
    insideConn = currentAbortSignal();
  }, { signal: controller.signal });

  assert.equal(insideAbort, controller.signal, 'withAbortScope carries the signal');
  assert.equal(insideConn, controller.signal, 'withConnectionScope carries the signal');
  assert.equal(currentAbortSignal(), null, 'the scope does not leak the signal');
});

test('boardScope aborts the board signal when the watchdog fires', async () => {
  let aborted = false;
  const started = Date.now();
  await boardScope({ singleHost: true }, 'fake/board', 40, async (signal) => {
    // The signal is handed to the callback AND readable from the scope, so the
    // retry loop can tell a timed-out board from a failed one.
    assert.ok(signal, 'the callback receives the board signal');
    assert.equal(signal, currentAbortSignal(), 'and it matches the scope signal');
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    aborted = signal.aborted;
  }).catch(() => {}); // withTimeout rejects with the timeout error
  assert.ok(aborted, 'the watchdog aborts the board signal');
  assert.ok(Date.now() - started < 2000, 'the board settles promptly after the watchdog');
});

test('a retry storm stops the moment the board is aborted', async () => {
  // A retryable error (no .status) would normally be retried `retries` times.
  // Once the board's watchdog has aborted, the abort is terminal: one attempt.
  const controller = new AbortController();
  let calls = 0;
  const ctx = {
    fetchJson: async () => {
      calls += 1;
      controller.abort(); // the watchdog fires during the first request
      throw new Error('fetch failed'); // network error, no status → retryable
    },
    sleep: async () => {},
  };

  await assert.rejects(() =>
    withAbortScope(controller.signal, () =>
      fetchJsonWithRetry(ctx, 'https://example.test/a', {}, { retries: 4 }),
    ),
  );
  assert.equal(calls, 1, 'no retries once the board is aborted (would be 5 before #5570)');
});

test('the shared HTTP layer folds the board signal into the request it sends', async () => {
  // Guards the combine in fetchInContext itself: the request fetch() receives
  // must carry the board's abort, not only this request's own timeout. Stub the
  // transport so no network is touched and capture the signal it is handed.
  const realFetch = globalThis.fetch;
  let seenSignal = null;
  globalThis.fetch = async (_url, options) => {
    seenSignal = options.signal;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const controller = new AbortController();
    controller.abort(); // the board's watchdog has already fired
    await withAbortScope(controller.signal, async () => {
      await fetchJson('https://example.test/a').catch(() => {});
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(seenSignal, 'the request carried an AbortSignal');
  assert.equal(seenSignal.aborted, true, 'the board abort reached the request signal');
});

test('abortableSleep resolves on abort and propagates a rejecting clock', async () => {
  // Resolves early when the signal aborts mid-sleep — under a deadline, so a
  // regression that waited out the 10s timer fails here instead of passing slow.
  const c1 = new AbortController();
  const p1 = abortableSleep(10_000, undefined, c1.signal);
  c1.abort();
  const deadline = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('abortableSleep did not resolve on abort')), 500),
  );
  await Promise.race([p1, deadline]);

  // A rejecting clock propagates (not an unhandled rejection, not a hang).
  const c2 = new AbortController();
  const boom = new Error('clock failed');
  await assert.rejects(
    () => abortableSleep(5, { sleep: async () => { throw boom; } }, c2.signal),
    /clock failed/,
  );
});

test('a timed-out board issues no further network requests', async () => {
  let network = 0; // requests that actually reach the "network"
  const ctx = {
    fetchJson: async () => {
      // A scoped request folds the board signal into its own: once the board is
      // aborted it rejects before leaving, so it never counts as network.
      if (currentAbortSignal()?.aborted) {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        throw err;
      }
      network += 1;
      await new Promise((r) => setTimeout(r, 20)); // a slow page, like a Workday slice
      throw new Error('fetch failed'); // retryable, so the board keeps trying the next slice
    },
    sleep: async () => {},
  };

  let networkAtWatchdog = -1;
  await boardScope({ singleHost: true }, 'workday/fake', 70, async () => {
    // A provider that does NOT check the signal itself, like today's loops: it
    // walks a bounded set of facet slices, catching each slice's failure.
    for (let slice = 0; slice < 50; slice += 1) {
      try {
        await fetchJsonWithRetry(ctx, `https://example.test/${slice}`, {}, { retries: 4 });
      } catch {
        // a real Workday loop logs the slice and moves to the next one
      }
    }
  }).catch(() => {
    networkAtWatchdog = network;
  });

  // Let every abandoned slice run; each must abort before the network now.
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(networkAtWatchdog >= 1, 'the board reached the network before the watchdog');
  assert.equal(network, networkAtWatchdog, 'no network request after the watchdog fired');
});
