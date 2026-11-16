// tests/fixtures/location-split-board.mjs — a local-parser fixture board.
//
// Two roles at one company, one inside the configured location and one outside
// it, so a scan over this board exercises both sides of `location_filter` in a
// single run. Used by tests/scan-filtered-offers-recorded.test.mjs; no network
// involved.
//
// Distinct titles on purpose: identical ones would also collide on the
// company+role dedup key, and the assertion is about the location cut alone.
console.log(JSON.stringify([
  { title: 'Strategic Finance Manager', url: 'https://boards.example.com/fixture/2001', company: 'Fixture Defense', location: 'Berlin, Germany' },
  { title: 'Strategic Finance Analyst', url: 'https://boards.example.com/fixture/2002', company: 'Fixture Defense', location: 'Bengaluru, India' },
]));
