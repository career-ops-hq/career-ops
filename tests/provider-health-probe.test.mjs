/** Check bounded raw provider facts handed to Python portal health. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectHealth } from '../providers/_health_probe.mjs';

const entry = { name: 'Example', careers_url: 'https://example.com/jobs' };
const context = { fetchJson: async () => ({}), fetchText: async () => '' };

test('provider health returns raw count and status facts', async () => {
  const providers = new Map([['example', { id: 'example', detect: () => true,
    fetch: async (_entry, ctx) => { assert.equal(ctx.maxPages, 1); return [{ id: 1 }]; } }]]);
  assert.deepEqual(await collectHealth(entry, providers, context),
    { matched: true, provider: 'example', jobCount: 1, budgetReached: false });
});

test('fifth request trips the bounded probe without marking the board empty', async () => {
  const providers = new Map([['example', { id: 'example', detect: () => true,
    fetch: async (_entry, ctx) => { for (let i = 0; i < 5; i++) await ctx.fetchJson('https://example.com/jobs'); return []; } }]]);
  assert.deepEqual(await collectHealth(entry, providers, context),
    { matched: true, provider: 'example', budgetReached: true });
});

test('provider error remains raw and local parser is never executed', async () => {
  const error = Object.assign(new Error('gone'), { status: 404 });
  const providers = new Map([['example', { id: 'example', detect: () => true,
    fetch: async () => { throw error; } }]]);
  assert.deepEqual(await collectHealth(entry, providers, context),
    { matched: true, provider: 'example', budgetReached: false,
      error: 'gone', httpStatus: 404, errorName: 'Error' });
  assert.deepEqual(await collectHealth({ ...entry, provider: 'local-parser' }, providers, context),
    { matched: false });
});
