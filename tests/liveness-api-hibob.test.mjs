// tests/liveness-api-hibob.test.mjs — the HiBob rung of the liveness ladder and
// its JD fetcher.
//
// A HiBob posting page reads one per-posting endpoint,
// `/api/job-ad/{uuid}/application-form`, with the tenant named in the
// `companyidentifier` header:
//
//   200 -> active (the page shows the posting)
//   404 -> expired (the page shows "No job openings match this URL")
//   401 -> null (the label is not a tenant; the browser decides)
//
// The same answer carries the posting text, so fetch-jd needs no browser.
// Company names, titles and ids are fictional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtsApi, checkLivenessViaApi, isAtsPosting, JD_TEXT_API_ATS } from '../liveness-api.mjs';
import { fetchJdViaKnownApi, normalizeHibobJob } from '../browser-extract.mjs';

const ID = '0b1c2d3e-0000-4000-8000-000000000001';
const POSTING = `https://acme.careers.hibob.com/jobs/${ID}`;
const API = `https://acme.careers.hibob.com/api/job-ad/${ID}/application-form`;

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

const field = (name) => `/jobAd/descriptionId./jobDescription/${name}`;
function applicationForm(overrides = {}) {
  return {
    metadata: { applicationForm: [] },
    data: {
      jobAd: {
        applicationForm: { id: 123 },
        type: 'api',
        title: 'Senior Backend Engineer',
        site: 'Berlin, Germany',
        languageCode: 'en',
        employmentType: 'Permanent',
        workspaceType: 'Hybrid',
        postingLocations: [],
        jobDescription: {
          [field('sectionLabels')]: { value: { requirements: 'What you bring' } },
          [field('description')]: { value: '<p>Build &amp; run services.</p>' },
          [field('responsibilities')]: { value: '<ul><li>Own the API</li></ul>' },
          [field('requirements')]: { value: '<ul><li>Node.js</li></ul>' },
          [field('benefits')]: { value: '<p>Learning budget</p>' },
          [field('payTransparencyMinSalary')]: { value: 70000 },
          [field('payTransparencyMaxSalary')]: { value: 85000 },
          [field('payTransparencySalaryCurrency')]: { value: 'EUR' },
          [field('payTransparencySalaryPayPeriod')]: { value: 'Annual' },
        },
        ...overrides,
      },
      companyLists: {},
      agency: null,
    },
  };
}

test('a posting or apply link resolves to the per-posting endpoint with the tenant header', () => {
  for (const url of [POSTING, `${POSTING}/apply`, `${POSTING}/`, `https://ACME.careers.hibob.com/jobs/${ID}?utm_source=x`]) {
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, 'hibob', url);
    assert.equal(resolved.apiUrl, API, url);
    assert.deepEqual(resolved.headers, { companyidentifier: 'acme' }, url);
  }
  const suffixed = resolveAtsApi(`https://acme-641e1b39232b.careers.hibob.com/jobs/${ID}`);
  assert.deepEqual(suffixed.headers, { companyidentifier: 'acme-641e1b39232b' });
  assert.ok(JD_TEXT_API_ATS.has('hibob'));
});

test('board pages, non-UUID ids, lookalike hosts and plain http do not resolve', () => {
  for (const url of [
    'https://acme.careers.hibob.com/jobs',
    'https://acme.careers.hibob.com/',
    'https://acme.careers.hibob.com/jobs/12345',
    `https://acme.careers.hibob.com/jobs/${ID}/apply/extra`,
    `https://acme.careers.hibob.com.evil.example/jobs/${ID}`,
    `https://careers.hibob.com/jobs/${ID}`,
    `http://acme.careers.hibob.com/jobs/${ID}`,
  ]) {
    assert.equal(isAtsPosting(url), false, url);
  }
});

test('a 200 answers active; the request sends the tenant header and refuses redirects', async () => {
  const calls = [];
  const verdict = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.redirect, opts.headers.companyidentifier]);
    return new Response(JSON.stringify(applicationForm()), { status: 200 });
  }, () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'active');
  assert.equal(verdict.code, 'hibob_api_ok');
  assert.deepEqual(calls, [[API, 'error', 'acme']]);
});

test('a 404 answers expired', async () => {
  const verdict = await withFetch(async () => new Response('{"message":"Could not find resource"}', { status: 404 }),
    () => checkLivenessViaApi(POSTING));
  assert.equal(verdict.result, 'expired');
  assert.equal(verdict.code, 'hibob_api_gone');
});

test('a 401 (not a tenant), a 5xx or a network error stays inconclusive', async () => {
  for (const mock of [
    async () => new Response('<html>Error 401 Unauthorized</html>', { status: 401 }),
    async () => new Response('', { status: 503 }),
    async () => { throw new TypeError('fetch failed'); },
  ]) {
    assert.equal(await withFetch(mock, () => checkLivenessViaApi(POSTING)), null);
  }
});

test('normalizeHibobJob builds the JD text with metadata, section labels and salary', () => {
  const jd = normalizeHibobJob(applicationForm(), POSTING);
  assert.equal(jd.url, POSTING);
  assert.equal(jd.title, 'Senior Backend Engineer');
  const lines = jd.text.split('\n');
  assert.deepEqual(lines.slice(0, 4), [
    'Location: Berlin, Germany',
    'Work model: Hybrid',
    'Type: Permanent',
    'Salary: 70,000 – 85,000 EUR Annual',
  ]);
  assert.match(jd.text, /Description:\nBuild & run services\./);
  assert.match(jd.text, /Responsibilities:\n- Own the API/);
  assert.match(jd.text, /What you bring:\n- Node\.js/, 'the tenant label replaces the default one');
  assert.match(jd.text, /Benefits:\nLearning budget/);
});

test('normalizeHibobJob leaves out a missing salary and returns null without text', () => {
  const noSalary = applicationForm();
  for (const name of ['payTransparencyMinSalary', 'payTransparencyMaxSalary']) noSalary.data.jobAd.jobDescription[field(name)] = { value: null };
  assert.doesNotMatch(normalizeHibobJob(noSalary, POSTING).text, /Salary:/);
  assert.equal(normalizeHibobJob(applicationForm({ jobDescription: {} }), POSTING), null);
  assert.equal(normalizeHibobJob({ data: {} }, POSTING), null);
  assert.equal(normalizeHibobJob(null, POSTING), null);
});

test('fetchJdViaKnownApi reads a HiBob posting through the same endpoint and header', async () => {
  const calls = [];
  const jd = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.redirect, opts.headers.companyidentifier]);
    return new Response(JSON.stringify(applicationForm()), { status: 200 });
  }, () => fetchJdViaKnownApi(`${POSTING}/apply`));
  assert.equal(jd.ats, 'hibob');
  assert.equal(jd.title, 'Senior Backend Engineer');
  assert.deepEqual(calls, [[API, 'error', 'acme']]);
  const gone = await withFetch(async () => new Response('{}', { status: 404 }), () => fetchJdViaKnownApi(POSTING));
  assert.equal(gone, null);
});
