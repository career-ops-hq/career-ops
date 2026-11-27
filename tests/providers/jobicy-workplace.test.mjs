import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJobicyResponse } from '../../providers/jobicy.mjs';
import { buildLocationFilter } from '../../scan.mjs';
import { captureWorkplaceEvidence, buildWorkplacePolicy } from '../../providers/_country.mjs';
const workplace_policy = { onsite_locations: ['Barcelona'], remote_countries: ['Spain'], remote_regions: ['Europe', 'EU', 'EMEA', 'Worldwide', 'Anywhere'] };
const filter = buildLocationFilter({ allow: ['Barcelona', 'Spain', 'Europe', 'EU', 'EMEA', 'Worldwide', 'Anywhere', 'Remote'], workplace_policy });
const parse = (geo, description) => parseJobicyResponse({ jobs: [{ jobTitle: 'Sales Engineer', companyName: 'Fixture', jobGeo: geo, jobDescription: description, url: 'https://jobicy.com/jobs/fixture' }] })[0];
for (const geo of ['Spain', 'Worldwide', 'Europe', 'EMEA', 'Anywhere']) {
  test(`remote-only Jobicy feed preserves compatible ${geo} even without Remote in its geo label`, () => {
    const job = parse(geo, '<p>Technical sales role.</p>');
    assert.equal(job.isRemote, true);
    assert.equal(job.location, geo, 'original eligibility label is preserved');
    assert.equal(filter(job.location, job.url, job.title, job), true);
    assert.equal(buildWorkplacePolicy(workplace_policy)(job.location, job.title, { geographyEvidence: captureWorkplaceEvidence(job) }).eligible, true);
  });
}
for (const geo of ['Perth, Australia', 'UK', 'United States', 'Germany']) {
  test(`remote-only does not mean worldwide: rejects ${geo}`, () => {
    const job = parse(geo, '<p>Technical sales role.</p>');
    assert.equal(filter(job.location, job.url, job.title, job), false);
  });
}
test('full Jobicy HTML description narrows a broad region and survives evidence capture', () => {
  const description = '<p>Applicants <strong>must be based in the UK</strong>.</p>';
  const job = parse('Europe', description);
  assert.equal(job.description, description);
  assert.equal(filter(job.location, job.url, job.title, job), false);
  const evidence = captureWorkplaceEvidence(job);
  assert.equal(evidence.description, description);
  assert.equal(buildWorkplacePolicy(workplace_policy)(job.location, job.title, { geographyEvidence: evidence }).eligible, false);
});
test('malformed description is not coerced into invented eligibility', () => {
  const job = parse('Worldwide', { text: 'must be based in Spain' });
  assert.equal(Object.hasOwn(job, 'description'), false);
  assert.equal(job.isRemote, true);
});
