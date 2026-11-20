// Host-family pacing (providers/_host-pacing.mjs) and the deferred retry of
// rate-limited boards (lib/deferred-board-retry.mjs).
//
// 2026-11-19/20: two full scans each had 83-84 of 91 Workday boards answer
// `429 cf-mitigated: challenge` within ~30 s, because ten Workday tenants on
// ten different hostnames shared one Cloudflare edge and per-hostname limits
// never saw the sum. Every board that was challenged was then dropped for the
// run. These tests pin the two structural fixes, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureHostPacing, createPacer, hostFamily, pacerForHost, resetHostPacing, hostPacingStats,
} from '../../providers/_host-pacing.mjs';
import { fetchJson } from '../../providers/_http.mjs';
import {
  isRateLimitedError, rateLimitedItem, resolveRateLimitRetry, retryRateLimitedBoards,
} from '../../lib/deferred-board-retry.mjs';

function fakeClock() {
  let t = 1_000_000;
  const slept = [];
  return {
    now: () => t,
    sleep: async (ms) => { slept.push(ms); t += ms; },
    advance: (ms) => { t += ms; },
    slept,
  };
}

function challengeError(retryAfter = null) {
  const err = new Error('HTTP 429 (Cloudflare challenge, cf-mitigated: challenge)');
  err.status = 429;
  err.cfMitigated = 'challenge';
  err.retryAfter = retryAfter;
  return err;
}

test('every Workday tenant host maps to one family; other hosts are not paced', () => {
  assert.equal(hostFamily('visa.wd5.myworkdayjobs.com'), 'workday');
  assert.equal(hostFamily('ms.wd5.myworkdayjobs.com'), 'workday');
  assert.equal(hostFamily('wd3.myworkdaysite.com'), 'workday');
  assert.equal(hostFamily('boards-api.greenhouse.io'), null);
  assert.equal(hostFamily('myworkdayjobs.com.evil.example'), null);
});

test('pacing is off until configured', () => {
  resetHostPacing();
  assert.equal(pacerForHost('visa.wd5.myworkdayjobs.com'), null);
});

test('the pacing interval is honored ACROSS two Workday hosts (one shared budget)', async () => {
  // Time stands still while the reservations are taken, as it does when
  // concurrent requests arrive in one tick.
  const t0 = 1_000_000;
  configureHostPacing({ workday: { requests_per_minute: 600 } }, { now: () => t0, sleep: async () => {} }); // 100 ms
  try {
    const a = pacerForHost('visa.wd5.myworkdayjobs.com');
    const b = pacerForHost('adobe.wd5.myworkdayjobs.com');
    assert.equal(a, b, 'two tenants share one pacer');
    assert.equal(pacerForHost('boards-api.greenhouse.io'), null);
    // Three concurrent reservations from two hosts queue 100 ms apart.
    const waits = await Promise.all([a.acquire(), b.acquire(), a.acquire()]);
    assert.deepEqual(waits, [0, 100, 200]);
    assert.equal(hostPacingStats().workday.requests, 3);
  } finally {
    resetHostPacing();
  }
});

test('fetchJson to two Workday hosts is spaced by the family interval (stub transport)', async () => {
  configureHostPacing({ workday: { requests_per_minute: 1200 } }); // 50 ms, real clock
  const realFetch = globalThis.fetch;
  const starts = [];
  globalThis.fetch = async (url) => {
    starts.push({ host: new URL(String(url)).hostname, at: performance.now() });
    return new Response('{"total":0,"jobPostings":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await Promise.all([
      fetchJson('https://visa.wd5.myworkdayjobs.com/wday/cxs/visa/Visa/jobs'),
      fetchJson('https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/ext/jobs'),
      fetchJson('https://visa.wd5.myworkdayjobs.com/wday/cxs/visa/Visa/jobs'),
      fetchJson('https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/ext/jobs'),
    ]);
    assert.equal(starts.length, 4);
    assert.deepEqual(new Set(starts.map((s) => s.host)).size, 2);
    const sorted = starts.map((s) => s.at).sort((x, y) => x - y);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i] - sorted[i - 1] >= 40, `gap ${i} was ${sorted[i] - sorted[i - 1]} ms, expected ~50`);
    }
  } finally {
    globalThis.fetch = realFetch;
    resetHostPacing();
  }
});

test('a challenge anywhere in the family slows the whole family and holds it for Retry-After', async () => {
  const clock = fakeClock();
  const pacer = createPacer({ requestsPerMinute: 60, ...clock }); // 1000 ms base
  await pacer.acquire();
  pacer.onRateLimited(45_000);
  assert.equal(pacer.intervalMs, 2000, 'interval doubled');
  const waited = await pacer.acquire();
  assert.ok(waited >= 45_000, `held for Retry-After, waited ${waited}`);
  pacer.onRateLimited(null);
  assert.equal(pacer.intervalMs, 4000);
  pacer.onRateLimited(null); // lands inside the hold: ignored, no stacking
  assert.equal(pacer.intervalMs, 4000, 'a signal inside an active hold does not stack');
  clock.advance(31_000);
  pacer.onRateLimited(null);
  clock.advance(31_000);
  pacer.onRateLimited(null);
  assert.equal(pacer.intervalMs, 8000, 'backoff is bounded at 8x base');
  for (let i = 0; i < 20; i++) pacer.onSuccess();
  assert.equal(pacer.intervalMs, 4000, 'a run of successes halves it back');
});

test('fetchJson feeds a Cloudflare challenge back into the family pacer', async () => {
  configureHostPacing({ workday: { requests_per_minute: 6000 } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>challenge</html>', {
    status: 429, headers: { 'cf-mitigated': 'challenge', 'retry-after': '0' },
  });
  try {
    await assert.rejects(fetchJson('https://visa.wd5.myworkdayjobs.com/wday/cxs/visa/Visa/jobs'), (err) => isRateLimitedError(err));
    const st = hostPacingStats().workday;
    assert.equal(st.rateLimited, 1);
    assert.equal(st.intervalMs, 20, 'interval doubled from 10 ms');
  } finally {
    globalThis.fetch = realFetch;
    resetHostPacing();
  }
});

test('pacing is opt-in per family; a bad rate warns and leaves the family unpaced', () => {
  const warnings = [];
  assert.deepEqual(configureHostPacing({}, { warn: (m) => warnings.push(m) }), {});
  assert.equal(pacerForHost('visa.wd5.myworkdayjobs.com'), null);
  const rates = configureHostPacing({ workday: { requests_per_minute: 0 } }, { warn: (m) => warnings.push(m) });
  assert.deepEqual(rates, {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /NOT paced/);
  resetHostPacing();
});

test('isRateLimitedError: 429 and challenges yes, 403/404/5xx no', () => {
  assert.ok(isRateLimitedError(challengeError()));
  assert.ok(isRateLimitedError({ status: 429 }));
  assert.ok(isRateLimitedError({ status: 403, cfMitigated: 'challenge' }));
  assert.ok(!isRateLimitedError({ status: 403 }));
  assert.ok(!isRateLimitedError({ status: 404 }));
  assert.ok(!isRateLimitedError({ status: 503 }));
});

test('resolveRateLimitRetry validates per key', () => {
  const warnings = [];
  const p = resolveRateLimitRetry({ rounds: 2, base_delay_s: -1, concurrency: 1.5 }, (m) => warnings.push(m));
  assert.deepEqual(p, { rounds: 2, base_delay_s: 60, max_delay_s: 300, concurrency: 2 });
  assert.equal(warnings.length, 2);
  assert.equal(resolveRateLimitRetry({ rounds: 0 }).rounds, 0);
});

// A tiny stand-in for scan.mjs's task + recordError: a board that fails on a
// rate signal pushes itself back onto the queue, exactly as recordError does.
function harness(behaviour, clock) {
  const queue = [];
  const failed = new Map();
  const recovered = new Set();
  const attempts = new Map();
  const runBoard = async (company) => {
    const n = (attempts.get(company.name) || 0) + 1;
    attempts.set(company.name, n);
    const outcome = behaviour[company.name](n);
    if (outcome === 'ok') return;
    failed.set(company.name, outcome.message);
    queue.push(rateLimitedItem(company, outcome, clock.now()));
  };
  return { queue, failed, recovered, attempts, runBoard };
}

test('a challenged board is re-queued, retried after the backoff, and recovered', async () => {
  const clock = fakeClock();
  const h = harness({
    Visa: (n) => (n === 1 ? challengeError() : 'ok'),
    Adobe: () => 'ok',
  }, clock);
  // The sweep.
  await h.runBoard({ name: 'Visa' });
  await h.runBoard({ name: 'Adobe' });
  assert.equal(h.queue.length, 1);
  clock.advance(20_000); // the rest of the sweep took 20 s
  const { rounds, retried } = await retryRateLimitedBoards({
    queue: h.queue,
    runBoard: async (company) => {
      await h.runBoard(company);
      if (!h.failed.has(company.name)) h.recovered.add(company.name);
    },
    beforeRetry: ({ company }) => h.failed.delete(company.name),
    now: clock.now,
    sleep: clock.sleep,
  });
  assert.equal(rounds, 1);
  assert.deepEqual([...retried].map((c) => c.name), ['Visa']);
  assert.deepEqual(clock.slept, [40_000], 'waited the 60 s backoff measured from the failure, minus the 20 s already spent');
  assert.deepEqual([...h.recovered], ['Visa']);
  assert.equal(h.failed.size, 0);
  assert.equal(h.queue.length, 0);
});

test('a permanently challenged board lands in the failed list after the retry budget', async () => {
  const clock = fakeClock();
  const h = harness({ Sunrun: () => challengeError('120') }, clock);
  await h.runBoard({ name: 'Sunrun' });
  const lines = [];
  const { rounds } = await retryRateLimitedBoards({
    queue: h.queue,
    runBoard: (company) => h.runBoard(company),
    beforeRetry: ({ company }) => h.failed.delete(company.name),
    now: clock.now,
    sleep: clock.sleep,
    log: (l) => lines.push(l),
  });
  assert.equal(rounds, 1, 'a round that reads nothing ends the retries');
  assert.equal(h.attempts.get('Sunrun'), 2, 'one sweep attempt + one retry round');
  assert.ok(h.failed.has('Sunrun'), 'still failed, so the caller reports it');
  assert.equal(h.queue.length, 1, 'left on the queue after the last round');
  // Retry-After 120 s wins over the 60 s first backoff.
  assert.deepEqual(clock.slept, [120_000]);
  assert.match(lines[0], /retry round 1 of 3.*Sunrun/);
  assert.match(lines[1], /read none of 1 .*stopping/);
});

test('a round that recovers some boards leads to another round; the rest end failed', async () => {
  const clock = fakeClock();
  const h = harness({
    A: (n) => (n < 2 ? challengeError() : 'ok'), // recovers in round 1
    B: () => challengeError(),                   // never
  }, clock);
  await h.runBoard({ name: 'A' });
  await h.runBoard({ name: 'B' });
  const recovered = new Set();
  const { rounds } = await retryRateLimitedBoards({
    queue: h.queue,
    runBoard: async (c) => { await h.runBoard(c); if (!h.failed.has(c.name)) recovered.add(c.name); },
    beforeRetry: ({ company }) => h.failed.delete(company.name),
    now: clock.now,
    sleep: clock.sleep,
  });
  assert.equal(rounds, 2, 'round 1 read A, so round 2 ran; round 2 read nothing, so it stopped');
  assert.deepEqual([...recovered], ['A']);
  assert.deepEqual([...h.failed.keys()], ['B']);
  assert.equal(h.attempts.get('B'), 3, 'one sweep attempt + 2 retry rounds');
  assert.deepEqual(clock.slept, [60_000, 120_000], 'backoff doubles per round');
});

test('rounds: 0 never retries', async () => {
  const clock = fakeClock();
  const h = harness({ Visa: () => challengeError() }, clock);
  await h.runBoard({ name: 'Visa' });
  const { rounds } = await retryRateLimitedBoards({
    queue: h.queue, runBoard: h.runBoard, policy: resolveRateLimitRetry({ rounds: 0 }), now: clock.now, sleep: clock.sleep,
  });
  assert.equal(rounds, 0);
  assert.equal(h.attempts.get('Visa'), 1);
});
