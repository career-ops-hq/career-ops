// #6413: known worldwide eligibility is not missing location data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';
import { parseHimalayasResponse } from '../providers/himalayas.mjs';

const worldwideLabels = [
  'Worldwide',
  'Anywhere in the World',
  'Remote (worldwide)',
  'Worldwide (Himalayas: no country restriction)',
];
const countryFilter = {
  always_allow: ['United States', 'USA'],
  allow: ['United States', 'USA'],
  remote_title_fallback: false,
};

for (const label of worldwideLabels) {
  test(`${label}: country-only lists accept the exact label case-insensitively`, () => {
    for (const strict of [undefined, false]) {
      const accepts = buildLocationFilter({ ...countryFilter, strict });
      assert.equal(accepts(label, '', 'Software Engineer'), true);
      assert.equal(accepts(` ${label.toUpperCase()} `, '', 'Software Engineer'), true);
    }
  });

  test(`${label}: explicit block and block_hard still win`, () => {
    for (const tier of ['block', 'block_hard']) {
      const accepts = buildLocationFilter({ ...countryFilter, [tier]: [label] });
      assert.equal(accepts(label, '', 'Software Engineer - Remote'), false);
    }
  });
}

test('worldwide admission recognizes shared country names, aliases and ISO codes', () => {
  for (const country of ['Bangladesh', 'Canada', 'United Kingdom', 'U.K.', 'United States of America', 'DE', 'DEU', 'IN']) {
    const accepts = buildLocationFilter({ allow: [country] });
    assert.equal(accepts('Worldwide', '', 'Software Engineer'), true, country);
  }
  assert.equal(buildLocationFilter({ allow: 'Canada' })('Worldwide'), true, 'bare-string lists retain normalization');
});

test('worldwide labels do not broaden city-only or mixed city/country allow-lists', () => {
  for (const config of [
    { allow: ['New York'] },
    { allow: ['United States', 'New York'] },
    { always_allow: ['United States'], allow: ['United States', 'New York'] },
    { always_allow: ['New York'], allow: ['United States'] },
  ]) {
    const accepts = buildLocationFilter(config);
    for (const label of worldwideLabels) {
      assert.equal(accepts(label, '', 'Software Engineer'), false, JSON.stringify({ config, label }));
    }
  }
  for (const allow of [['Europe'], ['EU'], ['United States or Canada']]) {
    assert.equal(buildLocationFilter({ allow })('Worldwide'), false, JSON.stringify(allow));
  }
});

test('unrecognized or qualified labels do not acquire worldwide eligibility', () => {
  const accepts = buildLocationFilter(countryFilter);
  for (const location of [
    'Remote', 'Unknown', 'Anywhere', 'Global', 'Canada',
    'Not worldwide', 'Worldwide except Canada', 'Worldwide (US only)',
    'Worldwide, Europe', 'Remote (worldwide) - US only',
    'Anywhere  in the World', 'Worldwide (Himalayas: no country restriction) - extra',
  ]) {
    assert.equal(accepts(location, '', 'Software Engineer'), false, location);
  }
});

test('unknown locations and strict-mode admission keep their existing behavior', () => {
  for (const strict of [false, true]) {
    const accepts = buildLocationFilter({ ...countryFilter, strict });
    for (const location of ['', '  ', undefined, null, 42, {}]) {
      assert.equal(accepts(location, '', 'Software Engineer'), !strict);
    }
  }
  const strict = buildLocationFilter({ ...countryFilter, strict: true });
  for (const label of worldwideLabels) assert.equal(strict(label, '', 'Software Engineer'), false, label);
  assert.equal(strict('United States'), true, 'strict still admits matching countries');
  assert.equal(buildLocationFilter({ strict: true, allow: ['Worldwide'] })('Worldwide'), true, 'explicit allow still works');
  assert.equal(buildLocationFilter({ strict: true })('Worldwide'), true, 'no restricting tier stays inert');
});

test('worldwide fallback respects blocked URL hints and existing tier precedence', () => {
  const url = 'https://fixture.wd5.myworkdayjobs.com/en-US/Careers/job/Berlin-Germany/Engineer_R1';
  for (const tier of ['block', 'block_hard']) {
    assert.equal(buildLocationFilter({ ...countryFilter, [tier]: ['Germany'] })('Worldwide', url), false);
  }
  const explicit = { always_allow: ['Worldwide'], allow: ['United States'], block: ['Worldwide'] };
  assert.equal(buildLocationFilter(explicit)('Worldwide'), true, 'existing always_allow still overrides block');
  assert.equal(buildLocationFilter({ ...explicit, block_hard: ['Worldwide'] })('Worldwide'), false);
});

test('worldwide fallback cannot bypass an opt-in workplace policy', () => {
  const accepts = buildLocationFilter({
    allow: ['Germany'],
    workplace_policy: {
      onsite_locations: ['Berlin'],
      remote_countries: ['Germany'],
      remote_regions: ['Worldwide'],
    },
  });
  assert.equal(accepts('Remote (worldwide)', '', 'Software Engineer', { eligibleCountries: ['United States'] }), false);
  assert.equal(accepts('Remote (worldwide)', '', 'Software Engineer', { eligibleCountries: ['Germany'] }), true);
});

test('Himalayas explicit empty restrictions are worldwide, not unknown, through the shared filter', () => {
  const item = { title: 'Software Engineer', applicationLink: 'https://himalayas.app/companies/fixture/jobs/engineer' };
  const known = parseHimalayasResponse({ jobs: [{ ...item, locationRestrictions: [] }] })[0];
  const unknown = parseHimalayasResponse({ jobs: [item] })[0];
  const accepts = buildLocationFilter(countryFilter);
  assert.equal(accepts(known.location, known.url, known.title), true);
  const blocked = buildLocationFilter({ ...countryFilter, block: ['Worldwide'] });
  assert.equal(blocked(known.location, known.url, known.title), false);
  assert.equal(blocked(unknown.location, unknown.url, unknown.title), true);
});
