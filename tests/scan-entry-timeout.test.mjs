// tests/scan-entry-timeout.test.mjs — a portals.yml entry's timeout_ms sets the
// request timeout for that entry's fetches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEntryTimeout } from '../lib/entry-timeout.mjs';
import { fetchJsonWithRetry } from '../providers/_http.mjs';

// A ctx whose fetch methods record the options they were called with.
function recordingCtx() {
  const calls = [];
  const record = (method) => async (url, opts = {}) => { calls.push({ method, url, opts }); return method; };
  return { calls, ctx: { fetchJson: record('fetchJson'), fetchText: record('fetchText'), fetchResponse: record('fetchResponse') } };
}

test('an entry without timeout_ms leaves the ctx as it is', () => {
  const { ctx } = recordingCtx();
  const before = { ...ctx };
  applyEntryTimeout(ctx, { name: 'Acme' });
  assert.deepEqual(ctx, before);
});

test('timeout_ms reaches every fetcher and keeps the other options', async () => {
  const { ctx, calls } = recordingCtx();
  applyEntryTimeout(ctx, { name: 'BigCo', timeout_ms: 60_000 });
  await ctx.fetchJson('https://example.com/a', { redirect: 'error', maxBytes: 5 });
  await ctx.fetchText('https://example.com/b');
  await ctx.fetchResponse('https://example.com/c', { redirect: 'manual' });
  assert.deepEqual(calls.map((c) => c.opts.timeoutMs), [60_000, 60_000, 60_000]);
  assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(calls[0].opts.maxBytes, 5);
  assert.equal(calls[2].opts.redirect, 'manual');
});

test('the entry value wins over a timeoutMs the provider passes', async () => {
  const { ctx, calls } = recordingCtx();
  applyEntryTimeout(ctx, { name: 'BigCo', timeout_ms: 60_000 });
  await ctx.fetchJson('https://example.com/a', { timeoutMs: 30_000 });
  assert.equal(calls[0].opts.timeoutMs, 60_000);
});

test('the retry helper fetches through the entry timeout', async () => {
  const { ctx, calls } = recordingCtx();
  applyEntryTimeout(ctx, { name: 'BigCo', timeout_ms: 60_000 });
  await fetchJsonWithRetry(ctx, 'https://example.com/a', { timeoutMs: 30_000 });
  assert.equal(calls[0].opts.timeoutMs, 60_000);
});

test('an unusable timeout_ms is ignored with a warning naming the entry', (t) => {
  const warnings = [];
  t.mock.method(console, 'error', (msg) => { warnings.push(String(msg)); });
  const bads = [0, -5, 1.5, 2_147_483_648, 'big', '60000', true, [60000], Number.NaN, Number.POSITIVE_INFINITY];
  for (const bad of bads) {
    const { ctx } = recordingCtx();
    const before = ctx.fetchJson;
    applyEntryTimeout(ctx, { name: 'BadCo', timeout_ms: bad });
    assert.equal(ctx.fetchJson, before, `value: ${String(bad)}`);
  }
  assert.equal(warnings.length, bads.length);
  assert.ok(warnings.every((w) => w.includes('BadCo') && w.includes('timeout_ms')));
});
