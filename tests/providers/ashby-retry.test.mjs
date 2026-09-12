// tests/providers/ashby-retry.test.mjs — ashby must not retry a permanent
// failure, and must still retry a transient one (#3072).
//
// ashby.mjs hand-rolled its retry loop with an unconditional `catch (e) {
// lastErr = e; }`, so a board that is GONE was asked three times: 404, 401 and
// 410 each bought a second and third request that could only fail again.
// #2840 measured 684 of 3,161 Ashby boards as permanently 404, and argues that
// re-probing known-dead boards is the traffic that provokes the single-host
// throttle in #2839 — so tripling it is the same problem, worse.
//
// Counting REQUESTS rather than asserting an exit code is the point: the call
// fails either way, so only the request count distinguishes the fix from the
// bug. `ctx.sleep` is stubbed, so this exercises the retry policy with no real
// backoff and no network.
//
// Run:  node --test tests/providers/ashby-retry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// pathToFileURL, not a bare path: on Windows `join()` yields `D:\a\...`,
// which is not a valid ESM specifier, and the whole file fails at import.
// Same form tests/providers/ashby.test.mjs already uses.
const { default: ashby } = await import(pathToFileURL(join(ROOT, 'providers/ashby.mjs')).href);

const ENTRY = { name: 'DeadCo', careers_url: 'https://jobs.ashbyhq.com/deadco' };

/** Run one fetch that always throws `err`; return how many requests it made. */
async function requestsFor(err) {
  let calls = 0;
  const ctx = {
    fetchJson: async () => { calls++; throw err; },
    sleep: async () => {}, // no real backoff
  };
  await assert.rejects(() => ashby.fetch(ENTRY, ctx));
  return calls;
}

const httpErr = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test('a permanent failure costs exactly one request', async () => {
  for (const status of [404, 401, 410, 403, 400]) {
    const calls = await requestsFor(httpErr(status));
    assert.equal(calls, 1, `HTTP ${status} made ${calls} requests, want 1 — it cannot succeed on a retry`);
  }
});

test('a transient failure still gets the full attempt budget', async () => {
  // The point is narrowing WHICH errors are retried, not retrying less. If
  // this regressed to 1, the fix would have traded one bug for a worse one.
  for (const status of [429, 500, 502, 503]) {
    const calls = await requestsFor(httpErr(status));
    assert.equal(calls, 3, `HTTP ${status} made ${calls} requests, want 3`);
  }
});

test('a network error with no status is still retried', async () => {
  const calls = await requestsFor(new Error('socket hang up'));
  assert.equal(calls, 3, `network error made ${calls} requests, want 3`);
});

test('a successful fetch still parses, and makes exactly one request', async () => {
  let calls = 0;
  const ctx = {
    fetchJson: async () => {
      calls++;
      return { jobs: [{ title: 'Staff Engineer', jobUrl: 'https://jobs.ashbyhq.com/deadco/1', publishedAt: '2026-08-01T00:00:00Z' }] };
    },
    sleep: async () => {},
  };
  const jobs = await ashby.fetch(ENTRY, ctx);
  assert.equal(calls, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Staff Engineer');
  assert.equal(jobs[0].company, 'DeadCo');
  assert.equal(jobs[0].postedAt, Date.parse('2026-08-01T00:00:00Z'));
});

test('a transient failure that then succeeds returns the jobs', async () => {
  let calls = 0;
  const ctx = {
    fetchJson: async () => {
      calls++;
      if (calls === 1) throw httpErr(503);
      return { jobs: [{ title: 'Recovered', jobUrl: 'https://jobs.ashbyhq.com/deadco/2' }] };
    },
    sleep: async () => {},
  };
  const jobs = await ashby.fetch(ENTRY, ctx);
  assert.equal(calls, 2, 'should have retried once and then succeeded');
  assert.equal(jobs[0].title, 'Recovered');
});
