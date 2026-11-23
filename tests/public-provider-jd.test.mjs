import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchJdViaKnownApi } from '../browser-extract.mjs';
import { resolveAtsApi } from '../liveness-api.mjs';

const bamboo = 'https://acme.bamboohr.com/careers/38?source=job-board';
const bambooApi = 'https://acme.bamboohr.com/careers/38/detail';
const himalayas = JSON.parse(readFileSync(new URL('./fixtures/himalayas-job.json', import.meta.url), 'utf8'));
const jobicy = 'https://jobicy.com/jobs/123-platform-engineer';

test('BambooHR JD reads only the requested open job from its tenant detail API', async (t) => {
  const opening = { jobOpeningShareUrl: bamboo, jobOpeningStatus: 'Open', jobOpeningName: 'Platform Engineer',
    description: '<p>Build &amp; operate services.</p><ul><li>Node.js</li></ul>' };
  const mock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    assert.equal(String(url), bambooApi);
    assert.equal(opts.redirect, 'error');
    return Response.json({ result: { jobOpening: opening } });
  });
  assert.equal(resolveAtsApi(bamboo), null);
  assert.deepEqual(await fetchJdViaKnownApi(bamboo), {
    url: bamboo, title: 'Platform Engineer', text: 'Build & operate services.\n\n- Node.js', ats: 'bamboohr',
  });
  opening.jobOpeningStatus = 'Closed';
  assert.equal(await fetchJdViaKnownApi(bamboo), null);
  opening.jobOpeningStatus = 'Open';
  opening.jobOpeningShareUrl = 'https://acme.bamboohr.com/careers/39';
  assert.equal(await fetchJdViaKnownApi(bamboo), null);
  assert.equal(await fetchJdViaKnownApi('https://acme.bamboohr.com.example.org/careers/38'), null);
  assert.equal(mock.mock.callCount(), 3);
});

test('Himalayas JD reuses publisher identity checks and caps the returned description', async (t) => {
  const { job } = himalayas;
  job.expiryDate = Math.floor(Date.now() / 1000) + 3600;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    assert.equal(String(url), 'https://himalayas.app/jobs/api/companies/fixture-labs/jobs/product-manager');
    assert.equal(opts.redirect, 'error');
    return Response.json(himalayas);
  });
  const result = await fetchJdViaKnownApi(job.applicationLink, 100, 1000);
  assert.equal(result.ats, 'himalayas');
  assert.equal(result.url, job.applicationLink);
  assert.equal(result.title, job.title);
  assert.equal(result.text.length, 101);
  assert.match(result.text, /…$/);
  job.guid += '-another';
  assert.equal(await fetchJdViaKnownApi(job.applicationLink), null);
});

test('interactive Jobicy extraction reads posting JSON-LD without launching a browser', () => {
  const posting = {
    '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Platform Engineer', url: jobicy,
    description: '<p>' + 'Build and operate reliable production services with the platform engineering team. '.repeat(15) + '</p>',
  };
  const html = '<script type="application/ld+json">' + JSON.stringify(posting) + '</script>';
  const script = [
    "const { setHostResolver } = await import('./liveness-browser.mjs');",
    "setHostResolver(async () => ['93.184.216.34']);",
    'globalThis.fetch = async (url) => {',
    '  if (String(url) !== ' + JSON.stringify(jobicy) + ') throw Error("Unexpected URL");',
    '  return new Response(' + JSON.stringify(html) + ', { headers: { "content-type": "text/html" } });',
    '};',
    'process.argv = [process.execPath, "browser-extract.mjs", ' + JSON.stringify(jobicy) + '];',
    "await import('./browser-extract.mjs');",
  ].join('\n');
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_NO_DNS_CACHE: '', NODE_USE_ENV_PROXY: '' },
    timeout: 5000,
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.title, posting.title);
  assert.match(result.text, /Build and operate reliable production services/);
});
