import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter, locationHintFromUrl } from '../scan.mjs';

const SITE = 'https://wd5.myworkdaysite.com/recruiting/acme/external/job/Hyderabad-Telangana-India/Network-Engineer_R-1';
const JOBS = 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Hyderabad-Telangana-India/Network-Engineer_R-1';

test('a myworkdaysite path supplies the city the display line omitted', () => {
  assert.equal(locationHintFromUrl(SITE), 'hyderabad telangana india');
  assert.equal(locationHintFromUrl(JOBS), 'hyderabad telangana india');
  const filter = buildLocationFilter({ always_allow: ['united states'], block: ['india', 'hyderabad'] });
  assert.equal(filter('5 Locations', SITE), false);
  assert.equal(filter('5 Locations', JOBS), false);
  assert.equal(locationHintFromUrl('https://boards.greenhouse.io/acme/job/India/Eng_R1'), '');
});
