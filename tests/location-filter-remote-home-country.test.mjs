import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';

// No country keyword: Illinois is the only home signal. "IL" stays a state.
const chicagoOrRemoteUs = {
  always_allow: ['Chicago', 'Illinois', 'IL'],
  allow: ['Remote', 'Chicago', 'Illinois', 'IL'],
  block_hard: ['Canada'],
};
const remoteGermany = { allow: ['Remote', 'Germany'] };
const remoteCanada = { allow: ['Remote', 'Canada'] };

test('a US list: a generic Remote token does not pass a place outside the US', () => {
  const accepts = buildLocationFilter(chicagoOrRemoteUs);
  for (const loc of ['Remote (Hong Kong)', 'Remote - Poland', 'Remote, Germany', 'Remote - Toronto', 'Remote (London, UK)', 'Remote - Singapore', 'Remote - EMEA', 'Remote — Perth, Australia']) {
    assert.equal(accepts(loc, '', 'Analyst'), false, loc);
  }
});

test('a US list: Remote still passes US and unqualified remote locations', () => {
  const accepts = buildLocationFilter(chicagoOrRemoteUs);
  for (const loc of ['Remote', 'Remote (US)', 'Remote - United States', 'Remote, USA', 'Remote - New Mexico', 'Remote - Atlanta, Georgia', 'Remote - Georgia', 'Remote - London, KY', 'Remote - Dublin, OH', 'Remote - US or Mexico']) {
    assert.equal(accepts(loc, '', 'Analyst'), true, loc);
  }
});

test('a German list: Remote passes German places and rejects others', () => {
  const accepts = buildLocationFilter(remoteGermany);
  for (const loc of ['Remote', 'Remote (Berlin)', 'Remote - Munich', 'Remote (Bremen, DE)', 'Remote - Europe']) {
    assert.equal(accepts(loc, '', 'Analyst'), true, loc);
  }
  for (const loc of ['Remote (Hong Kong)', 'Remote (US)', 'Remote - Austin, TX', 'Remote - Texas', 'Remote - London']) {
    assert.equal(accepts(loc, '', 'Analyst'), false, loc);
  }
});

test('a Canadian list: Remote passes Canadian cities and rejects US ones', () => {
  const accepts = buildLocationFilter(remoteCanada);
  for (const loc of ['Remote - Toronto', 'Remote - Victoria, BC', 'Remote, Canada']) {
    assert.equal(accepts(loc, '', 'Analyst'), true, loc);
  }
  for (const loc of ['Remote - Seattle, WA', 'Remote (US)', 'Remote - Bangalore']) {
    assert.equal(accepts(loc, '', 'Analyst'), false, loc);
  }
});

test('no home country to read: a generic Remote token matches as before', () => {
  for (const config of [{ allow: ['Remote'] }, { allow: ['Remote', 'Chicago'] }, { allow: ['Remote', 'Spain', 'Europe'] }]) {
    const accepts = buildLocationFilter(config);
    for (const loc of ['Remote (Hong Kong)', 'Remote — Perth, Australia', 'Remote']) {
      assert.equal(accepts(loc, '', 'Analyst'), true, `${JSON.stringify(config)} ${loc}`);
    }
  }
});

test('a specific allow match is not affected by the home check', () => {
  const accepts = buildLocationFilter({ allow: ['Remote', 'Chicago', 'United States'] });
  assert.equal(accepts('Chicago, IL', '', 'Analyst'), true);
  assert.equal(accepts('Chicago, IL; Remote - Poland', '', 'Analyst'), true);
});

test('block_hard still wins over a Remote match', () => {
  const accepts = buildLocationFilter(chicagoOrRemoteUs);
  assert.equal(accepts('Remote - Canada', '', 'Analyst'), false);
});

test('blank location handling is unchanged', () => {
  assert.equal(buildLocationFilter(chicagoOrRemoteUs)('', '', 'Analyst'), true);
  assert.equal(buildLocationFilter({ ...chicagoOrRemoteUs, strict: true })('', '', 'Analyst'), false);
});

test('a remote title does not rescue a place outside the home countries', () => {
  const accepts = buildLocationFilter(chicagoOrRemoteUs);
  assert.equal(accepts('Hong Kong', '', 'Analyst - Remote'), false);
  assert.equal(accepts('Singapore', '', 'Analyst - Remote'), false);
  assert.equal(accepts('Springfield', '', 'Analyst - Remote'), true);
  assert.equal(buildLocationFilter({ allow: ['Remote'] })('Hong Kong', '', 'Analyst - Remote'), true);
});

test('Georgia is ambiguous: foreign to a German list, home to a US one', () => {
  assert.equal(buildLocationFilter(remoteGermany)('Remote - Georgia', '', 'Analyst'), false);
  assert.equal(buildLocationFilter(remoteGermany)('Remote - Atlanta, Georgia', '', 'Analyst'), false);
  assert.equal(buildLocationFilter(chicagoOrRemoteUs)('Remote - Georgia', '', 'Analyst'), true);
});

test('a US marker in one segment does not hide a home city in another', () => {
  const accepts = buildLocationFilter(remoteGermany);
  assert.equal(accepts('Remote (Berlin); Remote (US)', '', 'Analyst'), true);
  assert.equal(accepts('Remote (London); Remote (US)', '', 'Analyst'), false);
  assert.equal(buildLocationFilter(chicagoOrRemoteUs)('Remote - London, KY', '', 'Analyst'), true);
});

test('a Workday URL hint naming a foreign place rejects a bare Remote', () => {
  const accepts = buildLocationFilter({ allow: ['Remote', 'United States'] });
  const url = (place) => `https://acme.wd1.myworkdayjobs.com/en-US/careers/job/${place}/Analyst_R-1`;
  assert.equal(accepts('Remote', url('Hong-Kong'), 'Analyst'), false);
  assert.equal(accepts('Remote', url('Austin-TX'), 'Analyst'), true);
  assert.equal(accepts('Remote', '', 'Analyst'), true);
  assert.equal(accepts('Remote, United States', url('Hong-Kong'), 'Analyst'), true);
});
