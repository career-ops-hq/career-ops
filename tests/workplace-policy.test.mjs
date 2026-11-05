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

test('policy list types are validated before scanner admission', () => {
  for (const key of ['onsite_locations', 'onsite_countries', 'remote_countries', 'remote_regions']) {
    for (const value of ['Spain', false, 42, {}]) {
      assert.throws(() => buildWorkplacePolicy({ ...POLICY, [key]: value }), new RegExp(`workplace_policy\\.${key} must be a list`));
    }
  }
});

test('absent, null and empty onsite countries use the remote-country default', () => {
  for (const onsite_countries of [undefined, null, []]) {
    const policy = buildWorkplacePolicy({ ...POLICY, onsite_countries, remote_regions: null });
    assert.equal(policy('Barcelona, Spain').eligible, true);
    assert.equal(policy('Barcelona, Venezuela').eligible, false);
  }
  assert.throws(() => buildWorkplacePolicy({ ...POLICY, onsite_countries: ['Neverland'] }), /onsite_countries must name a country/);
});

for (const code of ['PT', 'ES', 'US']) {
  test(`explicit ${code} geography in prose remains eligible without reading arbitrary prose as ISO`, () => {
    const policy = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: [code], remote_regions: [] });
    assert.equal(policy(`Remote, ${code}`, 'Engineer', { description: `Candidates must be based in ${code}.` }).eligible, true);
    assert.equal(policy('Remote', 'Engineer', { eligibleCountries: [code], description: `Candidates must be located in ${code}.` }).eligible, true);
    assert.equal(policy('Remote', 'Engineer', { description: `Work remotely from ${code}.` }).eligible, true);
    assert.equal(policy(`Remote, ${code}`, 'Engineer', { description: `Candidates must be based in ${code}, ${code} only.` }).eligible, true);
    assert.equal(policy(`Remote, ${code}`, 'Engineer', { description: 'Candidates must be based in AU.' }).eligible, false);
  });
}

for (const [code, name, ordinary, mandatory] of [
  ['US', 'United States', 'Join us and work remotely.', 'Applicants must live near us.'],
  ['BY', 'Belarus', 'By design we work remotely.', 'Applicants must reside by our office.'],
  ['ID', 'Indonesia', 'An ID is required to work remotely.', 'Applicants must live at the location on their ID.'],
]) {
  test(`description prose does not turn an ordinary ${code.toLowerCase()} token into a country`, () => {
    const policy = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: [code], remote_regions: ['Worldwide'] });
    assert.equal(policy('Remote', '', { description: ordinary }).eligible, false);
    assert.equal(policy('Remote Worldwide', '', { description: mandatory }).eligible, false);
    assert.equal(policy('Remote', '', { description: `You can work remotely from ${name}.` }).eligible, true);
    assert.equal(policy(`Remote, ${code}`).eligible, true);
    assert.equal(policy('Remote', '', { eligibleCountries: [code] }).eligible, true);
  });
}

test('timezone abbreviations in locations do not become country evidence', () => {
  for (const zone of ['ET', 'PT', 'MT', 'CT', 'EST', 'PST', 'CST', 'MST', 'EDT', 'PDT']) {
    for (const suffix of [`(${zone} overlap)`, `(overlap until 5pm ${zone})`, `(${zone} hours)`]) {
      assert.equal(gate(`Remote - Europe ${suffix}`).eligible, true, suffix);
    }
  }
  const portugal = buildWorkplacePolicy({ onsite_locations: ['Lisbon'], remote_countries: ['Portugal'], remote_regions: ['Europe'] });
  assert.equal(portugal('Remote - US (PT hours)').eligible, false);
  assert.equal(portugal('Remote - PT').eligible, true, 'a country token without a timezone context stays geographic');
  assert.equal(portugal('Remote (PT hours)').eligible, false);
  assert.equal(portugal('Remote (PT hours)', '', { eligibleCountries: ['PT'] }).eligible, true);
});

test('timezone wording in prose cannot supply the missing remote country', () => {
  const us = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: ['US'] });
  for (const description of ['Work remotely and work in US time zones.', 'Work remotely from US working hours.']) {
    assert.equal(us('Remote', '', { description }).eligible, false, description);
  }
  assert.equal(us('Remote', '', { description: 'You can work remotely from US.' }).eligible, true);
});

for (const [code, name] of [['IN', 'India'], ['IT', 'Italy'], ['BE', 'Belgium']]) {
  test(`explicit mandatory ${code} is disambiguated by worker geography`, () => {
    const policy = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: [code] });
    assert.equal(policy(`Remote ${name}`, '', { description: `Candidates must be based in ${code}.` }).eligible, true);
    assert.equal(policy('Remote', '', { eligibleCountries: [code], description: `Candidates must be based in ${code}, ${code} only.` }).eligible, true);
    assert.equal(policy('Remote', '', { description: 'We work in IT systems and build software.' }).eligible, false);
    assert.equal(policy('Remote', '', { description: 'We work remotely and work in IT and build applications.' }).eligible, false);
  });
}

test('mandatory worker geography is not rescued by an unrelated home-country mention', () => {
  const us = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: ['US'], remote_regions: ['Worldwide'] });
  for (const description of [
    'Candidates must be based in AU and collaborate with colleagues who work remotely from US.',
    'Candidates must be based in Australia and work with our United States office.',
    'Candidates must be located in London, where we also serve United States customers.',
  ]) assert.equal(us('Remote Worldwide', '', { description }).eligible, false, description);
  assert.equal(us('Remote Worldwide', '', { description: 'Candidates must be based in Australia or United States.' }).eligible, true);
  assert.equal(gate('Remote Europe', '', { description: 'Candidates must be based in Europe.' }).eligible, true);
  for (const target of ['any Europe country', 'any EMEA country', 'a country in Europe', 'an eligible country within Europe']) {
    assert.equal(gate('Remote Europe', '', { description: `Candidates must be based in ${target}.` }).eligible, true, target);
  }
  assert.equal(gate('Remote Europe', '', { description: 'Candidates must be based in any country in Australia.' }).eligible, false);
});

test('conditional hiring-presence regions need independent home-country eligibility', () => {
  const description = 'This position can be remote in any EMEA country where we have a hiring presence.';
  assert.equal(gate('Remote EMEA', '', { description }).eligible, false);
  assert.equal(gate('Remote EMEA', '', { description: description + ' We have an office in Spain.' }).eligible, false);
  assert.equal(gate('Remote EMEA', '', { description, eligibleCountries: ['ES'] }).eligible, true);
  assert.equal(gate('Remote Spain', '', { description }).eligible, true);
  assert.equal(gate('Remote EMEA', '', { description: description + ' You can work remotely from Spain.' }).eligible, true);
  assert.equal(buildWorkplacePolicy(undefined)('Remote EMEA', '', { description }).eligible, true);
});
