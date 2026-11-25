// tests/providers/hibob.test.mjs: HiBob careers-site provider (providers/hibob.mjs).
// Offline only. The fixture has the shape of a real `/api/job-ad` answer
// (fields trimmed to the ones the provider reads plus a few it ignores);
// company names, titles and ids are fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseHibobJobAds, parseHibobSalary, resolveHibobTenant } from '../../providers/hibob.mjs';

const ORIGIN = 'https://acme.careers.hibob.com';
const API = `${ORIGIN}/api/job-ad`;

function row(overrides = {}) {
  return {
    id: '0b1c2d3e-0000-4000-8000-000000000001',
    title: 'Senior Backend Engineer',
    departmentId: 'Tech',
    department: 'Tech',
    employmentTypeId: 'Permanent',
    employmentType: 'Permanent',
    siteId: 12345,
    site: 'Berlin',
    country: 'Germany',
    language: 'en',
    description: '<p>Build &amp; run <b>services</b>.</p>',
    requirements: '<ul><li>Node.js</li></ul>',
    responsibilities: '<p>Own the API.</p>',
    benefits: '<p>Learning budget.</p>',
    sectionLabels: {},
    publishedAt: '2026-08-19T10:25:44.289429Z',
    workspaceTypeId: 'hybrid',
    workspaceType: 'Hybrid',
    payTransparencyMinSalary: null,
    payTransparencyMaxSalary: null,
    payTransparencySalaryCurrency: null,
    payTransparencySalaryPayPeriod: null,
    payTransparencySalaryAdditionalInfo: null,
    postingLocations: [],
    ...overrides,
  };
}

function payload(rows) {
  return {
    filterGroups: { departments: [], sites: [], jobTypes: [], workspaceTypes: [] },
    jobAdDetails: rows,
    jobOpeningMetadata: [{ dataPath: 'title', name: 'Job title', displayOnCareerPages: true }],
  };
}

function makeCtx(answer) {
  const calls = [];
  return {
    calls,
    ctx: {
      fetchJson: async (url, opts) => {
        calls.push({ url, opts });
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

test('id is hibob', () => {
  assert.equal(provider.id, 'hibob');
});

test('detect() claims the board root, a posting link and an apply link', () => {
  for (const careers_url of [
    'https://acme.careers.hibob.com',
    'https://acme.careers.hibob.com/jobs',
    'https://acme.careers.hibob.com/jobs/0b1c2d3e-0000-4000-8000-000000000001',
    'https://acme.careers.hibob.com/jobs/0b1c2d3e-0000-4000-8000-000000000001/apply',
    'https://ACME.careers.hibob.com:8443/jobs?x=1#top',
  ]) {
    assert.deepEqual(provider.detect({ name: 'Acme', careers_url }), { url: API }, careers_url);
  }
});

test('detect() keeps a suffixed tenant label as the host shows it', () => {
  assert.deepEqual(
    provider.detect({ careers_url: 'https://exampleco-641e1b39232b.careers.hibob.com/jobs' }),
    { url: 'https://exampleco-641e1b39232b.careers.hibob.com/api/job-ad' },
  );
});

test('detect() honours an explicit api: URL', () => {
  assert.deepEqual(provider.detect({ api: 'https://acme.careers.hibob.com/api/job-ad' }), { url: API });
});

test('detect() returns null for anything that is not a tenant host, without throwing', () => {
  for (const entry of [
    { careers_url: 'http://acme.careers.hibob.com/jobs' },
    { careers_url: 'https://careers.hibob.com/jobs' },
    { careers_url: 'https://www.hibob.com/careers/' },
    { careers_url: 'https://acme.careers.hibob.com.evil.example/jobs' },
    { careers_url: 'https://evilcareers.hibob.com/jobs' },
    { careers_url: 'https://a.b.careers.hibob.com/jobs' },
    { careers_url: 'https://-acme.careers.hibob.com/jobs' },
    { careers_url: 'https://evil.example/acme.careers.hibob.com/jobs' },
    { careers_url: 'not a url' },
    { careers_url: '' },
    { careers_url: null },
    { careers_url: 7 },
    {},
    null,
    undefined,
  ]) {
    assert.equal(provider.detect(entry), null, JSON.stringify(entry));
  }
});

test('resolveHibobTenant() reads only the host label', () => {
  assert.equal(resolveHibobTenant('https://acme.careers.hibob.com/jobs/x/apply'), 'acme');
  assert.equal(resolveHibobTenant('https://acme.careers.hibob.com.evil.example'), null);
});

test('fetch() sends one GET with the tenant header and redirect: error', async () => {
  const { ctx, calls } = makeCtx(payload([row()]));
  await provider.fetch({ name: 'Acme', careers_url: 'https://acme.careers.hibob.com/jobs/abc/apply' }, ctx);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, API);
  assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(calls[0].opts.headers.companyidentifier, 'acme');
  assert.ok(calls[0].opts.maxBytes > 10 * 1024 * 1024, 'raises the body cap above the shared default');
});

test('fetch() sends the tenant label in lower case', async () => {
  const { ctx, calls } = makeCtx(payload([]));
  await provider.fetch({ name: 'Acme', careers_url: 'https://ExampleCo-641E1B39232B.careers.hibob.com/jobs' }, ctx);
  assert.equal(calls[0].url, 'https://exampleco-641e1b39232b.careers.hibob.com/api/job-ad');
  assert.equal(calls[0].opts.headers.companyidentifier, 'exampleco-641e1b39232b');
});

test('fetch() refuses a non-tenant URL before any request', async () => {
  const { ctx, calls } = makeCtx(payload([]));
  for (const careers_url of ['https://acme.careers.hibob.com.evil.example/jobs', 'http://acme.careers.hibob.com/jobs', 'https://example.com/jobs']) {
    await assert.rejects(provider.fetch({ name: 'Acme', careers_url }, ctx), /not a HiBob careers site/);
  }
  assert.equal(calls.length, 0);
});

test('fetch() normalizes a posting', async () => {
  const { ctx } = makeCtx(payload([row()]));
  const [job] = await provider.fetch({ name: 'Acme', careers_url: `${ORIGIN}/jobs` }, ctx);
  assert.equal(job.title, 'Senior Backend Engineer');
  assert.equal(job.url, `${ORIGIN}/jobs/0b1c2d3e-0000-4000-8000-000000000001`);
  assert.equal(job.company, 'Acme');
  assert.equal(job.location, 'Berlin, Germany');
  assert.equal(job.postedAt, Date.parse('2026-08-19T10:25:44.289429Z'));
  assert.equal(job.language, 'en');
  assert.equal(job.description, 'Build & run services . Own the API. Node.js Learning budget.');
  assert.equal('requisitionId' in job, false);
  assert.equal('salary' in job, false);
});

test('an annual pay range becomes salary', () => {
  const [job] = parseHibobJobAds(payload([row({
    payTransparencyMinSalary: 48000,
    payTransparencyMaxSalary: 55000,
    payTransparencySalaryCurrency: 'eur',
    payTransparencySalaryPayPeriod: 'Annual',
    payTransparencySalaryAdditionalInfo: 'Plus a variable component.',
  })]), ORIGIN, 'Acme');
  assert.deepEqual(job.salary, { min: 48000, max: 55000, currency: 'EUR' });
});

test('parseHibobSalary: one-sided range, swapped bounds, zero and unknown period', () => {
  const s = (min, max, period = 'Annual', currency = 'USD') => parseHibobSalary({
    payTransparencyMinSalary: min, payTransparencyMaxSalary: max,
    payTransparencySalaryCurrency: currency, payTransparencySalaryPayPeriod: period,
  });
  assert.deepEqual(s(90000, null), { min: 90000, max: 90000, currency: 'USD' });
  assert.deepEqual(s(null, '120000'), { min: 120000, max: 120000, currency: 'USD' });
  assert.deepEqual(s(150000, 120000), { min: 120000, max: 150000, currency: 'USD' });
  assert.deepEqual(s(50000, 60000, 'Annual', null), { min: 50000, max: 60000, currency: '' });
  assert.equal(s(0, 0), null, 'a bound of 0 means not set');
  assert.equal(s(null, null), null);
  assert.equal(s('abc', -5), null);
  assert.equal(s(4000, 5000, 'Monthly'), null, 'an unseen period is not annualized by guess');
  assert.equal(s(40, 60, 'Hourly'), null);
  assert.equal(s(50000, 60000, null), null);
  assert.equal(parseHibobSalary(null), null);
});

test('location: country is not repeated, Remote comes from workspaceTypeId', () => {
  const jobs = parseHibobJobAds(payload([
    row({ id: 'a1', site: 'Germany', country: 'Germany' }),
    row({ id: 'a2', site: 'Lisbon', country: 'Portugal', workspaceTypeId: 'remote', workspaceType: 'Remote' }),
    row({ id: 'a3', site: 'APAC - Remote - India', country: 'India', workspaceTypeId: 'remote' }),
    row({ id: 'a4', site: 'Remote: UK', country: 'United Kingdom', workspaceTypeId: 'hybrid' }),
    row({ id: 'a5', site: 'Office HQ - Berlin', country: 'Germany', workspaceTypeId: 'on_site' }),
    row({ id: 'a6', site: '', country: 'France', workspaceTypeId: 'remote' }),
  ]), ORIGIN, 'Acme');
  assert.deepEqual(jobs.map((j) => j.location), [
    'Germany',
    'Lisbon, Portugal, Remote',
    'APAC - Remote - India',
    'Remote: UK, United Kingdom',
    'Office HQ - Berlin, Germany',
    'France, Remote',
  ]);
});

test('optional fields are left out when absent or malformed', () => {
  const [job] = parseHibobJobAds(payload([
    row({ publishedAt: 'not a date', language: null, description: null, requirements: null, responsibilities: null, benefits: null }),
  ]), ORIGIN, 'Acme');
  assert.equal('postedAt' in job, false);
  assert.equal('language' in job, false);
  assert.equal('description' in job, false);
});

test('rows without a title or id are skipped, the rest of the board stays', () => {
  const jobs = parseHibobJobAds(payload([
    row({ id: 'keep', title: 'QA Engineer' }),
    row({ id: 'no-title', title: '' }),
    row({ id: '', title: 'No Id' }),
    row({ id: 42, title: 'Numeric Id' }),
    null,
    'junk',
  ]), ORIGIN, 'Acme');
  assert.deepEqual(jobs.map((j) => j.title), ['QA Engineer']);
});

test('an empty jobAdDetails is an empty board', async () => {
  const { ctx } = makeCtx(payload([]));
  assert.deepEqual(await provider.fetch({ name: 'Acme', careers_url: ORIGIN }, ctx), []);
});

test('an answer without jobAdDetails[] throws and names what it got', () => {
  for (const [answer, got] of [
    [{}, /got: \[\]/],
    [{ jobAdDetails: null }, /got: \[jobAdDetails\]/],
    [{ jobAdDetails: {} }, /got: \[jobAdDetails\]/],
    [{ jobs: [] }, /got: \[jobs\]/],
    ['', /got: \[string\]/],
    [null, /got: \[object\]/],
    [7, /got: \[number\]/],
  ]) {
    assert.throws(() => parseHibobJobAds(answer, ORIGIN, 'Acme'), got, JSON.stringify(answer));
  }
});

test('a 401 (unknown tenant label) is reported as a missing board', async () => {
  const err = Object.assign(new Error('HTTP 401'), { status: 401 });
  const { ctx } = makeCtx(err);
  await assert.rejects(
    provider.fetch({ name: 'Acme', careers_url: ORIGIN }, ctx),
    (e) => e.status === 404 && /not a HiBob careers site/.test(e.message),
  );
  await assert.rejects(
    provider.fetch({ name: 'Acme', careers_url: 'https://acme-network.careers.hibob.com/jobs' }, ctx),
    (e) => e.status === 404 && !/network/i.test(e.message),
    'a label with the word "network" must not read as a network failure in verify-portals',
  );
});

test('any other fetch error propagates unchanged', async () => {
  for (const err of [Object.assign(new Error('HTTP 503'), { status: 503 }), new Error('probe budget')]) {
    const { ctx } = makeCtx(err);
    await assert.rejects(provider.fetch({ name: 'Acme', careers_url: ORIGIN }, ctx), (e) => e === err);
  }
});

test('ctx.maxPages: 1 still issues exactly one request', async () => {
  const { ctx, calls } = makeCtx(payload([row()]));
  await provider.fetch({ name: 'Acme', careers_url: ORIGIN }, { ...ctx, maxPages: 1 });
  assert.equal(calls.length, 1);
});
