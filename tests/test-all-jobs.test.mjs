// tests/test-all-jobs.test.mjs — `test-all.mjs --jobs N` runs discovered suites
// in parallel without changing what a run reports.
//
// The claim worth pinning is equivalence, not speed: a parallel run prints the
// same verdict lines in the same order as a serial one and ends with the same
// totals and exit code. Without that, a faster run is just a different run, and
// nobody can tell a suite that broke from a runner that dropped it.
//
// The runner is driven the way a contributor drives it, through its CLI, in a
// sandbox holding the real test-all.mjs and a small `tests/` of fixture suites
// (tests/test-all-sandbox.mjs).
//
// The fixtures spell three things in pieces: the exit call, the summary call
// and the test-runner import. This file is itself a discovered suite, and the
// runner decides what to do with a suite by reading its source for exactly
// those.
import { pass, fail } from './helpers.mjs';
import { createRunnerSandbox, helpers, sleep } from './test-all-sandbox.mjs';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

console.log('\ntest-all.mjs --jobs — discovered suites in parallel');

const EXIT_CALL = 'process.' + 'exit(1)';
const SUMMARY_CALL = 'fin' + 'ish()';
const RUNNER_IMPORT = "import { test } from 'node:" + "test';";

const { sandbox, copied, suite, runner, remove } = createRunnerSandbox('career-ops-jobs-test-');

const check = (name, ok, detail) => (ok ? pass(name) : fail(`${name}${detail ? ` — ${detail}` : ''}`));

try {
  check('the sandbox holds the runner, its helpers and the child runner',
    copied.has('tests/helpers.mjs') && existsSync(join(sandbox, 'tests', 'run-discovered-child.mjs')),
    `copied: ${[...copied].join(', ')}`);

  // ── order/: suites that finish in a different order than they are listed ──
  suite('order/a-slow.test.mjs', [helpers(1), sleep(400), "pass('a: first');", "pass('a: second');"]);
  suite('order/b-fast.test.mjs', [helpers(1), "pass('b: only');"]);
  suite('order/c-mid.test.mjs', [helpers(1), sleep(150), "pass('c: only');", "warn('c: a warning');"]);
  suite('order/d-runner.test.mjs', [RUNNER_IMPORT, "test('d one', () => {});", "test('d two', () => {});"]);
  suite('order/e-fast.test.mjs', [helpers(1), "pass('e: only');"]);

  const serial = runner(['--only', 'order/', '--jobs', '1']);
  const parallel = runner(['--only', 'order/', '--jobs', '4']);
  check('a serial run of the fixtures passes', serial.status === 0 && serial.verdicts.length === 7, `status=${serial.status}\n${serial.all}`);
  check('a parallel run exits like the serial one', parallel.status === serial.status, `parallel=${parallel.status} serial=${serial.status}\n${parallel.all}`);
  check('a parallel run prints the same verdict lines in the same order',
    JSON.stringify(parallel.verdicts) === JSON.stringify(serial.verdicts),
    `serial: ${JSON.stringify(serial.verdicts)}\nparallel: ${JSON.stringify(parallel.verdicts)}`);
  check('that order is discovery order, not the order suites finished in',
    parallel.verdicts[0] === '✅ a: first' && parallel.verdicts[2] === '✅ b: only',
    JSON.stringify(parallel.verdicts));
  check('a parallel run reports the same totals', parallel.totals !== '' && parallel.totals === serial.totals, `serial "${serial.totals}" parallel "${parallel.totals}"`);
  check('a test-runner suite still reports as one line with its count',
    parallel.verdicts.includes('✅ tests/order/d-runner.test.mjs — node:test suite passed (2 tests)'), JSON.stringify(parallel.verdicts));
  check('a parallel run says how many suites ran and how many at a time', /5 discovered suites in \d+s, 4 at a time/.test(parallel.timing), parallel.timing || parallel.stdout);
  check('--jobs 1 is the in-process loop: no parallel timing line', serial.timing === '', serial.timing);

  // ── how N is chosen ───────────────────────────────────────────────────────
  const atATime = (r) => (r.timing.match(/(\d+) at a time/) ?? [])[1] ?? null;
  check('CAREER_OPS_TEST_JOBS sets N', atATime(runner(['--only', 'order/'], { CAREER_OPS_TEST_JOBS: '3' })) === '3');
  check('--jobs beats CAREER_OPS_TEST_JOBS', atATime(runner(['--only', 'order/', '--jobs', '2'], { CAREER_OPS_TEST_JOBS: '3' })) === '2');
  check('--jobs=N is read like --jobs N', atATime(runner(['--only', 'order/', '--jobs=2'])) === '2');
  check('N is never more than the number of suites', atATime(runner(['--only', 'order/', '--jobs', '64'])) === '5');
  {
    const cpus = availableParallelism();
    const r = runner(['--only', 'order/']);
    // On a single-CPU machine the default is 1, which is the in-process loop.
    const expected = cpus === 1 ? null : String(Math.min(cpus, 5));
    check('with neither set, N is the number of available CPUs', r.status === 0 && atATime(r) === expected, `cpus=${cpus} got=${atATime(r)}`);
  }
  for (const [what, args, env] of [
    ['--jobs abc', ['--jobs', 'abc'], {}],
    ['--jobs 0', ['--jobs', '0'], {}],
    ['--jobs with no value', ['--jobs'], {}],
    ['CAREER_OPS_TEST_JOBS=0', [], { CAREER_OPS_TEST_JOBS: '0' }],
    ['CAREER_OPS_TEST_JOBS=many', [], { CAREER_OPS_TEST_JOBS: 'many' }],
  ]) {
    const r = runner(['--only', 'order/', ...args], env);
    check(`${what} is a usage error, not a silent default`,
      r.status === 1 && /must be a positive integer/.test(r.stdout) && r.verdicts.every((l) => !l.startsWith('✅')),
      `status=${r.status}\n${r.stdout}`);
  }
  {
    const r = runner(['--only', 'order/b-fast', '--jobs', '4']);
    check('one matching suite runs in-process whatever N is', r.status === 0 && r.timing === '' && r.verdicts.length === 1, r.stdout);
  }

  // ── what a suite sees from inside a child ─────────────────────────────────
  suite('env/a-env.test.mjs', [helpers(1), "pass(`a: jobs env is [${process.env.CAREER_OPS_TEST_JOBS}], quick is ${QUICK}`);"]);
  suite('env/b-other.test.mjs', [helpers(1), "pass('b: only');"]);
  for (const jobs of ['1', '2']) {
    const r = runner(['--quick', '--only', 'env/', '--jobs', jobs], { CAREER_OPS_TEST_JOBS: '7' });
    // A suite that starts a test-all of its own must get a serial one, or N
    // workers each fan out N more; and --quick has to reach the suite, since
    // helpers reads it from the command line.
    check(`with --jobs ${jobs}, a suite inherits a serial default and --quick`,
      r.verdicts.includes('✅ a: jobs env is [1], quick is true'), JSON.stringify(r.verdicts));
  }

  // ── fail/: every way a suite can go wrong ─────────────────────────────────
  suite('fail/a-pass.test.mjs', [helpers(1), "pass('a: only');"]);
  suite('fail/b-fail.test.mjs', [helpers(1), "pass('b: before');", "fail('b: a real failure');", "warn('b: a warning');", "console.error('b: a stderr line');", "pass('b: after');"]);
  suite('fail/c-throw.test.mjs', [helpers(1), "pass('c: before');", "throw new Error('boom');"]);
  suite('fail/d-runner-fail.test.mjs', [RUNNER_IMPORT, "import assert from 'node:assert/strict';", "test('d fails', () => { assert.equal(1, 2); });"]);
  suite('fail/e-exit.test.mjs', [helpers(1), "pass('e: never printed');", `${EXIT_CALL};`]);
  suite('fail/f-summary.test.mjs', ["import { pass, finish } from '../helpers.mjs';", "pass('f: never printed');", `${SUMMARY_CALL};`]);
  suite('fail/g-late.test.mjs', [helpers(1), "pass('g: sync');", "setTimeout(() => pass('g: late, not awaited'), 200);"]);
  suite('fail/h-late-throw.test.mjs', [helpers(1), "pass('h: sync');", "setTimeout(() => { throw new Error('late boom'); }, 100);"]);
  suite('fail/i-dies.test.mjs', [helpers(1), "pass('i: before it dies');", "process.kill(process.pid, 'SIGKILL');", sleep(5000)]);

  const bad = runner(['--only', 'fail/', '--jobs', '4']);
  const has = (re) => bad.verdicts.some((l) => re.test(l));
  check('a run with failures exits 1', bad.status === 1, `status=${bad.status}\n${bad.all}`);
  check('a failed assertion in a child is counted and printed', has(/^❌ b: a real failure$/));
  check('a suite that throws is contained, with how far it got',
    has(/^❌ tests\/fail\/c-throw\.test\.mjs — suite threw and was contained \(Error\): boom$/)
      && /1 assertion ran before the throw/.test(bad.stdout), bad.stdout);
  check('a failing test-runner suite is one failure with an excerpt',
    has(/^❌ tests\/fail\/d-runner-fail\.test\.mjs — node:test suite failed \(exit 1\)$/) && /ERR_ASSERTION/.test(bad.stdout), bad.stdout);
  check('a suite that calls the exit is refused, not run', has(/e-exit\.test\.mjs calls process\.exit\(\)/) && !/e: never printed/.test(bad.stdout));
  check('a suite that calls the summary is refused, not run', has(/f-summary\.test\.mjs calls finish\(\)/) && !/f: never printed/.test(bad.stdout));
  check('an assertion made after the import resolved is still counted', has(/^✅ g: late, not awaited$/));
  check('an error thrown after the import resolved is one failure, not a dead run',
    has(/^❌ tests\/fail\/h-late-throw\.test\.mjs — suite process exited 1 after reporting/), JSON.stringify(bad.verdicts));
  check('a suite whose process is killed is one failure, and says its assertions were not counted',
    has(/^❌ tests\/fail\/i-dies\.test\.mjs — suite process died without reporting/), JSON.stringify(bad.verdicts));
  check('the totals are the sum of what the suites reported, plus one per broken suite',
    bad.totals === '📊 Results: 7 passed, 7 failed, 1 warnings', bad.totals);
  {
    // Both of a child's streams are captured through one descriptor, so a line
    // a suite wrote to stderr stays between the stdout lines around it.
    const lines = bad.stdout.split('\n').map((l) => l.trim());
    const at = lines.indexOf('b: a stderr line');
    check('a stderr line keeps its place between the stdout lines around it',
      at > 0 && lines[at - 1] === '⚠️  b: a warning' && lines[at + 1] === '✅ b: after', JSON.stringify(lines.slice(Math.max(0, at - 2), at + 3)));
  }
  check('the suites after a broken one still ran, in order',
    bad.verdicts.indexOf('✅ a: only') < bad.verdicts.findIndex((l) => l.includes('i-dies')) && has(/^✅ g: sync$/), JSON.stringify(bad.verdicts));

  // ── same/: the failures a serial run survives, compared line for line ─────
  //
  // fail/ above cannot be run serially at all: a suite that kills its own
  // process takes the in-process runner with it. These are the failures both
  // modes report, and they must report them identically, since both go through
  // the same classification, the same contained import and the same node:test
  // reporting.
  suite('same/a-pass.test.mjs', [helpers(1), "pass('a: only');"]);
  suite('same/b-throw.test.mjs', [helpers(1), "pass('b: before');", "fail('b: a real failure');", "throw new TypeError('boom');"]);
  suite('same/c-runner-fail.test.mjs', [RUNNER_IMPORT, "import assert from 'node:assert/strict';", "test('c passes', () => {});", "test('c fails', () => { assert.equal(1, 2); });"]);
  suite('same/d-exit.test.mjs', [helpers(1), `${EXIT_CALL};`]);
  suite('same/e-summary.test.mjs', ["import { finish } from '../helpers.mjs';", `${SUMMARY_CALL};`]);
  suite('same/f-after.test.mjs', [helpers(1), "pass('f: still runs after the broken ones');"]);
  {
    const one = runner(['--only', 'same/', '--jobs', '1']);
    const many = runner(['--only', 'same/', '--jobs', '4']);
    check('serial and parallel report the same failures, in the same words and order',
      one.verdicts.length === 8 && JSON.stringify(one.verdicts) === JSON.stringify(many.verdicts),
      `serial: ${JSON.stringify(one.verdicts)}\nparallel: ${JSON.stringify(many.verdicts)}`);
    check('serial and parallel agree on the totals and the exit code of a failing run',
      one.status === 1 && many.status === 1 && one.totals === '📊 Results: 3 passed, 5 failed, 0 warnings' && many.totals === one.totals,
      `serial ${one.status} "${one.totals}" / parallel ${many.status} "${many.totals}"`);
    check('a contained throw names the error type and how far the suite got, in both modes',
      [one, many].every((r) => r.verdicts.includes('❌ tests/same/b-throw.test.mjs — suite threw and was contained (TypeError): boom')
        && /2 assertions ran before the throw/.test(r.stdout)),
      one.stdout);
  }

  // ── linger/: a suite that never lets its process end ──────────────────────
  suite('linger/a-server.test.mjs', [helpers(1), "import { createServer } from 'node:http';", 'createServer().listen(0);', "pass('a: done, server left open');"]);
  suite('linger/b-other.test.mjs', [helpers(1), "pass('b: only');"]);
  {
    const r = runner(['--only', 'linger/', '--jobs', '2']);
    check('a suite that keeps its process alive is cut off, counted and named',
      r.status === 0 && r.totals === '📊 Results: 2 passed, 0 failed, 0 warnings'
        && /1 suite\(s\) kept their process alive after finishing and were cut off: tests\/linger\/a-server\.test\.mjs/.test(r.stdout),
      `status=${r.status}\n${r.stdout}`);
  }
} finally {
  remove();
}
