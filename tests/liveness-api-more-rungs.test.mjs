import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtsApi, checkLivenessViaApi } from '../liveness-api.mjs';

const greenhouse = 'https://careers.example.com/detail/7823005003/?gh_jid=7823005003';
const smartrecruiters = 'https://jobs.smartrecruiters.com/ServiceNow/744000131661949-senior-director';
const arbeitsagentur = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1003597288-S';
const wwr = 'https://weworkremotely.com/remote-jobs/acme-staff-engineer';

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test('four new URL shapes route only to fixed API hosts', () => {
  assert.match(resolveAtsApi(greenhouse).apiUrl, /^https:\/\/boards\.greenhouse\.io\/embed\//);
  assert.equal(resolveAtsApi(smartrecruiters).apiUrl,
    'https://api.smartrecruiters.com/v1/companies/ServiceNow/postings/744000131661949');
  assert.match(resolveAtsApi(arbeitsagentur).apiUrl, /^https:\/\/rest\.arbeitsagentur\.de\//);
  assert.equal(resolveAtsApi(wwr).apiUrl, 'https://weworkremotely.com/remote-jobs.rss');
  assert.equal(resolveAtsApi('https://jobs.smartrecruiters.com.evil.test/ServiceNow/123-title'), null);
  assert.equal(resolveAtsApi('https://weworkremotely.com/remote-jobs/%2e%2e'), null);
});

test('Greenhouse company URL checks the per-job API after a validated embed redirect', async () => {
  const calls = [];
  const verdict = await withFetch(async (url, opts) => {
    calls.push([String(url), opts.redirect]);
    if (calls.length === 1) return new Response(null, { status: 301, headers: {
      location: 'https://job-boards.greenhouse.io/embed/job_app?for=celonis&token=7823005003',
    } });
    return new Response('{}', { status: 404 });
  }, () => checkLivenessViaApi(greenhouse));
  assert.equal(verdict.result, 'expired');
  assert.deepEqual(calls, [
    ['https://boards.greenhouse.io/embed/job_app?token=7823005003', 'manual'],
    ['https://boards-api.greenhouse.io/v1/boards/celonis/jobs/7823005003', 'error'],
  ]);
  const unsafe = await withFetch(async () => new Response(null, { status: 301, headers: {
    location: 'https://evil.example/embed/job_app?for=celonis&token=7823005003',
  } }), () => checkLivenessViaApi(greenhouse));
  assert.equal(unsafe, null);
});

test('SmartRecruiters uses active flag, never status 200 alone', async () => {
  const closed = await withFetch(async () => new Response(JSON.stringify({ id: '744000131661949', active: false })),
    () => checkLivenessViaApi(smartrecruiters));
  assert.equal(closed.result, 'expired');
  const live = await withFetch(async () => new Response(JSON.stringify({ id: '744000131661949', active: true })),
    () => checkLivenessViaApi(smartrecruiters));
  assert.equal(live.result, 'active');
  const mismatch = await withFetch(async () => new Response(JSON.stringify({ id: 'other', active: true })),
    () => checkLivenessViaApi(smartrecruiters));
  assert.equal(mismatch, null);
});

test('Arbeitsagentur confirms matching live detail but leaves 404 uncertain', async () => {
  let sentHeaders;
  const live = await withFetch(async (_url, opts) => {
    sentHeaders = opts.headers;
    return new Response(JSON.stringify({ referenznummer: '10001-1003597288-S', stellenangebotsTitel: 'Engineer' }));
  }, () => checkLivenessViaApi(arbeitsagentur));
  assert.equal(live.result, 'active');
  assert.equal(sentHeaders['X-API-Key'], 'jobboerse-jobsuche');
  const missing = await withFetch(async () => new Response('', { status: 404 }),
    () => checkLivenessViaApi(arbeitsagentur));
  assert.equal(missing, null);
});

test('We Work Remotely feed presence proves live, absence remains unknown', async () => {
  const rss = '<rss><channel><item><title>Acme: Engineer</title><link>https://weworkremotely.com/remote-jobs/acme-staff-engineer</link></item></channel></rss>';
  const live = await withFetch(async () => new Response(rss), () => checkLivenessViaApi(wwr));
  assert.equal(live.result, 'active');
  const absent = await withFetch(async () => new Response(rss),
    () => checkLivenessViaApi('https://weworkremotely.com/remote-jobs/another-job'));
  assert.equal(absent, null);
});
