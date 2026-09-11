// tests/fixtures/locationless-relist-board.mjs — a local-parser fixture board
// that re-lists ONE role at a NEW url with NO location at all.
//
// The bare company+role key is a wildcard: it must match every city, in both
// directions. The seed-bare/candidate-located direction was already covered; the
// reverse was not. This board produces it (#3751 review).
//
// Run 1 (FIXTURE_RELIST unset) posts /3001 in "London, UK", seeding the located
//   key company::role@@london+uk into scan-history.tsv and pipeline.md.
// Run 2 (FIXTURE_RELIST=locationless) posts /3002 — a new url, so url dedupe can
//   not help — for the SAME role with the location field absent. Its own key is
//   therefore the BARE key, which matches neither the located seed nor a bare
//   seed (there is none), so before the reverse index it was added as a second
//   entry for a role the scan already had.
// Run 2 (FIXTURE_RELIST=different) posts /3002 in Dublin, a genuinely different
//   place, which MUST still be added. That is the control: making the wildcard
//   symmetric must not collapse two real cities into one.
//
// A provider returning an empty location for a posting that has one is ordinary,
// not exotic — the field is optional on every ATS this scanner reads, and the
// same req is routinely served with the city populated on one surface and blank
// on another. No network involved; local-parser reads a JSON array off stdout.
const ROLE = 'Strategic Finance Manager';
const COMPANY = 'Fixture Defense';
const mode = process.env.FIXTURE_RELIST || '';

const job = mode === 'locationless'
  ? { url: 'https://boards.example.com/fixture/3002' }
  : mode === 'different'
    ? { url: 'https://boards.example.com/fixture/3002', location: 'Dublin, IE' }
    : { url: 'https://boards.example.com/fixture/3001', location: 'London, UK' };

console.log(JSON.stringify([{ title: ROLE, company: COMPANY, ...job }]));
