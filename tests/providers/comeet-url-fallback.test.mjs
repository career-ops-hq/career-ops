import assert from 'node:assert/strict';
import { pass, fail, results } from '../helpers.mjs';
import comeet, { parseComeetResponse } from '../../providers/comeet.mjs';

const hosted = 'https://www.comeet.com/jobs/fixture/engineer/AB.123';

async function check(name, run) {
  try {
    await run();
    pass(name);
  } catch (error) {
    fail(`${name}: ${error.message}`);
  }
}

for (const active of ['http://careers.example/jobs/1', '/jobs/1', 'not a URL', '   ', 42]) {
  await check(`Comeet keeps the hosted posting when its active URL is unusable: ${JSON.stringify(active)}`, () => {
    const jobs = parseComeetResponse([{
      name: 'Engineer', url_active_page: active, url_comeet_hosted_page: hosted,
    }], 'Fixture');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].url, hosted);
  });
}

await check('Comeet retains the preferred HTTPS employer URL on a custom domain', () => {
  const active = 'https://careers.example/jobs/1';
  const jobs = parseComeetResponse([{
    name: 'Engineer', url_active_page: active, url_comeet_hosted_page: hosted,
  }], 'Fixture');
  assert.equal(jobs[0].url, active);
});

await check('Comeet omits postings when neither URL satisfies the HTTPS contract', () => {
  assert.deepEqual(parseComeetResponse([{
    name: 'Engineer', url_active_page: 'http://careers.example/jobs/1',
    url_comeet_hosted_page: 'javascript:alert(1)',
  }], 'Fixture'), []);
});

await check('Comeet fetch recovers the hosted posting without fetching either display URL', async () => {
  const api = 'https://www.comeet.co/careers-api/2.0/company/fixture/positions?token=FIXTURE';
  const calls = [];
  const jobs = await comeet.fetch({ name: 'Fixture', api }, {
    fetchJson: async (url, options) => {
      calls.push({ url, options });
      return [{ name: 'Engineer', url_active_page: 'invalid', url_comeet_hosted_page: hosted }];
    },
  });
  assert.equal(jobs[0]?.url, hosted);
  assert.deepEqual(calls, [{ url: api, options: { redirect: 'error' } }]);
});

if (results().failed) process.exitCode = 1;
