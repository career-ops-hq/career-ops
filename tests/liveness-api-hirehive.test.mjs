// tests/liveness-api-hirehive.test.mjs — the HireHive rung of the liveness
// ladder and its JD text fetcher.
//
//   200 with this posting's id             -> active
//   404 "Job is not published"             -> expired
//   404 with any other message, other ids  -> null, the browser decides
//
// Run:  node --test tests/liveness-api-hirehive.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtsApi, checkLivenessViaApi, classifyHireHivePosting, isAtsPosting, JD_TEXT_API_ATS } from '../liveness-api.mjs';
import { fetchJdViaKnownApi, normalizeHireHiveJob } from '../browser-extract.mjs';

const POSTING = 'https://acme.hirehive.com/backend-engineer-berlin-Ab12Cd';
const V2 = 'https://acme.hirehive.com/api/v2/jobs/job_Ab12Cd';
const BY_NUMBER = 'https://acme.hirehive.com/job/214176/backend-engineer';
const V1 = 'https://acme.hirehive.com/api/v1/jobs/214176';

const posting = (over = {}) => ({
  id: 'job_Ab12Cd',
  title: 'Backend Engineer',
  location: 'Berlin',
  state_code: null,
  country: { name: 'Germany', code: 'DE' },
  description: { html: '<p>Build <strong>APIs</strong> &amp; tools for ExampleCo customers.</p>', text: 'Build APIs & tools.' },
  type: { type: 'FullTime', name: 'Full Time' },
  language: { name: 'English', code: 'en-US' },
  published_date: '2026-10-20T09:30:00Z',
  hosted_url: POSTING,
  ...over,
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test('both posting URL forms resolve to the per-posting API on the same tenant', () => {
  const slug = resolveAtsApi(POSTING);
  assert.equal(slug.ats, 'hirehive');
  assert.equal(slug.apiUrl, V2);
  assert.deepEqual(slug.parts, { host: 'acme.hirehive.com', version: 'v2', id: 'job_Ab12Cd' });
  assert.equal(resolveAtsApi(`${POSTING}?source=google_jobs_apply`).apiUrl, V2);
  assert.equal(resolveAtsApi(`${POSTING}/`).apiUrl, V2);

  const num = resolveAtsApi(BY_NUMBER);
  assert.equal(num.apiUrl, V1);
  assert.deepEqual(num.parts, { host: 'acme.hirehive.com', version: 'v1', id: '214176' });
  assert.equal(resolveAtsApi('https://acme.hirehive.com/job/214176').apiUrl, V1);
  assert.equal(resolveAtsApi('https://ACME.hirehive.com/job/214176/').apiUrl, V1);
  assert.ok(JD_TEXT_API_ATS.has('hirehive'));
});

test('board pages, vendor hosts and lookalike hosts do not resolve', () => {
  for (const url of [
    'https://acme.hirehive.com/',
    'https://acme.hirehive.com/Embed',
    'https://acme.hirehive.com/backend-engineer-berlin-Ab12Cd/apply',
    'https://acme.hirehive.com/job/abc/x',
    'https://www.hirehive.com/pricing-plans',
    'https://app.hirehive.com/some-path',
    'https://apply.hirehive.com/214176/apply/linkedin',
    'https://acme.hirehive.com.evil.test/backend-engineer-Ab12Cd',
    'https://evilhirehive.com/backend-engineer-Ab12Cd',
    'http://acme.hirehive.com/backend-engineer-Ab12Cd',
  ]) {
    assert.equal(isAtsPosting(url), false, url);
  }
});

test('a published posting answers active; the request refuses redirects', async () => {
  const calls = [];
  const verdict = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.redirect, opts.headers.accept]);
    return json(posting());
  }, () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'active');
  assert.equal(verdict.code, 'hirehive_api_ok');
  assert.deepEqual(calls, [[V2, 'error', 'application/json']]);
});

test('the number form is checked against the v1 numeric id', async () => {
  const verdict = await withFetch(async () => json({ id: 214176, title: 'Backend Engineer' }), () => checkLivenessViaApi(BY_NUMBER));
  assert.equal(verdict.result, 'active');
});

test('an unpublished posting answers expired', async () => {
  const verdict = await withFetch(async () => json({ message: 'Job is not published' }, 404), () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'expired');
  assert.equal(verdict.code, 'hirehive_unpublished');
});

test('unknown ids, unknown tenants and other answers stay inconclusive', async () => {
  for (const [body, status] of [
    [{ message: 'Job not found' }, 404],
    [{ message: 'Company not found' }, 404],
    [{ message: 'Job does not match company' }, 404],
    [{ title: 'Not Found', status: 404 }, 404],
    [posting({ id: 'job_Other1' }), 200],
    [posting({ title: '' }), 200],
    [{ message: 'gone' }, 410],
    [{}, 500],
  ]) {
    const verdict = await withFetch(async () => json(body, status), () => checkLivenessViaApi(POSTING));
    assert.equal(verdict, null, `${status} ${JSON.stringify(body).slice(0, 40)}`);
  }
  const html = await withFetch(async () => new Response('<html>Page not found</html>', { status: 404 }), () => checkLivenessViaApi(POSTING));
  assert.equal(html, null);
  const rejected = await withFetch(async () => { throw new TypeError('redirect'); }, () => checkLivenessViaApi(POSTING));
  assert.equal(rejected, null);
});

test('classifyHireHivePosting is pure on its inputs', () => {
  assert.equal(classifyHireHivePosting(null, 'job_Ab12Cd', 200), null);
  assert.equal(classifyHireHivePosting(posting(), 'job_Ab12Cd', 200).result, 'active');
  assert.equal(classifyHireHivePosting({ id: 214176, title: 'X' }, '214176', 200).result, 'active');
});

test('normalizeHireHiveJob shapes the JD and rejects another posting', () => {
  const jd = normalizeHireHiveJob(posting(), 'job_Ab12Cd', POSTING);
  assert.equal(jd.url, POSTING);
  assert.equal(jd.title, 'Backend Engineer');
  assert.match(jd.text, /Location: Berlin, Germany/);
  const countryOnly = normalizeHireHiveJob(posting({ location: 'Germany' }), 'job_Ab12Cd', POSTING);
  assert.match(countryOnly.text, /Location: Germany\n/);
  assert.match(jd.text, /Job type: Full Time/);
  assert.match(jd.text, /Posted: 2026-10-20/);
  assert.match(jd.text, /Build APIs & tools for ExampleCo customers\./);
  assert.equal(normalizeHireHiveJob(posting(), 'job_Other1', POSTING), null);
  assert.equal(normalizeHireHiveJob(posting({ description: { html: '', text: '' } }), 'job_Ab12Cd', POSTING), null);
  assert.equal(normalizeHireHiveJob(null, 'job_Ab12Cd', POSTING), null);
  const v1 = normalizeHireHiveJob({ id: 214176, title: 'Backend Engineer', publishedDate: 1793724762, description: { html: '<p>Body</p>' } }, '214176', BY_NUMBER);
  assert.match(v1.text, /Posted: 2026-11-03/);
});

test('fetchJdViaKnownApi reads the JD through the per-posting API', async () => {
  const calls = [];
  const jd = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.redirect]);
    return json(posting());
  }, () => fetchJdViaKnownApi(POSTING));
  assert.equal(jd.ats, 'hirehive');
  assert.equal(jd.title, 'Backend Engineer');
  assert.match(jd.text, /Build APIs/);
  assert.deepEqual(calls, [[V2, 'error']]);

  const gone = await withFetch(async () => json({ message: 'Job is not published' }, 404), () => fetchJdViaKnownApi(POSTING));
  assert.equal(gone, null);
});
