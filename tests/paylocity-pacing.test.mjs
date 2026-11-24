// Paylocity holds a client to a request rate (5 requests inside about a second
// earned a 30 s block). The provider spaces requests for every worker and
// pauses all of them for a 429's Retry-After.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
// The interval is read at import time, so pin it before loading the provider.
process.env.CAREER_OPS_PAYLOCITY_MIN_INTERVAL_MS = '400';
const { default: provider, pacing, waitForSlot, noteRateLimit } = await import('../providers/paylocity.mjs');

const GUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PAGE = 'x<script>window.pageData = {"Jobs":[{"JobId":1,"JobTitle":"Director"}]};</script>';
const reset = () => { pacing.nextSlot = 0; pacing.blockedUntil = 0; pacing.lastDispatch = -Infinity; };

test('waitForSlot queues concurrent callers at the minimum interval', async () => {
  reset();
  let t = 1_000;
  const slept = [];
  const pending = [];
  const ctx = { sleep: (ms) => { slept.push(ms); return new Promise((resolve) => { pending.push({ wake: t + ms, resolve }); }); } };
  const opts = { now: () => t, minIntervalMs: 400 };
  const done = Promise.all([waitForSlot(ctx, opts), waitForSlot(ctx, opts), waitForSlot(ctx, opts)]);
  // Fire each timer on time, earliest first.
  for (let guard = 0; pending.length && guard < 20; guard++) {
    pending.sort((a, b) => a.wake - b.wake);
    const next = pending.shift();
    t = Math.max(t, next.wake);
    next.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await done;
  assert.deepEqual(slept, [400, 800]);
});

test('callers whose timers fire late together still dispatch at the minimum interval', async () => {
  reset();
  let t = 1_000;
  const pending = [];
  const ctx = { sleep: (ms) => new Promise((resolve) => { pending.push({ wake: t + ms, resolve }); }) };
  const opts = { now: () => t, minIntervalMs: 400 };
  const dispatched = [];
  const go = () => waitForSlot(ctx, opts).then(() => { dispatched.push(t); });
  const done = Promise.all([go(), go(), go()]);
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  await turn();
  // The loop stalls past both reserved slots (1400 and 1800); both timers fire at 2000.
  t = 2_000;
  for (const p of pending.splice(0)) p.resolve();
  for (let guard = 0; dispatched.length < 3 && guard < 20; guard++) {
    await turn();
    const next = pending.shift();
    if (next) { t = Math.max(t, next.wake); next.resolve(); }
  }
  await done;
  assert.equal(dispatched.length, 3);
  for (let i = 1; i < dispatched.length; i++) assert.ok(dispatched[i] - dispatched[i - 1] >= 400, `dispatches ${dispatched.join(', ')}`);
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

test('a 429 with an HTTP-date Retry-After pauses until that date', () => {
  reset();
  const t = 5_000;
  const retryAfter = new Date(Date.now() + 90_000).toUTCString();
  noteRateLimit(Object.assign(new Error('x'), { status: 429, retryAfter }), () => t);
  const blockMs = pacing.blockedUntil - t;
  assert.ok(blockMs > 85_000 && blockMs <= 90_000, `block ${blockMs} ms`);
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
  mock.timers.enable({ apis: ['Date'], now: 10_000 });
  const slept = [];
  const http = { transport: 'http', sleep: async (ms) => { slept.push(ms); mock.timers.tick(ms); }, fetchText: async () => PAGE };
  await provider.fetch({ name: 'A', careers_url: `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}` }, http);
  await provider.fetch({ name: 'A', careers_url: `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}` }, http);
  assert.deepEqual(slept, [400]);
  mock.timers.reset();
  const stubSlept = [];
  const stub = { sleep: async (ms) => { stubSlept.push(ms); }, fetchText: async () => PAGE };
  await provider.fetch({ name: 'A', careers_url: `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}` }, stub);
  assert.deepEqual(stubSlept, []);
});

test('a zero interval turns pacing off on the real HTTP transport', async () => {
  const prev = process.env.CAREER_OPS_PAYLOCITY_MIN_INTERVAL_MS;
  process.env.CAREER_OPS_PAYLOCITY_MIN_INTERVAL_MS = '0';
  // A query string loads a separate module instance that reads the interval afresh.
  let off;
  try {
    ({ default: off } = await import('../providers/paylocity.mjs?interval=0'));
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_PAYLOCITY_MIN_INTERVAL_MS;
    else process.env.CAREER_OPS_PAYLOCITY_MIN_INTERVAL_MS = prev;
  }
  const slept = [];
  const http = { transport: 'http', sleep: async (ms) => { slept.push(ms); }, fetchText: async () => PAGE };
  await off.fetch({ name: 'A', careers_url: `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}` }, http);
  await off.fetch({ name: 'A', careers_url: `https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}` }, http);
  assert.deepEqual(slept, []);
});
