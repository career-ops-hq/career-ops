import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';

const filter = buildLocationFilter({
  always_allow: ['united states'],
  block: ['india', 'bengaluru', 'canada', 'toronto', 'germany', 'berlin'],
});

test('a trailing ISO country code is not read as a US state', () => {
  for (const location of [
    'Bengaluru, Karnataka, IN',
    'Bengaluru, KA, IN',
    'Toronto, ON, CA',
    'Berlin, BE, DE',
  ]) {
    assert.equal(filter(location), false, `${location} stays blocked`);
  }
});

test('each place in a joined location gets its own country-code check', () => {
  for (const location of [
    'Bengaluru, Karnataka, IN; Remote',
    'Toronto, ON, CA · Vancouver, BC, CA',
    'Berlin, BE, DE; Bengaluru, KA, IN',
  ]) {
    assert.equal(filter(location), false, `${location} stays blocked`);
  }
  assert.equal(filter('Toronto, ON, CA · Austin, TX, US'), true, 'a US place in the list still passes');
  assert.equal(filter('Toronto, Canada; Austin TX, US'), true, 'a state before the country slot still passes');
  assert.equal(filter('Austin TX, US'), true);
  assert.equal(filter('Austin TX · Toronto, ON, CA'), true, 'a US state in an earlier place still passes');
  assert.equal(filter('Austin TX; Toronto, Canada'), true);
  assert.equal(filter('Santa Fe, NM; Toronto, Canada'), true, 'a two-letter word in the city is not a state');
  const perth = buildLocationFilter({ always_allow: ['united states'], block: ['perth'] });
  assert.equal(perth('Perth WA, AU'), false, 'a foreign country slot rules out a US state');
  assert.equal(perth('Perth WA, AU; Remote'), false);
  assert.equal(filter('Dublin, OH'), true, 'City, ST is not a country slot');
  assert.equal(filter('LA, CA'), true, 'two state codes are a city and a state');
  assert.equal(filter('LA, CA · Toronto, Canada'), true, 'a US city and state still passes beside a blocked place');
  assert.equal(filter('Brooklyn, NY, NY · Toronto, Canada'), true, 'a state code written twice is still a state');
});

test('US states still rescue City, ST and City, ST, Country forms', () => {
  for (const location of ['Dublin, OH', 'Austin, TX, US', 'Columbus, OH, USA', 'Portland, OR, United States']) {
    assert.equal(filter(location), true, `${location} passes`);
  }
  const usBlock = buildLocationFilter({ always_allow: ['united states'], block: ['dublin'] });
  assert.equal(usBlock('Dublin, OH, US'), true);
  assert.equal(usBlock('Dublin, D, IE'), false);
});
