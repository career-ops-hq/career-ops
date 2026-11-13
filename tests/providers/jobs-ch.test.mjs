import { test } from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseJobsChPage } from '../../providers/jobs-ch.mjs';
import { boardTests } from './_scout-test-kit.mjs';
import { jobsChRow, jobsChPage } from './_scout-fixtures.mjs';

boardTests(provider, { entryConfig: { queries: ['engineer'] }, fixture: jobsChPage([jobsChRow(), null, {}, { ...jobsChRow('hidden'), company: { name: 'Secret', visible: false } }]), empty: jobsChPage([]), broken: ['', '<script>__INIT__ = {}; __LOAD_LAZY__ = false;</script>', jobsChPage(null), '<script>__INIT__ = invalid; __LOAD_LAZY__ = false;</script>'], full: jobsChPage([jobsChRow(), ...Array(19).fill(null)]) });
test('jobs.ch: missing search scope is a config error before any request', async () => {
  let calls = 0;
  await assert.rejects(provider.fetch({}, { fetchText: async () => { calls++; } }), /configure.*queries/);
  assert.equal(calls, 0);
});
test('jobs.ch: source dates and overlapping query passes retain deeper unique rows', async () => {
  assert.equal(parseJobsChPage(jobsChPage([jobsChRow()])).jobs[0].postedAt, 0);
  assert.equal(parseJobsChPage(jobsChPage([jobsChRow('..'), jobsChRow()])).jobs.length, 1);
  const urls = [];
  const full = jobsChPage(Array.from({ length: 20 }, () => jobsChRow()));
  const jobs = await provider.fetch({ queries: ['data', 'engineer'], max_pages: 3 }, {
    sleep: async () => {}, fetchText: async (url, opts) => {
      assert.equal(opts.redirect, 'error'); urls.push(url);
      const u = new URL(url), page = u.searchParams.get('page') || '1';
      if (page === '1') return full;
      if (page === '2' && u.searchParams.get('term') === 'engineer') return jobsChPage([jobsChRow('unique')]);
      return jobsChPage([]);
    },
  });
  assert.equal(urls.length, 4);
  assert.equal(jobs.length, 2);
  assert.ok(jobs.some(j => j.url.endsWith('/unique/')));
  urls.length = 0;
  await provider.fetch({ queries: ['data', 'engineer'] }, { maxPages: 1, fetchText: async url => { urls.push(url); return full; } });
  assert.equal(urls.length, 1);
});
