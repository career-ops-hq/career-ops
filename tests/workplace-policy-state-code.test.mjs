import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkplacePolicy } from '../providers/_country.mjs';

// Two-letter USPS codes that Intl also resolves as ISO countries.
// IN and ME are in the prose-word skip too. The state shape still has to win.
const COLLIDING_STATE_CODES = [
  ['AL', 'Albania'],
  ['AZ', 'Azerbaijan'],
  ['AR', 'Argentina'],
  ['CA', 'Canada'],
  ['CO', 'Colombia'],
  ['DE', 'Germany'],
  ['GA', 'Gabon'],
  ['ID', 'Indonesia'],
  ['IL', 'Israel'],
  ['IN', 'India'],
  ['KY', 'Cayman Islands'],
  ['LA', 'Laos'],
  ['MA', 'Morocco'],
  ['MD', 'Moldova'],
  ['ME', 'Montenegro'],
  ['MN', 'Mongolia'],
  ['MO', 'Macao SAR China'],
  ['MS', 'Montserrat'],
  ['MT', 'Malta'],
  ['NC', 'New Caledonia'],
  ['NE', 'Niger'],
  ['NH', 'Vanuatu'],
  ['PA', 'Panama'],
  ['SC', 'Seychelles'],
  ['SD', 'Sudan'],
  ['TN', 'Tunisia'],
  ['VA', 'Vatican City'],
];

const us = buildWorkplacePolicy({
  onsite_locations: ['Office City', 'River Bend', 'Cedar Grove', 'LA', 'Berlin', 'Toronto', 'Bengaluru'],
  onsite_countries: ['United States'],
  remote_countries: ['United States'],
});

test('South Carolina abbreviations are a US state, not Seychelles', () => {
  for (const location of [
    'Office City, SC',
    'Office City SC',
    'River Bend, SC',
    'Cedar Grove, SC',
    'Hybrid - Office City, SC',
  ]) {
    assert.deepEqual(us(location), { eligible: true, reason: 'onsite_location_allowed' }, location);
  }
  assert.deepEqual(us('Office City, WV'), { eligible: true, reason: 'onsite_location_allowed' });
  assert.deepEqual(us('Office City, South Carolina'), { eligible: true, reason: 'onsite_location_allowed' });
});

test('a state code in City, ST beats the ISO country with the same letters', () => {
  for (const [code, country] of COLLIDING_STATE_CODES) {
    const location = `Office City, ${code}`;
    assert.deepEqual(us(location), { eligible: true, reason: 'onsite_location_allowed' }, `${location} is not ${country}`);
  }
  assert.deepEqual(us('LA, CA'), { eligible: true, reason: 'onsite_location_allowed' });
  assert.deepEqual(us('Office City CA'), { eligible: true, reason: 'onsite_location_allowed' });
});

test('SC, US is the United States, not Seychelles', () => {
  const seychelles = buildWorkplacePolicy({
    onsite_locations: ['Office City', 'Victoria'],
    onsite_countries: ['Seychelles'],
    remote_countries: ['Seychelles'],
    remote_regions: ['Worldwide'],
  });
  assert.equal(seychelles('Remote, SC, US').reason, 'remote_country_restricted');
  assert.equal(seychelles('Office City, SC, US').reason, 'onsite_country_restricted');
  assert.equal(us('Remote, SC, US').eligible, true);
  assert.deepEqual(us('Office City, SC, US'), { eligible: true, reason: 'onsite_location_allowed' });
  assert.deepEqual(us('Office City, SC, USA'), { eligible: true, reason: 'onsite_location_allowed' });
});

test('country slots, hyphen codes, names, and a bare code stay countries', () => {
  const germany = buildWorkplacePolicy({
    onsite_locations: ['Berlin', 'Bremen'],
    onsite_countries: ['Germany'],
    remote_countries: ['Germany'],
    remote_regions: ['Europe'],
  });
  assert.equal(germany('Berlin, BE, DE').eligible, true);
  assert.equal(germany('Bremen, DE').eligible, true);
  assert.equal(germany('Berlin, Germany').eligible, true);
  assert.equal(germany('Remote, DE').eligible, true);
  assert.equal(germany('Remote - DE').eligible, true);
  assert.equal(germany('Remote Europe - DE').eligible, true);
  assert.equal(us('Berlin, BE, DE').reason, 'onsite_country_restricted');
  assert.equal(us('Remote, DE').reason, 'remote_country_restricted');
  assert.equal(us('Remote - DE').reason, 'remote_country_restricted');

  const spain = buildWorkplacePolicy({
    onsite_locations: ['Barcelona'],
    remote_countries: ['Spain'],
    remote_regions: ['Europe'],
  });
  assert.equal(spain('Remote Europe - DE').eligible, false);
  assert.equal(spain('Remote Europe - DE | Wilmington, DE').reason, 'remote_country_restricted');
  assert.equal(spain('Remote Europe - DE; Wilmington, DE').reason, 'remote_country_restricted');
  assert.deepEqual(us('Office City, SC | Wilmington, DE'), { eligible: true, reason: 'onsite_location_allowed' });
  assert.equal(spain('Remote (ES)').eligible, true);

  const canada = buildWorkplacePolicy({
    onsite_locations: ['Toronto', 'Perth'],
    onsite_countries: ['Canada'],
    remote_countries: ['Canada'],
  });
  assert.equal(canada('Toronto, ON, CA').eligible, true);
  assert.equal(us('Toronto, ON, CA').reason, 'onsite_country_restricted');
  assert.equal(canada('Perth WA, AU').reason, 'onsite_country_restricted');

  const india = buildWorkplacePolicy({
    onsite_locations: ['Bengaluru', 'Pune'],
    onsite_countries: ['India'],
    remote_countries: ['India'],
  });
  assert.equal(india('Bengaluru, KA, IN').eligible, true);
  assert.equal(india('Bengaluru, Karnataka, IN').eligible, true);
  assert.equal(india('Pune, IN').eligible, true);

  const australia = buildWorkplacePolicy({
    onsite_locations: ['Perth'],
    onsite_countries: ['Australia'],
    remote_countries: ['Australia'],
  });
  assert.equal(australia('Perth WA, AU').eligible, true);

  const seychelles = buildWorkplacePolicy({
    onsite_locations: ['Victoria'],
    onsite_countries: ['Seychelles'],
    remote_countries: ['Seychelles'],
    remote_regions: ['Worldwide'],
  });
  assert.equal(seychelles('Victoria, Seychelles').eligible, true);
  assert.equal(seychelles('Remote - SC').eligible, true);
  assert.equal(us('SC').reason, 'onsite_outside_allowed_locations');
  assert.equal(us('Remote - SC').reason, 'remote_country_restricted');
});

test('a trailing Hybrid tag does not turn a state code into a country', () => {
  assert.deepEqual(us('Office City, SC (Hybrid)'), { eligible: true, reason: 'onsite_location_allowed' });
  assert.deepEqual(us('Berlin, DE (Hybrid)'), { eligible: true, reason: 'onsite_location_allowed' });
  assert.deepEqual(us('Office City, SC (Hybrid) | River Bend, SC'), { eligible: true, reason: 'onsite_location_allowed' });
  assert.deepEqual(us('Office City, SC (Hybrid) · River Bend, SC'), { eligible: true, reason: 'onsite_location_allowed' });
  assert.equal(us('Office City, SC (Hybrid) | Berlin, Germany').reason, 'onsite_country_restricted');
  assert.equal(us('Berlin, Germany (Hybrid)').reason, 'onsite_country_restricted');
});
