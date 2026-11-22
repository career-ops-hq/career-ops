// tests/test-all-inline-jobs.test.mjs — with more than one job, test-all.mjs
// runs its inline sections at the same time as the discovered suites, without
// changing what a run reports (#5146).
//
// tests/test-all-jobs.test.mjs pins the same claim for the discovered suites,
// but only under `--only`, where the inline sections never run. This is the
// check for them: a run with N jobs prints the same verdict lines in the same
// order as `--jobs 1` and ends with the same totals and exit code.
//
// The real sections cannot run in a sandbox: they are most of the repository's
// checks and take the better part of a minute. So the sandbox gets the real
// test-all.mjs with the stretch between its two INLINE SECTIONS markers
// replaced by a few fixture sections. Everything outside the markers is the
// real runner: starting the child, holding the suites' output, folding the
// counters back in.
//
// The fixtures spell the exit call in pieces. This file is itself a discovered
// suite, and the runner decides what to do with a suite by reading its source
// for exactly that.
import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import { createRunnerSandbox, helpers, sleep } from './test-all-sandbox.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

console.log('\ntest-all.mjs --jobs — inline sections at the same time as the suites (#5146)');

const EXIT_CALL = 'process.' + 'exit(0)';
const RUNNER_IMPORT = "import { test } from 'node:" + "test';";
const BEGIN = /^\/\/ ── INLINE SECTIONS: BEGIN ─+$/gm;
const END = /^\/\/ ── INLINE SECTIONS: END ─+$/gm;

const check = (name, ok, detail) => (ok ? pass(name) : fail(`${name}${detail ? ` — ${detail}` : ''}`));

const realRunner = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8').replace(/\r\n/g, '\n');
const begins = [...realRunner.matchAll(BEGIN)];
const ends = [...realRunner.matchAll(END)];

if (begins.length !== 1 || ends.length !== 1 || begins[0].index > ends[0].index) {
  fail(`test-all.mjs must carry one INLINE SECTIONS: BEGIN marker and one END marker after it (found ${begins.length} and ${ends.length}) — this suite replaces the stretch between them`);
} else {
  pass('test-all.mjs marks where its inline sections begin and end');

  const head = realRunner.slice(0, begins[0].index + begins[0][0].length);
  const tail = realRunner.slice(ends[0].index);
  const box = createRunnerSandbox('career-ops-inline-jobs-test-');
  // Where a fixture section and a fixture suite leave each other a note.
  const meeting = mkdtempSync(join(tmpdir(), 'career-ops-inline-jobs-meeting-'));

  /**
   * Give the sandbox one set of inline sections and one set of suites.
   *
   * @param {string[]} sections - Lines to run as the inline sections.
   * @param {Record<string, string[]>} suites - Suite bodies by tests-relative path.
   */
  const scenario = (sections, suites) => {
    writeFileSync(join(box.sandbox, 'test-all.mjs'), `${head}\n${sections.join('\n')}\n${tail}`, 'utf-8');
    rmSync(join(box.sandbox, 'tests', 'fx'), { recursive: true, force: true });
    for (const [rel, body] of Object.entries(suites)) box.suite(`fx/${rel}`, body);
  };
  // What a run printed, less the blank lines and the parallel run's timing.
  const lines = (r) => r.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('⏱'));
  const sameRun = (a, b) => a.status === b.status && a.totals === b.totals && JSON.stringify(a.verdicts) === JSON.stringify(b.verdicts);
  const both = (a, b) => `serial ${a.status} "${a.totals}" ${JSON.stringify(a.verdicts)}\nparallel ${b.status} "${b.totals}" ${JSON.stringify(b.verdicts)}\n${b.all}`;

  try {
    // ── a passing run: the sections finish last and still print first ───────
    //
    // The sections take longer than every suite here, so in a parallel run all
    // five suites are done and waiting when the sections reach their last line.
    const passingSections = [
      "console.log('\\n🧪 fixture suite\\n');",
      "console.log('1. First section');",
      "pass('inline: one');",
      "pass(`inline: jobs env is [${process.env.CAREER_OPS_TEST_JOBS}], quick is ${QUICK}`);",
      sleep(500),
      "warn('inline: a warning');",
      "console.error('inline: a stderr line');",
      "console.log('\\n2. Second section');",
      // A handle left open: finish() exits past it in one process, and the
      // child has to as well, or the run never ends.
      "(await import('node:http')).createServer().listen(0);",
      sleep(300),
      "pass('inline: last');",
    ];
    const passingSuites = {
      'a-slow.test.mjs': [helpers(1), sleep(200), "pass('a: first');", "pass('a: second');"],
      'b-fast.test.mjs': [helpers(1), "pass('b: only');"],
      'c-mid.test.mjs': [helpers(1), sleep(100), "pass('c: only');", "warn('c: a warning');"],
      'd-runner.test.mjs': [RUNNER_IMPORT, "test('d one', () => {});", "test('d two', () => {});"],
      'e-fast.test.mjs': [helpers(1), "pass('e: only');"],
    };
    scenario(passingSections, passingSuites);
    {
      const serial = box.runner(['--quick', '--jobs', '1']);
      const parallel = box.runner(['--quick', '--jobs', '4']);
      check('a serial run of the fixtures passes with warnings',
        serial.status === 0 && serial.totals === '📊 Results: 9 passed, 0 failed, 2 warnings', `status=${serial.status}\n${serial.all}`);
      check('with 4 jobs the run prints the same verdict lines in the same order, with the same totals and exit code',
        sameRun(serial, parallel), both(serial, parallel));
      check('the sections come first although every suite finished before them',
        parallel.verdicts[0] === '✅ inline: one' && parallel.verdicts.indexOf('✅ inline: last') === 3 && parallel.verdicts[4] === '✅ a: first',
        JSON.stringify(parallel.verdicts));
      {
        const out = lines(parallel);
        check('the header and the section banners are where a serial run prints them',
          out.indexOf('🧪 fixture suite') !== -1
            && out.indexOf('🧪 fixture suite') < out.indexOf('1. First section')
            && out.indexOf('1. First section') < out.indexOf('✅ inline: one')
            && out.indexOf('⚠️  inline: a warning') < out.indexOf('2. Second section')
            && JSON.stringify(out) === JSON.stringify(lines(serial)),
          `serial:\n${serial.stdout}\nparallel:\n${parallel.stdout}`);
      }
      check('a line a section wrote to stderr reaches the run\'s stderr',
        serial.stderr.includes('inline: a stderr line') && parallel.stderr.includes('inline: a stderr line'), parallel.stderr);
      check('the sections see --quick and a serial default for any test-all they start, as the suites do',
        parallel.verdicts.includes('✅ inline: jobs env is [1], quick is true'), JSON.stringify(parallel.verdicts));
      check('the run says the sections shared the slots',
        /5 discovered suites in \d+s, 4 at a time/.test(parallel.timing)
          && /⏱ {2}the inline sections ran at the same time, for the first \d+s, in one of the 4 slots/.test(parallel.stdout), parallel.stdout);
      check('--jobs 1 runs everything in one process: no timing lines', !serial.stdout.includes('⏱'), serial.stdout);
    }
    {
      // The default is every CPU, so this is the run a contributor gets.
      const r = box.runner(['--quick'], { CAREER_OPS_TEST_JOBS: '3' });
      check('CAREER_OPS_TEST_JOBS above 1 runs the sections at the same time too',
        r.status === 0 && /in one of the 3 slots/.test(r.stdout) && r.totals === '📊 Results: 9 passed, 0 failed, 2 warnings', r.all);
    }
    {
      // 2 jobs: one for the sections, one suite at a time until they finish.
      const r = box.runner(['--quick', '--jobs', '2']);
      check('with 2 jobs the sections take one slot and the suites the other',
        r.status === 0 && /5 discovered suites in \d+s, 2 at a time/.test(r.timing) && /in one of the 2 slots/.test(r.stdout), r.all);
    }

    // ── the sections and the suites really are running at once ──────────────
    //
    // Not a timing assertion: each side waits for a note only the other one
    // writes. One after the other, whichever went first would wait for ever.
    {
      const waitFor = (file, then) => [
        `{ const { existsSync, writeFileSync } = await import('node:fs');`,
        `  const until = Date.now() + 30_000;`,
        `  while (!existsSync(${JSON.stringify(file)}) && Date.now() < until) ${sleep(20)}`,
        `  ${then} }`,
      ];
      const sectionsHere = join(meeting, 'sections-started');
      const suiteHere = join(meeting, 'suite-started');
      scenario([
        "console.log('\\n🧪 fixture suite\\n');",
        `(await import('node:fs')).writeFileSync(${JSON.stringify(sectionsHere)}, '');`,
        ...waitFor(suiteHere, `if (existsSync(${JSON.stringify(suiteHere)})) pass('inline: a suite started before the sections ended'); else fail('inline: no suite started while the sections ran');`),
      ], {
        'a-meets.test.mjs': [helpers(1), ...waitFor(sectionsHere, `writeFileSync(${JSON.stringify(suiteHere)}, ''); if (existsSync(${JSON.stringify(sectionsHere)})) pass('a: the sections were running when this suite started'); else fail('a: the sections never started');`)],
        'b-other.test.mjs': [helpers(1), "pass('b: only');"],
      });
      const r = box.runner(['--jobs', '2']);
      check('a suite starts while the sections are still running',
        r.status === 0 && r.totals === '📊 Results: 3 passed, 0 failed, 0 warnings', r.all);
    }

    // ── a failing run reports the same failures ─────────────────────────────
    scenario([
      "console.log('\\n🧪 fixture suite\\n');",
      "pass('inline: before');",
      "fail('inline: a real failure');",
      sleep(300),
      "pass('inline: after');",
    ], {
      'a-pass.test.mjs': [helpers(1), "pass('a: only');"],
      'b-fail.test.mjs': [helpers(1), "fail('b: a real failure');"],
      'c-throw.test.mjs': [helpers(1), "pass('c: before');", "throw new TypeError('boom');"],
    });
    {
      const serial = box.runner(['--jobs', '1']);
      const parallel = box.runner(['--jobs', '4']);
      check('a failing run exits 1 with the same failures, in the same words and order',
        serial.status === 1 && serial.totals === '📊 Results: 4 passed, 3 failed, 0 warnings' && sameRun(serial, parallel), both(serial, parallel));
    }

    // ── a failure only node's own exit code knows about ─────────────────────
    scenario([
      "console.log('\\n🧪 fixture suite\\n');",
      "pass('inline: only');",
      'process.exitCode = 1;',
    ], {
      'a-pass.test.mjs': [helpers(1), "pass('a: only');"],
      'b-pass.test.mjs': [helpers(1), "pass('b: only');"],
    });
    {
      const serial = box.runner(['--jobs', '1']);
      const parallel = box.runner(['--jobs', '2']);
      check('an exit code a section set fails the run in both, though every assertion passed',
        serial.status === 1 && /3 passed, 0 failed/.test(serial.totals) && sameRun(serial, parallel), both(serial, parallel));
    }

    // ── sections that do not reach their end ────────────────────────────────
    //
    // In one process each of these ends the run where it happens: no summary,
    // and no suite runs. With the sections in a child the suites have already
    // run, so the run reports them and counts the cut as one failure.
    const suitesAfterACut = {
      'a-pass.test.mjs': [helpers(1), "pass('a: only');"],
      'b-pass.test.mjs': [helpers(1), "pass('b: only');"],
    };
    for (const [what, cut, expected, counted] of [
      ['throws', "throw new Error('section boom');", /^❌ the inline sections stopped before the last one \(exit 1\) — every section after the output above did not run$/, true],
      ['exits', `${EXIT_CALL};`, /^❌ the inline sections stopped before the last one \(exit 0\) — every section after the output above did not run$/, true],
      // How a killed process is reported differs by platform; that nothing it
      // counted came back does not.
      ['is killed', "process.kill(process.pid, 'SIGKILL'); " + sleep(5000), /^❌ the inline sections stopped before the last one \(exit [^)]+\) — every section after the output above did not run, and none of the assertions above are in the totals$/, false],
    ]) {
      scenario([
        "console.log('\\n🧪 fixture suite\\n');",
        "pass('inline: before the cut');",
        cut,
        "pass('inline: never printed');",
      ], suitesAfterACut);
      const r = box.runner(['--jobs', '2']);
      check(`a section that ${what} is one failure, and the suites are still reported after it`,
        r.status === 1
          && r.verdicts.length === 4
          && r.verdicts[0] === '✅ inline: before the cut'
          && expected.test(r.verdicts[1])
          && r.verdicts[2] === '✅ a: only' && r.verdicts[3] === '✅ b: only'
          && r.totals === `📊 Results: ${counted ? 3 : 2} passed, 1 failed, 0 warnings`,
        `${JSON.stringify(r.verdicts)}\n${r.totals}\n${r.all}`);
    }

    // ── the flag is not for hand use ────────────────────────────────────────
    {
      const r = box.runner(['--inline-child']);
      check('--inline-child with no result file is a usage error',
        r.status === 1 && /--inline-child requires a result file/.test(r.stdout) && r.verdicts.every((l) => !l.startsWith('✅')), r.all);
    }
    {
      // One suite: the in-process path, sections first, as with --jobs 1.
      scenario(["console.log('\\n🧪 fixture suite\\n');", "pass('inline: only');"], { 'a-pass.test.mjs': [helpers(1), "pass('a: only');"] });
      const r = box.runner(['--jobs', '4']);
      check('with a single suite the whole run stays in one process',
        r.status === 0 && !r.stdout.includes('⏱') && JSON.stringify(r.verdicts) === JSON.stringify(['✅ inline: only', '✅ a: only']), r.all);
    }
  } finally {
    box.remove();
    rmSync(meeting, { recursive: true, force: true });
  }
}
