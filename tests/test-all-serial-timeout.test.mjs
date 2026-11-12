// tests/test-all-serial-timeout.test.mjs — a node:test suite that runs past
// its budget in the in-process loop is reported as killed, not as `exit ?`.
//
// `test-all.mjs --only <one file>` and `--jobs 1` run a node:test suite through
// run(), whose 30 s timeout kills the child with SIGTERM. A killed child has no
// exit status, so the failure line read `node:test suite failed (exit ?)` while
// the parallel loop says `killed after 120s` for the same thing. A contributor
// re-running one red suite alone was told it crashed, when it ran out of time.
//
// The sandbox's copy of helpers.mjs gets a 2 s budget instead of 30 s, so the
// case takes seconds; both spellings of the budget in that file are patched,
// and the case fails if either is missing.
import { pass, fail } from './helpers.mjs';
import { createRunnerSandbox } from './test-all-sandbox.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

console.log('\ntest-all.mjs — a node:test suite past its budget in the in-process loop');

const RUNNER_IMPORT = "import { test } from 'node:" + "test';";
const check = (name, ok, detail) => (ok ? pass(name) : fail(`${name}${detail ? ` — ${detail}` : ''}`));

const { sandbox, suite, runner, remove } = createRunnerSandbox('career-ops-serial-timeout-');
try {
  const helpersFile = join(sandbox, 'tests', 'helpers.mjs');
  const src = readFileSync(helpersFile, 'utf-8');
  const patched = src
    .replace('export const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;', 'export const DEFAULT_SCRIPT_TIMEOUT_MS = 2_000;')
    .replace("encoding: 'utf-8', timeout: 30000,", "encoding: 'utf-8', timeout: 2000,");
  const both = (patched.match(/2_000;|timeout: 2000,/g) ?? []).length === 2;
  check('the sandbox budget is shortened in both places helpers.mjs spells it', both);
  writeFileSync(helpersFile, patched);

  suite('slow/a-slow.test.mjs', [RUNNER_IMPORT, "test('outlives the budget', async () => { await new Promise((r) => setTimeout(r, 8000)); });"]);

  for (const args of [['--only', 'slow/'], ['--only', 'slow/', '--jobs', '1']]) {
    const r = runner(args);
    const line = r.verdicts.find((l) => l.includes('slow/a-slow.test.mjs')) ?? '(no line for the suite)';
    check(`${args.join(' ')}: the suite fails`, r.status === 1, `status=${r.status}\n${r.all}`);
    check(`${args.join(' ')}: the failure says it was killed after the budget`,
      line === '❌ tests/slow/a-slow.test.mjs — node:test suite failed (killed after 2s)', line);
  }

  // A suite that fails inside its budget keeps its exit status.
  suite('red/a-red.test.mjs', [RUNNER_IMPORT, "import assert from 'node:assert/strict';", "test('fails', () => { assert.equal(1, 2); });"]);
  {
    const r = runner(['--only', 'red/']);
    const line = r.verdicts.find((l) => l.includes('red/a-red.test.mjs')) ?? '(no line for the suite)';
    check('a suite that fails in time still reports its exit status',
      line === '❌ tests/red/a-red.test.mjs — node:test suite failed (exit 1)', line);
  }
} finally {
  remove();
}
