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

test('local and-around qualifiers do not become the alpha-3 country AND', () => {
  for (const target of ['and around Barcelona', 'around Barcelona']) {
    assert.equal(gate('Remote Europe', '', { description: `Candidates must be based in ${target}.` }).eligible, true, target);
  }
  assert.equal(gate('Remote Europe', '', { description: 'Candidates must be based in and around London.' }).eligible, false);
});

test('ordinary AND continuations cannot establish Andorra eligibility', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Andorra la Vella'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  for (const description of [
    'We work remotely and work in and around Barcelona.',
    'We work remotely and work in and across different teams.',
  ]) assert.equal(andorra('Remote', '', { description }).eligible, false, description);
});

test('explicit AND tokens and geographic separators still identify Andorra', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Andorra la Vella'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  for (const target of ['AND', 'AND only', 'AND or Spain', 'AND / Spain', 'AND and France']) {
    assert.equal(andorra('Remote Europe', '', { description: `Candidates must be based in ${target}.` }).eligible, true, target);
  }
  assert.equal(andorra('Remote AND').eligible, true);
  assert.equal(andorra('Remote', '', { eligibleCountries: ['AND'] }).eligible, true);
  assert.equal(andorra('Remote', '', { description: 'You can work remotely from AND.' }).eligible, true);
});

test('AND stays a foreign mandatory country even with unrelated home-country evidence', () => {
  for (const description of [
    'Candidates must be based in AND.',
    'Candidates must be based in AND only.',
    'Candidates must be based in AND and collaborate with colleagues who work remotely from Spain.',
  ]) assert.equal(gate('Remote Europe', '', { description }).eligible, false, description);
  assert.equal(gate('Remote Europe', '', { description: 'Candidates must be based in AND or Spain.' }).eligible, true);
  assert.equal(gate('Remote AND').eligible, false);
});

test('parsed home ISO alternatives do not rescue another foreign requirement', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Andorra la Vella'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  for (const description of [
    'Candidates must be based in AU and collaborate with our Andorra office.',
    'Candidates must be based in AND or Spain and must be located in AU.',
    'Candidates must be based in AND or Spain and eligible countries are France.',
  ]) assert.equal(andorra('Remote Europe', '', { description }).eligible, false, description);
  assert.equal(gate('Remote Europe', '', { description: 'Candidates must be based in Spain and collaborate with our France office.' }).eligible, true, 'an already-accepted office mention is unchanged');
});


test('explicit mandatory AND accepts a following worker qualification', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Andorra la Vella'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  for (const target of ['AND with a valid work permit', 'AND with local tax registration']) {
    const description = `Candidates must be based in ${target}.`;
    assert.equal(andorra('Remote Europe', '', { description }).eligible, true, target);
    assert.equal(gate('Remote Europe', '', { description }).eligible, false, 'an explicit foreign country remains mandatory');
  }
});

test('AND qualification cannot rescue another mandatory foreign location', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Andorra la Vella'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  assert.equal(andorra('Remote Europe', '', { description: 'Candidates must be based in AND with a valid work permit and must be located in AU.' }).eligible, false);
});

test('a general prose conjunction does not become a qualified country token', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Andorra la Vella'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  assert.equal(andorra('Remote', '', { description: 'We work remotely and work in and with customer teams.' }).eligible, false);
  assert.equal(andorra('Remote Europe', '', { description: 'Candidates must be based in and around Barcelona.' }).eligible, false);
  assert.equal(gate('Remote Europe', '', { description: 'Candidates must be based in and around Barcelona.' }).eligible, true);
});


test('independent eligible-country restrictions intersect genuine alternatives', () => {
  const cases = [
    ['AD', 'AND or France', 'France', false],
    ['AD', 'AND or France', 'AND or France', true],
    ['AD', 'AND or France', 'France or Portugal', false],
    ['FR', 'AND or France', 'France or Portugal', true],
    ['ES', 'Spain or Portugal', 'Portugal', false],
    ['PT', 'Spain or Portugal', 'Portugal', true],
    ['AD', 'AND or France', 'AND or Portugal', true],
  ];
  for (const [home, first, second, expected] of cases) {
    const policy = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: [home], remote_regions: ['Europe'] });
    const description = `Candidates must be based in ${first} and eligible countries are ${second}`;
    assert.equal(policy('Remote Europe', '', { description }).eligible, expected, `${home}: ${description}`);
  }
});

test('independent eligible locations do not borrow an earlier home alternative', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Andorra la Vella'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  assert.equal(andorra('Remote Europe', '', { description: 'Candidates must be based in AND or France and eligible locations are France.' }).eligible, false);
  assert.equal(andorra('Remote Europe', '', { description: 'Candidates must be based in AND or France and eligible locations are AND or France.' }).eligible, true);
  assert.equal(andorra('Remote Europe', '', { description: 'Candidates must be based in AND or France and must be located in AU.' }).eligible, false);
});

test('unrelated eligible-country prose is not a new geographic target', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Andorra la Vella'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  for (const suffix of ['eligible countries are considered during onboarding', 'eligible countries are reviewed annually', 'collaborate with France colleagues']) {
    const description = `Candidates must be based in AND or France and ${suffix}.`;
    assert.equal(andorra('Remote Europe', '', { description }).eligible, true, description);
  }
});


test('explicit eligibility qualifiers cannot hide a narrower country list', () => {
  const qualifiers = ['restricted to ', 'limited to ', 'only ', 'currently limited to ', 'open only to ', 'allowed in ', 'allowed only in ', 'permitted from ', 'available in ', 'currently only restricted to ', 'only currently limited to '];
  for (const qualifier of qualifiers) {
    for (const [home, countries, expected] of [['AD', 'France', false], ['AD', 'AND or France', true], ['AD', 'France or Portugal', false], ['FR', 'France or Portugal', true]]) {
      const policy = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: [home], remote_regions: ['Europe'] });
      const description = `Candidates must be based in AND or France and eligible countries are ${qualifier}${countries}`;
      assert.equal(policy('Remote Europe', '', { description }).eligible, expected, `${home}: ${description}`);
    }
  }
});

test('qualified eligible locations retain genuine alternatives and independent restrictions', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  assert.equal(andorra('Remote Europe', '', { description: 'Candidates must be based in AND or France and eligible locations are restricted to France.' }).eligible, false);
  assert.equal(andorra('Remote Europe', '', { description: 'Candidates must be based in AND or France and eligible locations are only AND or France.' }).eligible, true);
  assert.equal(andorra('Remote Europe', '', { description: 'Candidates must be based in AND or France and eligible locations are allowed in AND or France and must be located in AU.' }).eligible, false);
});

test('eligibility qualifier grammar does not scan through nongeographic prose', () => {
  const andorra = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: ['AD'], remote_regions: ['Europe'] });
  for (const tail of ['considered during onboarding', 'reviewed annually', 'only considered during onboarding', 'currently reviewed annually', 'allowed by company policy']) {
    const description = `Candidates must be based in AND or France and eligible countries are ${tail}.`;
    assert.equal(andorra('Remote Europe', '', { description }).eligible, true, description);
  }
});


test('explicit eligibility lists retain every comma-separated country alternative', () => {
  const cases = [
    ['DE', 'Eligible countries are restricted to France, Germany.'],
    ['PT', 'Eligible countries are restricted to France, Portugal.'],
    ['PT', 'Eligible countries are France, Germany, Portugal.'],
    ['PT', 'Eligible countries are France, Germany, and Portugal.'],
    ['PT', 'Eligible locations are France, Germany, or Portugal.'],
    ['AD', 'Eligible countries are France, AND or Germany.'],
    ['AD', 'Eligible countries are France, Germany, AND.'],
    ['DE', 'Eligible locations are France, Germany.'],
    ['FR', 'Eligible countries are restricted to France, Germany.'],
    ['PT', 'Eligible countries are FR, PT.'],
    ['GB', 'Eligible countries are France, United Kingdom.'],
    ['PT', 'Eligible countries are France, Germany or Portugal.'],
    ['DE', 'Candidates must be based in France or Germany and eligible countries are restricted to France, Germany.'],
    ['DE', 'Eligible countries are France, Germany and eligible countries are Germany or Portugal.'],
  ];
  for (const [home, description] of cases) {
    const policy = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: [home], remote_regions: ['Europe'] });
    assert.equal(policy('Remote Europe', '', { description }).eligible, true, `${home}: ${description}`);
  }
});

test('a country-list comma never absorbs a separate or narrower restriction', () => {
  const cases = [
    ['PT', 'Eligible countries are restricted to France, Germany.'],
    ['DE', 'Eligible countries are France, Germany; candidates must be based in France.'],
    ['DE', 'Candidates must be based in France; eligible countries are France, Germany.'],
    ['DE', 'Eligible countries are France, Germany. Candidates must be based in France.'],
    ['DE', 'Eligible countries are France, Germany, candidates must be based in France.'],
    ['DE', 'Eligible countries are France, Germany, eligible countries are France.'],
    ['DE', 'Eligible countries are France, Germany and eligible countries are France or Portugal.'],
    ['DE', 'Eligible countries are France, Germany but candidates must be based in France.'],
    ['DE', 'Eligible countries are France, Germany however candidates must be based in France.'],
    ['DE', 'Eligible countries are France; Germany.'],
    ['DE', 'Eligible countries are France, Germany and must be located in AU.'],
  ];
  for (const [home, description] of cases) {
    const policy = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: [home], remote_regions: ['Europe'] });
    assert.equal(policy('Remote Europe', '', { description }).eligible, false, `${home}: ${description}`);
  }
});

test('only complete country-list pieces can continue eligibility across a comma', () => {
  const cases = [
    ['DE', 'Eligible countries are France, Germany office supports Europe.', false],
    ['PT', 'Eligible countries are France, Portugalish.', false],
    ['PT', 'Eligible countries are France, PRTland.', false],
    ['PT', 'Eligible countries are France, PT systems.', false],
    ['PT', 'Eligible countries are France, and considered during onboarding.', false],
    ['PT', 'Eligible countries are France, and PT systems.', false],
    ['DE', 'Candidates must be based in Germany. Eligible countries are considered during onboarding, France office supports Europe.', true],
    ['DE', 'Candidates must be based in Germany. Eligible countries are reviewed annually, France office supports Europe.', true],
    ['FR', 'Eligible countries are France, Germany and eligible countries are France or Portugal.', true],
  ];
  for (const [home, description, expected] of cases) {
    const policy = buildWorkplacePolicy({ onsite_locations: ['Office City'], remote_countries: [home], remote_regions: ['Europe'] });
    assert.equal(policy('Remote Europe', '', { description }).eligible, expected, `${home}: ${description}`);
  }
});
