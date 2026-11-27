// tests/failure-recap.test.mjs — the "what failed, and how to rerun just that"
// recap at the end of a test-all run (tests/failure-recap.mjs, finish() in
// tests/helpers.mjs).
//
// A full run prints about 29,000 lines, and the failure is somewhere in the
// middle. The recap is the last screen, the run's summary page and the PR's
// annotations. Two halves: the pure formatting, and the real runner in a
// sandbox, where the list has to come back from child processes in both
// --jobs modes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotations, groupBySuite, INLINE_SUITE, recapLines, rerunCommand, stepSummary } from './failure-recap.mjs';
import { createRunnerSandbox, helpers } from './test-all-sandbox.mjs';
import { rmSync } from './helpers.mjs';

// ── formatting ──────────────────────────────────────────────────────────────

test('a file under tests/ reruns alone, by its path under tests/, on every OS', () => {
  assert.equal(rerunCommand('tests/check-liveness-flags.test.mjs'), 'node test-all.mjs --only check-liveness-flags.test.mjs');
  assert.equal(rerunCommand('tests\\providers\\themuse.test.mjs'), 'node test-all.mjs --only providers/themuse.test.mjs');
});

test('a failure in the inline sections, or with no file, needs the full run', () => {
  assert.equal(rerunCommand(null), 'node test-all.mjs');
  assert.equal(rerunCommand(INLINE_SUITE), 'node test-all.mjs');
});

test('failures group by file, in the order each file first failed', () => {
  const groups = groupBySuite([
    { suite: 'tests/b.test.mjs', msg: 'b one' },
    { suite: null, msg: 'inline one' },
    { suite: 'tests/b.test.mjs', msg: 'b two\nsecond line' },
  ]);
  assert.deepEqual(groups.map((g) => [g.suite, g.count, g.messages]), [
    ['tests/b.test.mjs', 2, ['b one', 'b two']],
    [INLINE_SUITE, 1, ['inline one']],
  ]);
});

test('nothing failed: no recap, no summary, no annotations', () => {
  assert.deepEqual(recapLines([]), []);
  assert.equal(stepSummary([]), '');
  assert.deepEqual(annotations([]), []);
});

test('the recap never starts a line the way fail() does, so failures are not counted twice', () => {
  const lines = recapLines([{ suite: 'tests/a.test.mjs', msg: '❌ looks like a verdict' }]);
  assert.ok(lines.length > 0);
  for (const line of lines) assert.doesNotMatch(line, /^\s*(❌|✅|⚠️)/u, line);
});

test('the recap names each file, its messages and its rerun command', () => {
  const text = recapLines([
    { suite: 'tests/a.test.mjs', msg: 'a broke' },
    { suite: 'tests/a.test.mjs', msg: 'a broke again' },
  ]).join('\n');
  assert.match(text, /What failed \(2 in 1 place\)/);
  assert.match(text, /• tests\/a\.test\.mjs\n {6}a broke\n {6}a broke again\n {6}rerun: node test-all\.mjs --only a\.test\.mjs/);
});

test('a file with many failures shows the first three and says how many more', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ suite: 'tests/x.test.mjs', msg: `m${i}` }));
  const text = recapLines(many).join('\n');
  assert.match(text, /m2\n {6}… and 4 more in this file/);
  assert.doesNotMatch(text, /m3/);
});

test('the step summary carries the OS, the rerun command and what the suite printed', () => {
  const md = stepSummary([{ suite: 'tests/a.test.mjs', msg: 'tests/a.test.mjs — node:test suite failed (exit 1)', detail: ['AssertionError', 'actual: 1'] }], { os: 'Windows' });
  assert.match(md, /^## test-all failed on Windows: 1 failure in 1 place/);
  assert.match(md, /Rerun: `node test-all\.mjs --only a\.test\.mjs`/);
  assert.match(md, /<details><summary>What it printed<\/summary>\n\n~~~\nAssertionError\nactual: 1\n~~~/);
});

test('an annotation is one line, with its title and message escaped', () => {
  const [line] = annotations([{ suite: 'tests/a,b:c.test.mjs', msg: '50% done\nsecond' }]);
  assert.equal(line, '::error title=tests/a%2Cb%3Ac.test.mjs::50%25 done — rerun: node test-all.mjs --only a,b:c.test.mjs');
});

test('at most ten annotations, the most GitHub shows for a step', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ suite: `tests/f${i}.test.mjs`, msg: 'x' }));
  assert.equal(annotations(many).length, 10);
});

// ── the real runner ─────────────────────────────────────────────────────────

// This file runs under `node --test`, which hands its children
// NODE_TEST_CONTEXT; a fixture node:test suite inheriting it would report to
// this runner instead of failing in its own (tests/ci-gemini-check.test.mjs).
delete process.env.NODE_TEST_CONTEXT;

const box = createRunnerSandbox('career-ops-recap-test-');
after(() => box.remove());

const RUNNER_IMPORT = "import { test } from 'node:" + "test';";
box.suite('recap/a-pass.test.mjs', [helpers(1), "pass('a: fine');"]);
box.suite('recap/b-fail.test.mjs', [helpers(1), "pass('b: before');", "fail('b: the value was wrong');"]);
box.suite('recap/c-runner.test.mjs', [RUNNER_IMPORT, "import assert from 'node:assert/strict';", "test('c fails', () => { assert.equal(1, 2); });"]);

const recapOf = (stdout) => stdout.slice(stdout.indexOf('── What failed'), stdout.indexOf('📊 Results'));

test('a failing run ends with the recap, before the results line, in both --jobs modes', () => {
  const one = box.runner(['--only', 'recap/', '--jobs', '1']);
  const many = box.runner(['--only', 'recap/', '--jobs', '3']);
  for (const r of [one, many]) {
    assert.equal(r.status, 1, r.all);
    const recap = recapOf(r.stdout);
    assert.match(recap, /What failed \(2 in 2 places\)/, r.stdout);
    assert.match(recap, /• tests\/recap\/b-fail\.test\.mjs\n {6}b: the value was wrong\n {6}rerun: node test-all\.mjs --only recap\/b-fail\.test\.mjs/, recap);
    assert.match(recap, /• tests\/recap\/c-runner\.test\.mjs\n {6}tests\/recap\/c-runner\.test\.mjs — node:test suite failed \(exit 1\)/, recap);
  }
  assert.equal(recapOf(many.stdout), recapOf(one.stdout), 'a parallel run recaps exactly what a serial one does');
});

test('the verdict lines and totals are what they were without the recap', () => {
  const r = box.runner(['--only', 'recap/', '--jobs', '3']);
  assert.deepEqual(r.verdicts.filter((l) => l.startsWith('❌')), [
    '❌ b: the value was wrong',
    '❌ tests/recap/c-runner.test.mjs — node:test suite failed (exit 1)',
  ]);
  assert.equal(r.totals, '📊 Results: 2 passed, 2 failed, 0 warnings');
});

test('a passing run prints no recap', () => {
  const r = box.runner(['--only', 'recap/a-pass', '--jobs', '1']);
  assert.equal(r.status, 0, r.all);
  assert.doesNotMatch(r.stdout, /What failed/);
});

test('under GitHub Actions, the failures reach the step summary and the annotations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-recap-summary-'));
  try {
    const summary = join(dir, 'summary.md');
    const r = box.runner(['--only', 'recap/', '--jobs', '3'], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary, RUNNER_OS: 'Linux' });
    assert.equal(r.status, 1, r.all);
    assert.ok(existsSync(summary), 'the summary file was written');
    const md = readFileSync(summary, 'utf-8');
    assert.match(md, /^## test-all failed on Linux: 2 failures in 2 places/);
    assert.match(md, /Rerun: `node test-all\.mjs --only recap\/c-runner\.test\.mjs`/);
    assert.match(md, /ERR_ASSERTION|AssertionError/, 'the node:test excerpt is in the summary');
    assert.match(r.stdout, /^::error title=tests\/recap\/b-fail\.test\.mjs::b: the value was wrong — rerun: /m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
