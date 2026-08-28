// tests/no-root-suites.test.mjs — no test suite may sit at the repo root,
// because nothing there runs it.
//
// test-all.mjs discovers tests/**/*.test.mjs (#1440) and the comment on that
// function is explicit that discovery stops there: root-level standalone
// *.test.mjs files are never picked up. Until #3306 the nine that lived at the
// root were named one by one in a `scripts` list, and a list is a thing you can
// forget — jd-similarity.test.mjs was added with 20 assertions, appeared in no
// runner at all, and passed the whole time it was not running (#3303).
//
// #3388 moved all nine into tests/ and deleted that list, which retired the
// guard over it: a name-based check over a list that no longer exists reads as
// protection while protecting nothing. This is the successor, and it is a
// different kind of check. The old one asked "is every root suite registered?"
// — procedural, one entry per file, drifting the moment someone forgets. This
// one asks "is there a root suite at all?" — a location, with nothing to keep
// in sync, and it encodes the doctrine ARCHITECTURE.md now states rather than a
// list of the files that happen to satisfy it.
//
// `*.test.mjs` specifically, NOT "anything test-shaped". test-salary-filter.mjs
// and test-trust-validator.mjs sit at the root and are correctly registered in
// test-all.mjs; a looser pattern would redden on two files that are fine.
// #3411 moves them into tests/, after which this check reads the same either
// way — which is the point of matching the discovery pattern rather than a
// naming convention.
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntest-all.mjs — no suite outside discovery');

// 1. Look in the right place first. The assertion below is of the form "nothing
//    was found", and a wrong ROOT produces exactly that reading while measuring
//    nothing — a silent pass, which is the same shape as the bug this file
//    exists to prevent. test-all.mjs is the cheapest sentinel: it is the
//    harness itself, and it cannot move without this check's premise moving
//    with it.
if (existsSync(join(ROOT, 'test-all.mjs'))) {
  pass('ROOT is the repo root — test-all.mjs is there, so an empty result means empty');
} else {
  fail(`ROOT does not contain test-all.mjs (${ROOT}) — this guard is looking in the wrong place and would pass on any tree`);
}

// 2. The invariant itself.
const strays = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.test.mjs'))
  .map((e) => e.name)
  .sort();

if (strays.length === 0) {
  pass('no test suite sits at the repo root — tests/ is the only home');
} else {
  fail(
    `${strays.length} suite(s) at the repo root, where discovery does not reach and nothing runs them:\n` +
      strays.map((n) => `    ${n}`).join('\n') +
      '\n  Move the file into tests/ — discovery picks it up with no registration.',
  );
}
