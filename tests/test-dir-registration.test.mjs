// tests/test-dir-registration.test.mjs — every suite in test/ must be registered
// in test-all.mjs (#3247).
//
// The repo carries two test conventions. tests/ is auto-discovered — #1440
// removed the registration list there precisely so "a path typo can't silently
// turn CI green". test/ (singular) kept the older model: a suite runs only if
// someone wrote an explicit `run(NODE, ['--test', ...])` for it in test-all.mjs.
//
// Registration that can be forgotten was. test/profile-photo.test.mjs (8
// assertions) and test/zh-minimal-template.test.mjs (4) were both added
// 2026-07-21 and had never run when #3247 was filed. Both still passed, which
// is the point: they would have passed identically had the code under them
// rotted, because nothing was looking.
//
// This guard lives in tests/ so it is auto-discovered, and it asserts a
// PROPERTY — every test/*.test.mjs appears in test-all.mjs — rather than
// freezing a list, so adding a suite is not blocked, only forgetting to wire
// one up. Same shape as the web/ discovery contract (#2360), which asserts
// every suite on disk is matched by the declared glob.
//
// Deliberately NOT asserted here: that test/ should exist at all, or that these
// suites should move into tests/. Consolidating the two directories is a repo
// layout question; this only holds the current layout honest.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntest/ registration contract (#3247)');

const TEST_DIR = join(ROOT, 'test');
const RUNNER = join(ROOT, 'test-all.mjs');

/** Run one check in isolation so a throw cannot collapse the rest. */
function scenario(label, body) {
  try {
    body();
  } catch (err) {
    fail(`could not verify ${label} (#3247): ${err.message}`);
  }
}

scenario('test/ is readable', () => {
  if (!existsSync(TEST_DIR)) {
    // Not a failure: test/ may legitimately be retired by consolidating into
    // tests/. Nothing to guard in that case, and this must not block it.
    pass('test/ does not exist — nothing to register');
    return;
  }

  const suites = readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort();

  if (suites.length === 0) {
    pass('test/ holds no *.test.mjs — nothing to register');
    return;
  }
  pass(`test/ holds ${suites.length} suite(s) that must each be registered`);

  const runner = readFileSync(RUNNER, 'utf-8');

  // Matched by filename rather than by the exact run() spelling: the assertion
  // is that the runner reaches the suite, not how it phrases the call.
  const unregistered = suites.filter((f) => !runner.includes(`test/${f}`));

  if (unregistered.length === 0) {
    pass('every test/*.test.mjs is named in test-all.mjs');
  } else {
    fail(
      `${unregistered.join(', ')} — in test/ but named nowhere in test-all.mjs, so `
        + 'it never runs. Add a run(NODE, [\'--test\', \'test/<file>\']) block, or move '
        + 'the suite to tests/ where discovery picks it up automatically.'
    );
  }
});

// The failure this guard exists to catch is a suite that runs nowhere, so the
// guard is worthless if it cannot see the runner.
scenario('the runner is readable', () => {
  const runner = readFileSync(RUNNER, 'utf-8');
  if (runner.length > 0) pass('test-all.mjs is readable, so absence of a name means absence of a run');
  else fail('test-all.mjs read as empty — this guard cannot distinguish unregistered from unreadable');
});
