import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkplacePolicy } from '../providers/_country.mjs';
const POLICY = {
  onsite_locations: ['Barcelona'],
  remote_countries: ['Spain', 'España', 'ES', 'ESP'],
  remote_regions: ['Europe', 'European Union', 'EU', 'EMEA', 'Worldwide', 'Anywhere', 'Global'],
};
const gate = buildWorkplacePolicy(POLICY);
for (const location of ['Barcelona, Spain', 'Barcelona (Hybrid)', 'On-site — Barcelona', 'Remote, Spain', 'Remote (ES)', 'Remote - España', 'Remote - Europe', 'Remote in Europe', 'European Union - Remote', 'Remote EMEA', 'Worldwide — Remote', 'Remote Anywhere', 'Global Remote', 'Remote — Germany or Spain']) {
  test(`admits compatible workplace: ${location}`, () => assert.equal(gate(location).eligible, true));
}
for (const location of ['Remote — Perth, Australia', 'Remote - Australia', 'Remote - US only', 'Remote - UK-only', 'Remote - Germany only', 'Remote Europe — UK only', 'Remote Europe - DE', 'Remote EU - FRA', 'Madrid, Spain (Hybrid)', 'London, UK (Hybrid)', 'Spain — Onsite', 'Remote', '', 'Remote CET working hours', 'Remote EU — excluding Spain', 'Remote Worldwide except Spain', 'Remote Europe — Spain excluded', 'Barcelona, Venezuela', 'Hybrid Madrid (remote Friday)']) {
  test(`keeps incompatible/unknown workplace out of Inbox: ${location || '(empty)'}`, () => assert.equal(gate(location).eligible, false));
}
for (const description of [
  'Remote in Europe. Applicants must be based in the UK.',
  'Remote worldwide. United States only.',
  'We have offices in Spain, but this role is UK only.',
  'Candidates must reside in Germany.',
  'This is a UK-only position; our company also has an office in Spain.',
  'You must be located in London.',
  'Hybrid role. You must be based in Madrid.',
  'Fully remote in Europe excluding Spain.',
  'Our Barcelona office serves Europe. This is a hybrid role based in Madrid.',
  'This role is restricted to UK residents.',
  'Applicants must be based in Spain, Madrid only.',
  'Spain-based candidates are not eligible.',
]) {
  test(`explicit eligibility narrows a broad region: ${description}`, () => assert.equal(gate('Remote Europe', '', { description }).eligible, false));
}
test('ordinary office mentions and timezone expectations do not invent eligibility restrictions', () => {
  assert.equal(gate('Remote Worldwide', '', { description: 'We have offices in London and Australia. CET working hours.' }).eligible, true);
  assert.equal(gate('Remote', '', { description: 'CET working hours.' }).eligible, false);
  assert.equal(gate('Remote EU timezone').eligible, false);
  assert.equal(gate('Worldwide Remote UK working hours').eligible, true);
  assert.equal(gate('Remote', '', { description: 'You can work remotely from Spain.' }).eligible, true);
  assert.equal(gate('Remote Spain / UK only').eligible, false);
  assert.equal(gate('Remote EU except ES').eligible, false);
  assert.equal(gate('Remote Europe', '', { description: 'You must be based in Spain.' }).eligible, true);
});
test('provider metadata narrows the remote region', () => {
  assert.equal(gate('Remote Europe', '', { applicantLocationRequirements: { name: 'United Kingdom' } }).eligible, false);
  assert.equal(gate('Remote Worldwide', '', { eligibleCountries: ['US', 'UK'] }).eligible, false);
  assert.equal(gate('Remote', '', { eligibleCountries: ['Spain', 'Germany'] }).eligible, true);
  assert.equal(gate('Remote Europe', '', { countriesAllowed: ['UK'] }).eligible, false);
  assert.equal(gate('Remote Europe', '', { workplaceType: 'Hybrid' }).eligible, false);
  assert.equal(gate('Barcelona', '', { workplaceType: 'Hybrid' }).eligible, true);
});
test('a remote title is conditional on eligible geography, never a blanket rescue', () => {
  assert.equal(gate('Perth, Australia', 'Sales Engineer - Remote').eligible, false);
  assert.equal(gate('Spain', 'Sales Engineer - Remote').eligible, true);
  assert.equal(gate('Madrid, Spain - Hybrid', 'Sales Engineer - Remote').eligible, false);
  assert.equal(gate('Spain', 'Remote Sensing Engineer').eligible, false);
  assert.equal(gate('Spain', 'Remote Monitoring Engineer').eligible, false);
  assert.equal(gate('Spain', 'Remote Sensing Engineer - Remote').eligible, true);
});
test('absent policy is fully inert and malformed policies fail closed', () => {
  assert.equal(buildWorkplacePolicy(undefined)('Remote Perth Australia').eligible, true);
  assert.throws(() => buildWorkplacePolicy({ remote_countries: ['Spain'] }), /requires/);
  assert.throws(() => buildWorkplacePolicy({ onsite_locations: ['Barcelona'], remote_countries: ['Neverland'] }), /country/);
  assert.throws(() => buildWorkplacePolicy(null), /must be an object/);
});
for (const [code, name] of [['IT', 'Italy'], ['NO', 'Norway'], ['BE', 'Belgium'], ['IN', 'India'], ['AT', 'Austria']]) {
  test(`trusted ${code} country configuration and structured metadata accept ISO codes`, () => {
    const policy = buildWorkplacePolicy({ onsite_locations: ['Office City'], onsite_countries: [code], remote_countries: [code], remote_regions: ['Worldwide'] });
    assert.equal(policy(`Remote ${name}`).eligible, true);
    assert.equal(policy(`Office City, ${name}`).eligible, true);
    assert.equal(policy('Remote', '', { eligibleCountries: [code] }).eligible, true);
    assert.equal(policy('Remote Worldwide', '', { description: 'Not available in Spain.' }).eligible, true);
  });
}
test('ordinary prose words that are also ISO codes do not invent country evidence', () => {
  assert.equal(gate('Remote Worldwide', '', { description: 'It is remote work. Be at your desk in time. No relocation required.' }).eligible, true);
  assert.equal(gate('Remote in Europe').eligible, true);
  assert.equal(gate('Remote', '', { description: 'Work in a remote team.' }).eligible, false);
});
