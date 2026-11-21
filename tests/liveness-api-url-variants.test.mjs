import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLivenessViaApi, resolveAtsApi } from '../liveness-api.mjs';

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = previous;
  }
}

test('Greenhouse embed/job_app with for and token resolves directly across all board hosts', () => {
  for (const url of [
    'https://boards.greenhouse.io/embed/job_app?for=celonis&token=7823005003',
    'https://boards.eu.greenhouse.io/embed/job_app?for=celonis&token=7823005003',
    'https://job-boards.greenhouse.io/embed/job_app?for=celonis&token=7823005003',
    'https://job-boards.eu.greenhouse.io/embed/job_app/?for=celonis&token=7823005003',
  ]) {
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, 'greenhouse', url);
    assert.equal(resolved?.apiUrl, 'https://boards-api.greenhouse.io/v1/boards/celonis/jobs/7823005003', url);
  }
});

test('Greenhouse embed/job_app without for follows the embed redirect', async () => {
  const url = 'https://job-boards.greenhouse.io/embed/job_app?token=7823005003&utm_source=li';
  const resolved = resolveAtsApi(url);
  assert.equal(resolved?.ats, 'greenhouse-embedded');
  assert.equal(resolved?.apiUrl, 'https://boards.greenhouse.io/embed/job_app?token=7823005003');

  const calls = [];
  const verdict = await withFetch(async (target, opts) => {
    calls.push([String(target), opts.redirect]);
    if (calls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://job-boards.greenhouse.io/embed/job_app?for=celonis&token=7823005003' },
      });
    }
    return new Response(JSON.stringify({ id: 7823005003 }), { status: 200 });
  }, () => checkLivenessViaApi(url));

  assert.equal(verdict?.result, 'active');
  assert.deepEqual(calls, [
    ['https://boards.greenhouse.io/embed/job_app?token=7823005003', 'manual'],
    ['https://boards-api.greenhouse.io/v1/boards/celonis/jobs/7823005003', 'error'],
  ]);
});

test('Greenhouse rejects unsafe embed params, non-board hosts, and plain http', () => {
  for (const url of [
    'https://boards.greenhouse.io/embed/job_app?for=acme%2Fprivate&token=7823005003',
    'https://boards.greenhouse.io/embed/job_app?for=..&token=7823005003',
    'https://boards.greenhouse.io/embed/job_app?for=&token=7823005003',
    'https://boards.greenhouse.io/embed/job_app?for=celonis&token=abc',
    'https://boards.greenhouse.io/embed/job_board?for=celonis',
    'https://boards.greenhouse.io/embed/jobs/7823005003',
    'https://boards-api.greenhouse.io/embed/job_app?for=celonis&token=7823005003',
    'https://evil.example/embed/job_app?for=celonis&token=7823005003',
    'http://boards.greenhouse.io/embed/job_app?for=celonis&token=7823005003',
    'http://boards.greenhouse.io/embed/job_app?token=7823005003',
  ]) {
    assert.equal(resolveAtsApi(url), null, url);
  }
});

test('Lever /apply variants resolve on US and EU hosts and reject invalid paths', () => {
  const id = '5ac21346-8e0c-4494-8e7a-3eb92ff77902';
  for (const [url, expected] of [
    [`https://jobs.lever.co/acme/${id}/apply`, `https://api.lever.co/v0/postings/acme/${id}`],
    [`https://jobs.lever.co/acme/${id}/apply/`, `https://api.lever.co/v0/postings/acme/${id}`],
    [`https://jobs.eu.lever.co/acme-eu/${id}/apply`, `https://api.eu.lever.co/v0/postings/acme-eu/${id}`],
  ]) {
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, 'lever', url);
    assert.equal(resolved?.apiUrl, expected, url);
  }

  for (const url of [
    'https://jobs.lever.co/acme/apply',
    'https://jobs.lever.co/acme/apply/apply',
    `https://jobs.lever.co/acme/${id}/other`,
    `http://jobs.lever.co/acme/${id}/apply`,
  ]) {
    assert.equal(resolveAtsApi(url), null, url);
  }
});

test('Workable /apply and /jobs/view/ variants resolve to the v2 API or guarded share hop', async () => {
  const api = 'https://apply.workable.com/api/v2/accounts/acme-corp/jobs/ABC12345';
  for (const url of [
    'https://apply.workable.com/acme-corp/j/ABC12345/apply',
    'https://apply.workable.com/acme-corp/j/ABC12345/apply/',
    'https://apply.workable.com/acme-corp/jobs/view/ABC12345',
    'https://apply.workable.com/acme-corp/jobs/view/ABC12345/',
  ]) {
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, 'workable', url);
    assert.equal(resolved?.apiUrl, api, url);
  }

  for (const url of [
    'https://apply.workable.com/j/ABC12345/apply',
    'https://apply.workable.com/j/ABC12345/apply/',
  ]) {
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, 'workable-short', url);
    assert.equal(resolved?.apiUrl, 'https://apply.workable.com/j/ABC12345', url);
  }

  const calls = [];
  const verdict = await withFetch(async (target, opts) => {
    calls.push([String(target), opts.redirect]);
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: '/acme-corp/j/ABC12345' } });
    }
    return new Response(JSON.stringify({ state: 'published' }), { status: 200 });
  }, () => checkLivenessViaApi('https://apply.workable.com/j/ABC12345/apply'));

  assert.equal(verdict?.result, 'active');
  assert.deepEqual(calls, [
    ['https://apply.workable.com/j/ABC12345', 'manual'],
    [api, 'error'],
  ]);

  for (const url of [
    'https://apply.workable.com/j/apply',
    'https://apply.workable.com/acme-corp/j/apply',
    'https://apply.workable.com/j/j/ABC12345',
    'https://apply.workable.com/api/j/ABC12345',
    'https://apply.workable.com/acme-corp/jobs/view/ABC12345/apply',
    'https://apply.workable.com/acme-corp/j/ABC12345/other',
    'http://apply.workable.com/acme-corp/j/ABC12345/apply',
  ]) {
    assert.equal(resolveAtsApi(url), null, url);
  }
});

test('SmartRecruiters keeps UUID posting IDs whole instead of truncating at the first hyphen', async () => {
  const uuid = '12345678-1234-4abc-8def-1234567890ab';
  const expectedApi = `https://api.smartrecruiters.com/v1/companies/ACME/postings/${uuid}`;

  for (const url of [
    `https://jobs.smartrecruiters.com/ACME/${uuid}`,
    `https://jobs.smartrecruiters.com/ACME/${uuid}/`,
    `https://jobs.smartrecruiters.com/ACME/${uuid}-security-analyst`,
    `https://jobs.smartrecruiters.com/ACME/${uuid.toUpperCase()}-security-analyst/`,
  ]) {
    const resolved = resolveAtsApi(url);
    assert.equal(resolved?.ats, 'smartrecruiters', url);
    assert.equal(resolved?.apiUrl, expectedApi, url);
  }

  const live = await withFetch(
    async () => new Response(JSON.stringify({ id: uuid.toUpperCase(), active: true })),
    () => checkLivenessViaApi(`https://jobs.smartrecruiters.com/ACME/${uuid}-security-analyst`),
  );
  assert.equal(live?.result, 'active');

  const closed = await withFetch(
    async () => new Response(JSON.stringify({ id: uuid, active: false })),
    () => checkLivenessViaApi(`https://jobs.smartrecruiters.com/ACME/${uuid.toUpperCase()}`),
  );
  assert.equal(closed?.result, 'expired');

  const missingId = await withFetch(
    async () => new Response(JSON.stringify({ active: true })),
    () => checkLivenessViaApi(`https://jobs.smartrecruiters.com/ACME/${uuid}`),
  );
  assert.equal(missingId, null);
});
