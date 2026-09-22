import test from 'node:test';
import assert from 'node:assert/strict';
import icims from '../../providers/icims.mjs';
import { buildLocationFilter } from '../../scan.mjs';

async function enrich(country, location = '', locality = '') {
  const job = { url: 'https://careers-example.icims.com/jobs/123/engineer/job', location };
  const node = { '@type': 'JobPosting', datePosted: '2026-09-01', jobLocation: { address: { addressCountry: country, addressLocality: locality } } };
  await icims.enrichDate(job, { fetchText: async () => `<script type="application/ld+json">${JSON.stringify(node)}</script>` });
  assert.equal(job.postedAt, Date.parse('2026-09-01'));
  return job;
}

for (const [code, name] of [['OM', 'Oman'], ['PL', 'Poland'], ['de', 'Germany'], ['US', 'United States'], ['CA', 'Canada']]) {
  test(`${code} becomes a country name usable by location filters`, async () => {
    const job = await enrich(code);
    assert.equal(job.location, name);
    assert.equal(buildLocationFilter({ allow: [name] })(job.location), true);
    assert.equal(buildLocationFilter({ block: [name] })(job.location), false);
  });
}

for (const country of ['United Kingdom', 'QZ', 'ZZ', 'qz', 'USA', '12', 'A-B']) {
  test(`unknown or spelled-out country is preserved: ${country}`, async () => {
    assert.equal((await enrich(country)).location, country);
  });
}

test('country expansion preserves locality and populated list locations', async () => {
  assert.equal((await enrich('PL', '', 'Kraków')).location, 'Kraków, Poland');
  assert.equal((await enrich('PL', 'Remote, Europe')).location, 'Remote, Europe');
});

test('missing and unavailable country do not invent a location', async () => {
  for (const country of [null, '', 'UNAVAILABLE']) {
    assert.equal((await enrich(country)).location, '');
  }
});
