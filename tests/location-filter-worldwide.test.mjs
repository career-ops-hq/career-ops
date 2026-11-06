// #6413: known worldwide eligibility is not missing location data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';
import { parseHimalayasResponse } from '../providers/himalayas.mjs';
import { buildWorkplacePolicy, isCountryKeyword } from '../providers/_country.mjs';

const worldwideLabels = [
  'Worldwide',
  'Anywhere in the World',
  'Remote (worldwide)',
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
  for (const country of ['Bangladesh', 'Canada', 'United Kingdom', 'U.K.', 'United States of America', 'DE', 'DEU', 'IN', 'Puerto Rico', 'PRI', 'Kosovo', 'XK']) {
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

test('QO allow-list does not admit Worldwide through the country-only fallback', () => {
  const accepts = buildLocationFilter({ allow: ['QO'], remote_title_fallback: false });
  assert.equal(accepts('Worldwide', '', 'Software Engineer'), false);
  assert.equal(accepts('QO', '', 'Software Engineer'), true, 'explicit region keywords still match');
});

test('country keywords exclude CLDR subdivisions, aggregates and pseudo-regions', () => {
  for (const [code, name] of [
    ['AC', 'Ascension Island'], ['CP', 'Clipperton Island'], ['CQ', 'Sark'],
    ['DG', 'Diego Garcia'], ['EA', 'Ceuta & Melilla'], ['IC', 'Canary Islands'],
    ['TA', 'Tristan da Cunha'], ['QO', 'Outlying Oceania'],
    ['XA', 'Pseudo-Accents'], ['XB', 'Pseudo-Bidi'],
    ['EU', 'European Union'], ['EZ', 'Eurozone'], ['UN', 'United Nations'],
    ['ZZ', 'Unknown Region'],
  ]) {
    assert.equal(isCountryKeyword(code), false, code);
    assert.equal(isCountryKeyword(name), false, name);
  }
});

test('unrecognized or qualified labels do not acquire worldwide eligibility', () => {
  const accepts = buildLocationFilter(countryFilter);
  for (const location of [
    'Remote', 'Unknown', 'Anywhere', 'Global', 'Canada',
    'Not worldwide', 'Worldwide except Canada', 'Worldwide (US only)',
    'Worldwide, Europe', 'Remote (worldwide) - US only',
    'Anywhere  in the World', 'Worldwide - extra',
    'Worldwide (Himalayas: no country restriction)',
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
  assert.equal(known.location, 'Remote (worldwide)');
  assert.equal(accepts(known.location, known.url, known.title), true);
  const blocked = buildLocationFilter({ ...countryFilter, block: ['Worldwide'] });
  assert.equal(blocked(known.location, known.url, known.title), false);
  assert.equal(blocked(unknown.location, unknown.url, unknown.title), true);
});

test('Himalayas worldwide output retains the remote signal for keyword filters', () => {
  const [job] = parseHimalayasResponse({ jobs: [{
    title: 'Software Engineer',
    applicationLink: 'https://himalayas.app/companies/fixture/jobs/engineer',
    locationRestrictions: [],
  }] });
  for (const allow of [['Remote'], ['Remote', 'United States']]) {
    const accepts = buildLocationFilter({ allow, remote_title_fallback: false });
    assert.equal(accepts(job.location, job.url, job.title), true, JSON.stringify(allow));
  }
});

test('Himalayas worldwide output is remote, not onsite, under workplace_policy', () => {
  const [job] = parseHimalayasResponse({ jobs: [{
    title: 'Software Engineer',
    applicationLink: 'https://himalayas.app/companies/fixture/jobs/engineer',
    locationRestrictions: [],
  }] });
  const policy = {
    onsite_locations: ['New York'],
    remote_countries: ['United States'],
    remote_regions: ['Worldwide'],
  };
  assert.deepEqual(buildWorkplacePolicy(policy)(job.location, job.title, job), {
    eligible: true,
    reason: 'remote_region_allowed',
  });
  const accepts = buildLocationFilter({ ...countryFilter, workplace_policy: policy });
  assert.equal(accepts(job.location, job.url, job.title, job), true);
});

test('Himalayas worldwide output does not match a strict Norway allow-list', () => {
  const [job] = parseHimalayasResponse({ jobs: [{
    title: 'Software Engineer',
    applicationLink: 'https://himalayas.app/companies/fixture/jobs/engineer',
    locationRestrictions: [],
  }] });
  for (const country of ['NO', 'Norway']) {
    const accepts = buildLocationFilter({ allow: [country], strict: true, remote_title_fallback: false });
    assert.equal(accepts(job.location, job.url, job.title), false, country);
    assert.equal(accepts(country, '', job.title), true, 'explicit country matches still work');
  }
});

test('Himalayas worldwide label contains no country name, alias or ISO token', () => {
  const [job] = parseHimalayasResponse({ jobs: [{
    title: 'Software Engineer',
    applicationLink: 'https://himalayas.app/companies/fixture/jobs/engineer',
    locationRestrictions: [],
  }] });
  const words = job.location.match(/[\p{L}\p{N}.]+/gu) ?? [];
  assert.ok(words.length > 0, 'the worldwide label must not be empty');
  assert.deepEqual(words.filter(isCountryKeyword), [], job.location);
});
