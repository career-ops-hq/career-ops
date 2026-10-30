// tests/fixtures/two-requisition-board.mjs — a local-parser fixture board.
//
// Emits ONE title posted as TWO different Workday requisitions, the shape of
// UBC's concurrent "Programmer Analyst I" openings (JR25919 and JR25853, two
// departments). Used by tests/scan-dedup-requisition.test.mjs; no network.
//
// local-parser requires the script to live inside the project root and to be
// the interpreter's first argument, and runs it with cwd pinned to the repo
// root. It reads a JSON array (or {jobs:[]}) off stdout.
const ROLE = 'Programmer Analyst I';
const BASE = 'https://ubc.wd10.myworkdayjobs.com/ubcstaffjobs/job/UBC-Vancouver-Campus---Vancouver-BC-Canada';

console.log(JSON.stringify([
  { title: ROLE, url: `${BASE}/Programmer-Analyst-I_JR25919`, company: 'UBC', location: 'UBC Vancouver Campus - Vancouver, BC, Canada' },
  { title: ROLE, url: `${BASE}/Programmer-Analyst-I_JR25853`, company: 'UBC', location: 'UBC Vancouver Campus - Vancouver, BC, Canada' },
]));
