// tests/provider-stats-justjoin-nofluffjobs.test.mjs — JustJoin and NoFluffJobs
// report the offers they drop through `providerStats`, for the per-source table.
//
// Run:  node --test tests/provider-stats-justjoin-nofluffjobs.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import justjoin, { offerFilters, parseJustJoinResponse } from '../providers/justjoin.mjs';
import nofluffjobs, { workplaceFilter, parseNoFluffJobsResponse } from '../providers/nofluffjobs.mjs';

test('justjoin counts each offer under the first filter that dropped it', () => {
  const json = {
    data: [
      { slug: 'a', title: 'A', companyName: 'A', workplaceType: 'remote', isOpenToHireUkrainians: true },
      { slug: 'b', title: 'B', companyName: 'B', workplaceType: 'office', isOpenToHireUkrainians: true },
      { slug: 'c', title: 'C', companyName: 'C', workplaceType: 'remote', isOpenToHireUkrainians: false },
      { slug: 'd', title: 'D', companyName: 'D', workplaceType: 'remote', isOpenToHireUkrainians: true, languages: [{ code: 'pl', level: 'C1' }] },
    ],
  };
  const stats = { dropped: {} };
  const kept = parseJustJoinResponse(json, offerFilters({ workplace: ['remote'], open_to_ukrainians: true, max_polish_level: 'B1' }), stats);
  assert.equal(kept.length, 1);
  assert.deepEqual(stats.dropped, { workplace: 1, open_to_ukrainians: 1, max_polish_level: 1 });
});

test('justjoin.fetch() attaches providerStats without changing the job list', async () => {
  const page = { data: [
    { slug: 'a', title: 'A', companyName: 'A', workplaceType: 'remote' },
    { slug: 'b', title: 'B', companyName: 'B', workplaceType: 'office' },
  ], meta: { next: { cursor: null } } };
  const jobs = await justjoin.fetch(
    { name: 'JustJoin', careers_url: 'https://justjoin.it/job-offers/all-locations', workplace: ['remote'] },
    { transport: 'http', fetchJson: async () => page, fetchText: async () => '' },
  );
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs.providerStats, { dropped: { workplace: 1 } });
  assert.equal(JSON.stringify(jobs).includes('providerStats'), false, 'stats stay off the serialised list');
});

test('nofluffjobs counts postings dropped by the workplace filter', async () => {
  const page = { postings: [
    { title: 'A', name: 'A', url: 'a', fullyRemote: true },
    { title: 'B', name: 'B', url: 'b', fullyRemote: false },
    { title: 'C', name: 'C', url: 'c', fullyRemote: false },
  ], totalPages: 1 };
  const stats = { dropped: {} };
  assert.equal(parseNoFluffJobsResponse(page, workplaceFilter({ workplace: ['remote'] }), stats).length, 1);
  assert.deepEqual(stats.dropped, { workplace: 2 });

  const jobs = await nofluffjobs.fetch(
    { name: 'NoFluff', careers_url: 'https://nofluffjobs.com/pl', workplace: ['remote'], max_pages: 1 },
    { transport: 'http', fetchJson: async () => page, fetchText: async () => '' },
  );
  assert.deepEqual(jobs.providerStats, { dropped: { workplace: 2 } });
});
