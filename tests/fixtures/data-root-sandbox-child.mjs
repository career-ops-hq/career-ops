// The child side of tests/suite-data-root-sandbox.test.mjs. Loads the helpers
// the way a suite does, from whatever environment the parent started it with,
// then does one thing a suite might do and lets the helpers answer for it.
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { run, finish, exitOnInterrupt, NODE, ROOT, REAL_DATA_ROOT, SANDBOX_DATA_ROOT } from '../helpers.mjs';
import { getCareerOpsRoot } from '../../path-resolver.mjs';

const [mode, arg] = process.argv.slice(2);

const report = () => {
  console.log(`REAL=${REAL_DATA_ROOT ?? ''}`);
  console.log(`SANDBOX=${SANDBOX_DATA_ROOT}`);
  console.log(`RESOLVED=${getCareerOpsRoot()}`);
};

// What the offending suites did: write a user-layer file in the real root.
const writeReal = () => {
  mkdirSync(join(REAL_DATA_ROOT, 'data'), { recursive: true });
  writeFileSync(join(REAL_DATA_ROOT, 'data', 'applications.md'), 'FIXTURE\n');
};

if (mode === 'report') {
  report();
} else if (mode === 'writer') {
  // A real writer, run from the checkout through run() with no env of its own:
  // the shape of the smoke test that appended to the developer's assessments.
  const out = run(NODE, [join(ROOT, 'assessment-log.mjs'), 'add', '--company', 'Acme-Co',
    '--platform', 'eSkill', '--subject', 'Data-Analysis', '--threshold', '70', '--score', '85']);
  console.log(`ADDED=${out !== null && JSON.parse(out).added === true}`);
  report();
} else if (mode === 'nested') {
  // A child of this process loads the helpers too, as a node:test suite
  // spawned by test-all.mjs does.
  const inner = execFileSync(NODE, [fileURLToPath(import.meta.url), 'report'], { encoding: 'utf-8' });
  console.log(inner.replace(/^/gm, 'INNER_').trimEnd());
  console.log(`SANDBOX_SURVIVED_CHILD=${existsSync(SANDBOX_DATA_ROOT)}`);
  report();
} else if (mode === 'write-real') {
  writeReal();
} else if (mode === 'write-real-finish') {
  writeReal();
  finish();
} else if (mode === 'write-real-signal') {
  exitOnInterrupt();
  writeReal();
  process.kill(process.pid, arg);
  // Held open so the handler has a turn of the event loop to run in; the
  // timeout only decides what happens if it never does.
  setTimeout(() => { console.log('SIGNAL-NOT-HANDLED'); }, 10_000);
} else {
  throw new Error(`unknown mode: ${mode}`);
}
