// tests/fixtures/three-city-board.mjs — a local-parser fixture board.
//
// Emits ONE role posted at THREE URLs, one per city — the shape that leaked a
// city variant per scan before the company+role key was seeded across runs.
// Used by tests/scan-company-role-dedup.test.mjs; no network involved.
//
// local-parser requires the script to live inside the project root and to be
// the interpreter's first argument, and runs it with cwd pinned to the repo
// root. It reads a JSON array (or {jobs:[]}) off stdout.
const ROLE = 'Strategic Finance Manager';

console.log(JSON.stringify([
  { title: ROLE, url: 'https://boards.example.com/fixture/1001', company: 'Fixture Defense', location: 'Costa Mesa, CA' },
  { title: ROLE, url: 'https://boards.example.com/fixture/1002', company: 'Fixture Defense', location: 'Washington, DC' },
  { title: ROLE, url: 'https://boards.example.com/fixture/1003', company: 'Fixture Defense', location: 'Huntsville, AL' },
]));
