// tests/fixtures/reordering-multi-city-board.mjs — a local-parser fixture board
// that re-lists ONE role at a NEW url with the SAME cities in a DIFFERENT order.
//
// This is the shape the location dedupe key has to survive (#3750 review). The
// provider location field is free text that often packs several places into one
// string, and nothing pins the order they appear in — the board's own copy
// changes, and our providers (greenhouse, ashby, eightfold, gem, ibm, echojobs)
// build the string from an upstream array. A verbatim key reads the re-ordered
// string as a different place and re-adds a posting the scan already has; a key
// built from the sorted SET of places does not.
//
// Run 1 (FIXTURE_RELIST unset) posts /2001 as "London, UK | Dublin, IE".
// Run 2 (FIXTURE_RELIST=reordered) posts /2002 — a new url, so url dedupe can
//   not help — as "Dublin, IE | London, UK", the same two cities re-ordered.
// Run 2 (FIXTURE_RELIST=different) posts /2002 in Berlin, a genuinely different
//   place, which MUST still be added. That is the control: the fix must dedupe
//   a re-ordering without deduping a real second city.
//
// No network involved; local-parser reads a JSON array off stdout.
const ROLE = 'Strategic Finance Manager';
const COMPANY = 'Fixture Defense';
const mode = process.env.FIXTURE_RELIST || '';

const job = mode === 'reordered'
  ? { url: 'https://boards.example.com/fixture/2002', location: 'Dublin, IE | London, UK' }
  : mode === 'different'
    ? { url: 'https://boards.example.com/fixture/2002', location: 'Berlin, DE' }
    : { url: 'https://boards.example.com/fixture/2001', location: 'London, UK | Dublin, IE' };

console.log(JSON.stringify([{ title: ROLE, company: COMPANY, ...job }]));
