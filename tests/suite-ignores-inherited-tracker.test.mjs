// tests/suite-ignores-inherited-tracker.test.mjs — a CAREER_OPS_TRACKER set in
// the developer's shell must not reach the suite.
//
// The override outranks CAREER_OPS_ROOT, and fixtures pin only the root. With
// the variable inherited, `node test-all.mjs` ran normalize-statuses.mjs against
// the developer's own tracker: a `**Applied**` cell there came back as
// `Applied`, with an applications.md.bak left next to it.
//
// tests/helpers.mjs blanks the variable when it loads. This file checks that
// from a child process that starts WITH the override, the way a suite started
// from such a shell does: once the helpers are loaded, the tracker a fixture
// root resolves to is the fixture's, and a writer run against that root leaves
// the inherited file alone.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\ntest suite — an inherited CAREER_OPS_TRACKER does not reach it');

const HEADER = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n';
const ROW = '| 1 | 2026-01-01 | Acme Widgets | Coordinator | 4.0/5 | **Applied** | ❌ | — | note |\n';

const dir = mkdtempSync(join(tmpdir(), 'co-inherited-tracker-'));
try {
  // "The developer's" tracker: outside the fixture root, with a cell that
  // normalize-statuses.mjs would rewrite if it were pointed at this file.
  const outside = join(dir, 'theirs');
  mkdirSync(outside);
  const inherited = join(outside, 'applications.md');
  writeFileSync(inherited, HEADER + ROW);

  const fixtureRoot = join(dir, 'fixture');
  mkdirSync(join(fixtureRoot, 'data'), { recursive: true });
  const fixtureTracker = join(fixtureRoot, 'data', 'applications.md');
  writeFileSync(fixtureTracker, HEADER + ROW);

  // The child (tests/fixtures/writer-under-fixture-root.mjs) starts with the
  // override, loads the helpers the way a suite does, then does what the
  // path-resolution section of test-all.mjs does: pin a fixture root and run the
  // writer through run().
  const env = { ...process.env, CAREER_OPS_TRACKER: inherited };
  delete env.CAREER_OPS_ROOT;
  delete env.CAREER_OPS_DATA_DIR;
  const out = execFileSync(NODE, [join(ROOT, 'tests', 'fixtures', 'writer-under-fixture-root.mjs'), fixtureRoot], {
    cwd: ROOT,
    env,
    encoding: 'utf-8',
  });

  const resolved = (out.match(/^RESOLVED=(.*)$/m) || [])[1] || '';
  if (resolved === join(fixtureRoot, 'data', 'applications.md')) {
    pass('with the helpers loaded, a fixture root resolves to its own tracker');
  } else {
    fail(`the inherited override still decides the tracker: resolved ${resolved}`);
  }

  if (readFileSync(inherited, 'utf-8') === HEADER + ROW) {
    pass('a writer run against the fixture root leaves the inherited tracker untouched');
  } else {
    fail(`the inherited tracker was rewritten: ${JSON.stringify(readFileSync(inherited, 'utf-8').split('\n')[4])}`);
  }

  // Control: the writer did run, and on the fixture. Without this the check
  // above would also pass if normalize-statuses.mjs had done nothing at all.
  const fixtureAfter = readFileSync(fixtureTracker, 'utf-8');
  if (fixtureAfter.includes('| Applied |') && !fixtureAfter.includes('**Applied**')) {
    pass('the writer normalised the fixture tracker instead (control)');
  } else {
    fail(`the writer did not touch the fixture tracker: ${JSON.stringify(fixtureAfter.split('\n')[4])}`);
  }
} catch (err) {
  fail(`inherited-tracker test could not run: ${err.message}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
