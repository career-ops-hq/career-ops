import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';

// #7293. The city part of Washington, DC is the name of a US state, so
// `allow: ["Washington"]`, written for the state, admitted every DC posting.
// And `block: ["DC"]` missed the "Washington, D.C." spelling.

const DC_SPELLINGS = [
  'Washington, District of Columbia',
  'Washington, DC',
  'Washington, D.C.',
  'Washington DC',
  'Washington D.C. Metro Area',
  'Washington,DC',
  'Washington (DC)',
  'Washington - DC',
  'Washington \u2013 D.C.',
];

test('allow "Washington" (the state) no longer admits Washington, DC', () => {
  const filter = buildLocationFilter({ allow: ['Washington', 'Seattle'] });
  for (const loc of DC_SPELLINGS) assert.equal(filter(loc), false, loc);
});

test('allow "Washington" still admits places in Washington State', () => {
  const filter = buildLocationFilter({ allow: ['Washington'] });
  assert.equal(filter('Seattle, Washington'), true);
  assert.equal(filter('Spokane, Washington'), true);
  assert.equal(filter('Seattle, Washington, United States'), true);
  assert.equal(filter('Washington'), true, 'a bare state name');
});

test('a multi-place posting passes on its Washington State part', () => {
  const filter = buildLocationFilter({ allow: ['Washington'] });
  assert.equal(filter('Seattle, Washington; Washington, District of Columbia'), true);
  assert.equal(filter('Washington, DC · Olympia, Washington'), true);
  assert.equal(filter('Seattle, Washington; Washington (DC)'), true);
});

test('"WA" is not read as the state, so "Seattle, WA" needs its own entry', () => {
  const filter = buildLocationFilter({ allow: ['Washington'] });
  assert.equal(filter('Seattle, WA'), false, 'unchanged from before #7293');
  assert.equal(filter('Seattle, WA; Washington, DC'), false, 'no longer admitted through the DC city name');
  const withWa = buildLocationFilter({ allow: ['Washington', 'WA'] });
  assert.equal(withWa('Seattle, WA; Washington, DC'), true);
});

test('always_allow "Washington" does not rescue a blocked DC posting', () => {
  const filter = buildLocationFilter({ always_allow: ['Washington'], block: ['District of Columbia', 'DC'] });
  for (const loc of DC_SPELLINGS) assert.equal(filter(loc), false, loc);
  assert.equal(filter('Seattle, Washington'), true);
});

test('block "Washington" still blocks both, so no block gets weaker', () => {
  const filter = buildLocationFilter({ block: ['Washington'] });
  assert.equal(filter('Washington, DC'), false);
  assert.equal(filter('Seattle, Washington'), false);
});

test('an allow entry naming the city keeps matching it', () => {
  const cases = [
    ['Washington, DC', 'Washington, DC'],
    ['Washington DC', 'Washington DC'],
    ['District of Columbia', 'Washington, District of Columbia'],
    ['DC', 'Washington, DC'],
    ['D.C.', 'Washington, D.C.'],
  ];
  for (const [entry, loc] of cases) {
    const filter = buildLocationFilter({ allow: [entry] });
    assert.equal(filter(loc), true, `allow ${entry} vs ${loc}`);
  }
});

test('"DC" and "D.C." match either spelling, in any case', () => {
  for (const entry of ['DC', 'D.C.', 'dc', 'd.c.', 'D.C']) {
    const filter = buildLocationFilter({ block: [entry] });
    assert.equal(filter('Washington, DC'), false, `block ${entry} vs DC`);
    assert.equal(filter('Washington, D.C.'), false, `block ${entry} vs D.C.`);
    assert.equal(filter('Remote (DC area)'), false, `block ${entry} vs (DC area)`);
    assert.equal(filter('Seattle, WA'), true, `block ${entry} vs Seattle`);
    assert.equal(filter('Madison, Wisconsin'), true, `block ${entry} vs a word containing dc letters`);
  }
  const hard = buildLocationFilter({ always_allow: ['United States'], block_hard: ['DC'] });
  assert.equal(hard('Washington, D.C.'), false, 'block_hard DC vs D.C.');
});

test('a US always_allow still admits DC as a US place', () => {
  const US = ['United States', 'USA'];
  for (const allow of [[], US]) {
    const filter = buildLocationFilter({ always_allow: US, allow });
    for (const loc of DC_SPELLINGS) assert.equal(filter(loc), true, `${loc} allow=${JSON.stringify(allow)}`);
  }
});

test('the Workday URL hint is read the same way', () => {
  const filter = buildLocationFilter({ allow: ['Washington'] });
  const dcUrl = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Washington-DC/Engineer_R-1';
  const waUrl = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Seattle-Washington/Engineer_R-2';
  assert.equal(filter('2 Locations', dcUrl), false);
  assert.equal(filter('2 Locations', waUrl), true);
});

test('a bare "Washington" URL hint does not admit a Washington, DC posting', () => {
  const bareUrl = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Washington/Engineer_R-3';
  const countryUrl = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Washington-United-States/Engineer_R-4';
  const waUrl = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Seattle-Washington/Engineer_R-2';
  const always = buildLocationFilter({ always_allow: ['Washington'], block: ['District of Columbia', 'DC'] });
  for (const loc of DC_SPELLINGS) {
    assert.equal(always(loc, bareUrl), false, `always_allow vs ${loc} + bare hint`);
    assert.equal(always(loc, countryUrl), false, `always_allow vs ${loc} + Washington-United-States hint`);
  }
  assert.equal(always('Seattle, Washington', bareUrl), true, 'no DC in the display: the hint names the state');
  assert.equal(always('Seattle, WA', waUrl), true, 'Seattle-Washington keeps matching');
  assert.equal(always('Washington, DC', waUrl), true, 'an explicit Washington State hint still wins');
  const stateUrl = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Washington-State/Engineer_R-5';
  assert.equal(always('Washington, DC', stateUrl), true, 'Washington-State names the state');
  const allow = buildLocationFilter({ allow: ['Washington'] });
  assert.equal(allow('Washington, DC', bareUrl), false, 'allow vs bare hint');
  assert.equal(allow('2 Locations', bareUrl), true, 'no DC in the display: unchanged');
  assert.equal(allow('Washington, DC', stateUrl), true, 'allow vs Washington-State hint');
  assert.equal(allow('Washington, DC', 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Washington-Statehouse/Engineer_R-6'), false, 'only the whole word "state"');
});
