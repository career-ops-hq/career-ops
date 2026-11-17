// tests/scan-seek-locations.test.mjs — SEEK result records carry their place
// as a `locations` array and their remote/hybrid/on-site label as
// `workArrangements` (#7070). Before that, every SEEK NZ offer had an empty
// location and any location_filter dropped all of them.
//
// Run:  node --test tests/scan-seek-locations.test.mjs

import test from 'node:test';
import assert from 'node:assert';
import { buildLocationFilter } from '../scan.mjs';
import { parseSeekPage } from '../scan-seek.mjs';

const SEEK_HTML_LOCATIONS = `<html><script>window.SEEK_REDUX_DATA = ${JSON.stringify({
  results: { results: { jobs: [
    { id: '82000001', title: 'Senior .NET Developer', advertiser: { description: 'Harbour Tech' },
      locations: [{ countryCode: 'NZ', label: 'Auckland CBD, Auckland' }],
      workArrangements: { data: [{ id: '3', label: { text: 'Remote' } }], displayText: 'Remote' } },
    { id: '82000002', title: 'Senior C# Engineer', advertiser: { description: 'Harbour Tech' },
      locations: [{ countryCode: 'NZ', label: 'Wellington Central, Wellington' }],
      workArrangements: { data: [{ id: '2', label: { text: 'Hybrid' } }], displayText: 'Hybrid' } },
    { id: '82000003', title: 'Software Engineer', advertiser: { description: 'Harbour Tech' },
      locations: [{ countryCode: 'NZ', label: 'Masterton, Wairarapa' }],
      workArrangements: { data: [{ id: '1', label: { text: 'On-site' } }] } },
    { id: '82000004', title: 'Developer', advertiser: { description: 'Harbour Tech' } },
  ] } },
})};</script></html>`;

test('seek page parsing reads the locations array and work arrangement', () => {
  const offers = parseSeekPage(SEEK_HTML_LOCATIONS);
  assert.deepStrictEqual(offers.map((o) => [o.location, o.workArrangement]), [
    ['Auckland CBD, Auckland, New Zealand', 'Remote'],
    ['Wellington Central, Wellington, New Zealand', 'Hybrid'],
    ['Masterton, Wairarapa, New Zealand', 'On-site'],
    ['', undefined],
  ]);
  assert.ok(!('workArrangement' in offers[3]));
});

test('seek work arrangement reaches the workplace_policy: remote NZ admitted, hybrid elsewhere dropped', () => {
  const filter = buildLocationFilter({
    always_allow: ['New Zealand'],
    allow: ['New Zealand'],
    workplace_policy: { onsite_locations: ['Masterton'], remote_countries: ['New Zealand'] },
  });
  const [remote, hybrid, onsite] = parseSeekPage(SEEK_HTML_LOCATIONS);
  assert.strictEqual(filter(remote.location, remote.url, remote.title, remote), true);
  assert.strictEqual(filter(hybrid.location, hybrid.url, hybrid.title, hybrid), false);
  assert.strictEqual(filter(onsite.location, onsite.url, onsite.title, onsite), true);
});
