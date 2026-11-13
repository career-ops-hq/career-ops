import { test } from 'node:test';
import assert from 'node:assert/strict';
import braintrust, { normalizeBraintrustJob } from '../../providers/braintrust.mjs';

const btRow = (over = {}) => ({
  id: 18136, title: 'Data Analyst, Workforce Insights', employer: { name: 'Dayforce' }, job_type: 'freelance', contract_type: 'long',
  payment_type: 'hourly', budget_minimum_usd: '40.00', budget_maximum_usd: '50.00', expected_hours_per_week: 40,
  locations: [{ location: 'United States' }, { location: 'Germany' }], main_skills: [{ name: 'SQL' }], created: '2026-11-06T21:24:33Z', ...over,
});

test('braintrust: never pages (robots.txt), merges newest and oldest lists, one request while probing', async () => {
  const job = normalizeBraintrustJob(btRow());
  assert.equal(job.url, 'https://app.usebraintrust.com/jobs/18136/');
  assert.equal(job.company, 'Dayforce');
  assert.match(job.description, /Freelance via Braintrust, long-term\.\nHourly rate: \$40–\$50\.\nExpected 40 hours per week\./);
  assert.match(normalizeBraintrustJob(btRow({ payment_type: 'per_task', budget_minimum_usd: '1350.00', budget_maximum_usd: '1350.00' })).description, /Pay per task: \$1350\./);
  for (const bad of [null, btRow({ id: 'x' }), btRow({ title: '' })]) assert.equal(normalizeBraintrustJob(bad), null);
  const page = (ids, count) => ({ count, results: ids.map(id => btRow({ id })) });
  const calls = [];
  const full = { sleep: async () => {}, fetchJson: async (url, opts) => {
    calls.push(url); assert.equal(opts.redirect, 'error');
    return url.includes('ordering=created') ? page(Array.from({ length: 100 }, (_, i) => 150 - i), 150) : page(Array.from({ length: 100 }, (_, i) => i + 1), 150);
  } };
  const jobs = await braintrust.fetch({}, full);
  assert.equal(jobs.length, 150);
  assert.equal(calls.length, 2);
  for (const url of calls) assert.ok(!/[?&]page=/.test(url), `no page= parameter: ${url}`);
  calls.length = 0;
  assert.equal((await braintrust.fetch({}, { ...full, maxPages: 1 })).length, 100);
  assert.equal(calls.length, 1);
  calls.length = 0;
  await braintrust.fetch({}, { sleep: async () => {}, fetchJson: async url => { calls.push(url); return page([1, 2], 2); } });
  assert.equal(calls.length, 1, 'a short first list is the whole inventory');
  for (const body of [{}, { results: null }]) await assert.rejects(braintrust.fetch({}, { sleep: async () => {}, fetchJson: async () => body }), /braintrust/);
});
