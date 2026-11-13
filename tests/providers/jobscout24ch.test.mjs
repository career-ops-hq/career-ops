import { test } from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseJobscout24Page } from '../../providers/jobscout24ch.mjs';
import { boardTests } from './_scout-test-kit.mjs';
import { jobscoutCard, jobscoutPage } from './_scout-fixtures.mjs';

boardTests(provider, { fixture: jobscoutPage(jobscoutCard() + '<li class="job-list-item">Bad</li>'), empty: jobscoutPage(''), broken: ['<a href="/de/job/00000000-0000-4000-8000-000000000101/">Changed</a>'], full: jobscoutPage(jobscoutCard().repeat(20), true) });
test('JobScout24: source pager, company vs location, and invalid URL filtering', () => {
  const parsed = parseJobscout24Page(jobscoutPage(jobscoutCard() + jobscoutCard('bad-id')));
  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.jobs[0].location, 'Zürich');
  assert.equal(parsed.jobs[0].company, 'Acme & Co');
  assert.equal(parsed.more, false);
});
