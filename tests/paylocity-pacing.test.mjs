// Paylocity holds a client to a request rate (5 requests inside about a second
// earned a 30 s block). The provider spaces requests for every worker and
// pauses all of them for a 429's Retry-After.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// The interval is read at import time, so pin it before loading the provider.
process.env.CAREER_OPS_PAYLOCITY_MIN_INTERVAL_MS = '400';
const { default: provider, pacing, waitForSlot, noteRateLimit } = await import('../providers/paylocity.mjs');

const GUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PAGE = 'x<script>window.pageData = {"Jobs":[{"JobId":1,"JobTitle":"Director"}]};</script>';
const reset = () => { pacing.nextSlot = 0; pacing.blockedUntil = 0; };

test('waitForSlot queues concurrent callers at the minimum interval', async () => {
  reset();
  const t = 1_000;
  const slept = [];
  const ctx = { sleep: async (ms) => { slept.push(ms); } };
  const opts = { now: () => t, minIntervalMs: 400 };
  await Promise.all([waitForSlot(ctx, opts), waitForSlot(ctx, opts), waitForSlot(ctx, opts)]);
  assert.deepEqual(slept, [400, 800]);
});

test('a 429 pauses the next request for its Retry-After', async () => {
  reset();
  const t = 5_000;
  noteRateLimit(Object.assign(new Error('x'), { status: 429, retryAfter: '30' }), () => t);
  const slept = [];
  await waitForSlot({ sleep: async (ms) => { slept.push(ms); } }, { now: () => t, minIntervalMs: 400 });
  assert.deepEqual(slept, [30_000]);
  reset();
  noteRateLimit(Object.assign(new Error('x'), { status: 500, retryAfter: '30' }), () => t);
  assert.equal(pacing.blockedUntil, 0);
});

test('a 429 that lands while a caller sleeps extends that caller\'s wait', async () => {
  reset();
  let t = 1_000;
  const slept = [];
  let first = true;
  const ctx = {
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
      if (first) { first = false; noteRateLimit(Object.assign(new Error('x'), { status: 429, retryAfter: '30' }), () => t); }
    },
  };
  pacing.nextSlot = t + 400;
  await waitForSlot(ctx, { now: () => t, minIntervalMs: 400 });
  assert.deepEqual(slept, [400, 30_000]);
});

test('fetch on the real HTTP transport waits its turn; a stub context is not paced', async () => {
  reset();
  const slept = [];
  const http = { transport: 'http', sleep: async (ms) => { slept.push(ms); }, fetchText: async () => PAGE };
  await provider.fetch({ name: 'A', careers_url: `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}` }, http);
  await provider.fetch({ name: 'A', careers_url: `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}` }, http);
  assert.equal(slept.length, 1, 'the second request waits for the first slot');
  assert.ok(slept[0] > 300 && slept[0] <= 400, `slept ${slept[0]}`);
  const stubSlept = [];
  const stub = { sleep: async (ms) => { stubSlept.push(ms); }, fetchText: async () => PAGE };
  await provider.fetch({ name: 'A', careers_url: `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}` }, stub);
  assert.deepEqual(stubSlept, []);
});
