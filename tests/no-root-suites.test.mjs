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
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntest-all.mjs — no suite outside discovery');

// 1. Look in the right place first. The invariant below only ever reports an
//    ABSENCE, and a wrong or unreadable ROOT produces exactly that reading while
//    measuring nothing — a silent pass, which is the same shape as the bug this
//    file exists to prevent. test-all.mjs is the cheapest sentinel: it is the
//    harness itself and cannot move without this check's premise moving with it.
//    statSync().isFile() rather than existsSync(), so a directory of that name
//    cannot satisfy the premise either.
let rootOk = false;
try {
  rootOk = statSync(join(ROOT, 'test-all.mjs')).isFile();
} catch {
  rootOk = false;
}

if (rootOk) {
  pass('ROOT is the repo root — test-all.mjs is a file there, so an empty result means empty');
} else {
  fail(`ROOT does not hold test-all.mjs as a file (${ROOT}) — this guard is looking in the wrong place and would otherwise pass on any tree`);
}

// 2. The invariant itself, and only when the premise holds. Reporting "no stray
//    suites" beside a failed premise would print the very vacuous pass the
//    sentinel exists to catch.
if (rootOk) {
  let entries;
  try {
    entries = readdirSync(ROOT, { withFileTypes: true });
  } catch (err) {
    entries = null;
    fail(`ROOT is unreadable (${ROOT}): ${err.code || err.message} — the scan did not run, so this is not a clean tree`);
  }

  if (entries) {
    // isFile() OR isSymbolicLink(): readdirSync does not follow links, so a
    // symlinked entry reports isFile() === false — the same fact #3140 records
    // for isDirectory(). A suite linked into the root would otherwise slip past
    // this guard on every platform that checks symlinks out as symlinks, which
    // is every platform except a Windows clone with core.symlinks=false (#3364).
    const strays = entries
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.test.mjs'))
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
  }
}
