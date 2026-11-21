import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNaukriHost, naukriExperienceFromSlug, naukriPostingId, parseNaukriPosting } from '../lib/naukri-url.mjs';
import { aggregatorPostingId, isAggregatorUrl } from '../url-key.mjs';

// Shapes measured on 2026-11-20 from https://www.naukri.com/sitemap/jobDescPagesNoida.xml
// (11,626 posting URLs, every one 12 digits and every one in this shape).
const POSTING = 'https://www.naukri.com/job-listings-manager-technology-nasscomm-noida-5-to-8-years-011026501721';

test('isNaukriHost matches Naukri only on a label boundary', () => {
  for (const host of ['naukri.com', 'www.naukri.com', 'm.naukri.com', 'NAUKRI.COM', 'www.naukri.com.']) {
    assert.ok(isNaukriHost(host), host);
  }
  for (const host of ['notnaukri.com', 'naukri.com.evil.example', 'example.com', '', null, undefined]) {
    assert.equal(isNaukriHost(host), false, String(host));
  }
});

test('parseNaukriPosting reads the id, the slug and the experience band', () => {
  const parsed = parseNaukriPosting(POSTING);
  assert.equal(parsed.id, '011026501721');
  assert.equal(parsed.slug, 'manager-technology-nasscomm-noida-5-to-8-years');
  assert.deepEqual(parsed.experience, { min: 5, max: 8 });
  assert.equal(parsed.url, POSTING);
});

test('parseNaukriPosting keeps the id-only form and strips query, fragment and trailing slash', () => {
  for (const raw of [
    'https://www.naukri.com/job-listings-011026501721',
    'https://www.naukri.com/job-listings-011026501721/',
    'https://www.naukri.com/job-listings-011026501721?src=jobsearchDesk&sid=1',
    'https://www.naukri.com/job-listings-011026501721#apply',
    'http://www.naukri.com/job-listings-011026501721',
  ]) {
    assert.equal(naukriPostingId(raw), '011026501721', raw);
  }
});

test('parseNaukriPosting rebuilds the mobile host on www, which answers 403', () => {
  const parsed = parseNaukriPosting('https://m.naukri.com/job-listings-011026501721');
  assert.equal(parsed.url, 'https://www.naukri.com/job-listings-011026501721');
});

test('parseNaukriPosting rejects a search page, a company page and junk', () => {
  for (const raw of [
    'https://www.naukri.com/python-jobs',
    'https://www.naukri.com/naukri-jobs-in-india',
    'https://www.naukri.com/company/acme',
    'https://www.naukri.com/job-listings-manager-0110', // 4 digits: a page suffix, not a posting
    'https://www.naukri.com/python-jobs-in-delhi-2',
    'https://www.naukri.com/jobapi/v3/search?keyword=python',
    'https://example.com/job-listings-011026501721',
    'not a url',
    '',
    null,
  ]) {
    assert.equal(parseNaukriPosting(raw), null, String(raw));
  }
});

test('naukriExperienceFromSlug handles a range, a single figure and neither', () => {
  assert.deepEqual(naukriExperienceFromSlug('analyst-pune-2-to-5-years'), { min: 2, max: 5 });
  assert.deepEqual(naukriExperienceFromSlug('analyst-pune-3-years'), { min: 3, max: 3 });
  assert.equal(naukriExperienceFromSlug('analyst-pune'), null);
  assert.equal(naukriExperienceFromSlug(''), null);
});

test('a Naukri URL is an aggregator URL, and its id is the posting identity', () => {
  assert.equal(isAggregatorUrl(POSTING), true);
  assert.deepEqual(aggregatorPostingId(POSTING), { domain: 'naukri.com', id: '011026501721' });
  // Same posting, a slug the poster rewrote: one identity, never two rows.
  assert.deepEqual(
    aggregatorPostingId('https://www.naukri.com/job-listings-manager-technology-nasscomm-pune-5-to-8-years-011026501721'),
    aggregatorPostingId(POSTING),
  );
  assert.equal(aggregatorPostingId('https://www.naukri.com/python-jobs'), null);
});
