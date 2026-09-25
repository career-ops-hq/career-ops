// tests/fixtures/lever-suffixed-requisitions-board.mjs — a local-parser fixture board.
//
// Emits two postings on a NON-Workday board whose titles carry hyphen-suffixed
// requisition IDs, `ABC123-1` and `ABC123-2`. On Lever the suffix is part of
// the ID, not Workday's repost disambiguator, so these are two requisitions.
// Used by tests/scan-dedup-requisition.test.mjs to pin the mixed case: the
// tracker note names `req ABC123-1` with no URL column to say which board it
// came from. No network.
const BASE = 'https://jobs.lever.co/acme';

console.log(JSON.stringify([
  { title: 'Engineer - req ABC123-1', url: `${BASE}/a1`, company: 'Acme', location: 'Vancouver, BC' },
  { title: 'Engineer - req ABC123-2', url: `${BASE}/a2`, company: 'Acme', location: 'Vancouver, BC' },
]));
