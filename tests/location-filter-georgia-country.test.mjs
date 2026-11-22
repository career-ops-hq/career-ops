import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';

// A US always_allow token expands into USPS state names and codes (#3633), so
// "Dublin, Ohio" survives a blocked "Dublin". The name "Georgia" is also a
// country. Read as always_allow, it beat the user's own block entry, and
// "Tbilisi, Georgia" passed a filter that blocked "Tbilisi".

const US = ['United States', 'USA'];

test('a blocked Georgian city is rejected though Georgia is also a US state name', () => {
  for (const allow of [[], US]) {
    const filter = buildLocationFilter({ always_allow: US, allow, block: ['Tbilisi', 'Batumi'] });
    assert.equal(filter('Tbilisi, Georgia'), false, `allow=${JSON.stringify(allow)}`);
    assert.equal(filter('Batumi, Georgia'), false, `allow=${JSON.stringify(allow)}`);
  }
});

test('blocking the country by name rejects a bare "Georgia" location', () => {
  const filter = buildLocationFilter({ always_allow: US, block: ['Georgia'] });
  assert.equal(filter('Georgia'), false);
  assert.equal(filter('Tbilisi, Georgia'), false);
});

test('a US city in Georgia still passes', () => {
  const emptyAllow = buildLocationFilter({ always_allow: US, block: ['Tbilisi'] });
  const usAllow = buildLocationFilter({ always_allow: US, allow: US, block: ['Tbilisi'] });
  for (const filter of [emptyAllow, usAllow]) {
    assert.equal(filter('Atlanta, Georgia'), true);
    assert.equal(filter('Atlanta, GA'), true);
    assert.equal(filter('Atlanta, Georgia, United States'), true);
  }
});

test('the state code still beats a blocked homonym city', () => {
  const filter = buildLocationFilter({ always_allow: US, block: ['Dublin', 'Rome', 'Athens'] });
  assert.equal(filter('Dublin, GA'), true);
  assert.equal(filter('Rome, GA'), true);
  assert.equal(filter('Athens, GA'), true);
  assert.equal(filter('Dublin, Ohio'), true, 'other state names still override block');
});

test('an empty allow list stays empty, so unlisted places still pass', () => {
  const filter = buildLocationFilter({ always_allow: US, block: ['Tbilisi'] });
  assert.equal(filter('Lisbon, Portugal'), true);
  assert.equal(filter('Remote'), true);
});

test('configs without a US always_allow token are unchanged', () => {
  const filter = buildLocationFilter({ always_allow: ['Germany'], allow: ['Germany'] });
  assert.equal(filter('Atlanta, Georgia'), false);
  assert.equal(filter('Berlin, Germany'), true);
});
