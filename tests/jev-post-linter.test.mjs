/**
 * Gate 3 linter wrapper — tests/jev-post-linter.test.mjs
 *
 * The rule under test is strict and boolean:
 *     halt <=> is_ai_sibling === true || has_measurable_metrics === false
 *
 * and, just as load-bearing, EVERYTHING ELSE is `unavailable` rather than
 * `halt`. A gate that swallows every CV when the provider rate-limits would be
 * worse than no gate, so the fail-open paths get the same coverage as the halt
 * paths here.
 *
 * Hermetic: a stub gatekeeper, no network, no API key.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { linterVerdict, describe, lintTailoredResume } from '../jev-post-linter.mjs';

const CLEAN = { is_ai_sibling: false, has_measurable_metrics: true };
const SIBLING = { is_ai_sibling: true, has_measurable_metrics: true };
const NO_METRICS = { is_ai_sibling: false, has_measurable_metrics: false };
const BOTH_BAD = { is_ai_sibling: true, has_measurable_metrics: false };

test('both booleans benign is a pass', () => {
  const v = linterVerdict(CLEAN);
  assert.equal(v.decision, 'pass');
  assert.equal(v.reasons.length, 0);
  assert.deepEqual(v.fields, { sibling: false, metrics: true });
});

test('is_ai_sibling true halts', () => {
  const v = linterVerdict(SIBLING);
  assert.equal(v.decision, 'halt');
  assert.match(v.reasons[0], /is_ai_sibling/);
  assert.match(describe(v), /^Gate 3 halt:/);
});

test('has_measurable_metrics false halts', () => {
  const v = linterVerdict(NO_METRICS);
  assert.equal(v.decision, 'halt');
  assert.match(v.reasons[0], /has_measurable_metrics/);
  assert.match(v.reasons[0], /Insert Metric/, 'the halt must tell the operator how to fix it');
});

test('both findings report both reasons', () => {
  const v = linterVerdict(BOTH_BAD);
  assert.equal(v.decision, 'halt');
  assert.equal(v.reasons.length, 2);
});

// --- fail-open: the shape of the bug this suite exists to prevent ---

test('a truthy string is NOT treated as a finding', () => {
  // A loose `if (payload.is_ai_sibling)` would halt here on the string "true".
  const v = linterVerdict({ is_ai_sibling: 'true', has_measurable_metrics: true });
  assert.equal(v.decision, 'unavailable', 'a wrong-typed field is unaudited, not a halt');
});

test('a numeric 1 is NOT treated as a finding', () => {
  const v = linterVerdict({ is_ai_sibling: 1, has_measurable_metrics: 1 });
  assert.equal(v.decision, 'unavailable');
});

test('a missing field is unavailable, not a halt', () => {
  const v = linterVerdict({ is_ai_sibling: false });
  assert.equal(v.decision, 'unavailable');
  assert.match(v.reasons[0], /non-boolean/);
});

test('null payload is unavailable', () => {
  assert.equal(linterVerdict(null).decision, 'unavailable');
  assert.equal(linterVerdict(undefined).decision, 'unavailable');
});

test('an array is unavailable', () => {
  assert.equal(linterVerdict([]).decision, 'unavailable');
});

// --- transport-level fail-open ---

/**
 * Build a sandbox containing a stub `scripts/jev_gatekeeper.py`.
 *
 * The stub is a bash script with a shebang, NOT python: the wrapper spawns it as
 * `python <script> ...`, so a bash-bodied stub would be handed to the real
 * interpreter and fail with a SyntaxError before the test's own scenario ran.
 * `python` is therefore pointed at a shim that execs bash, which keeps the stub
 * readable and lets each case control stdout, exit code, and timing in bash.
 */
function sandbox(body, { resume = true, job = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jev-lint-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'jev_gatekeeper.py'), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  if (resume) writeFileSync(join(dir, 'cv.md'), '# resume\n');
  if (job) writeFileSync(join(dir, 'job.txt'), 'job description\n');
  return { dir, resume: join(dir, 'cv.md'), job: join(dir, 'job.txt'), python: 'bash' };
}

const gate = (body) => body;

test('the gatekeeper receiving an {"error":...} object on stdout is unavailable', () => {
  // The real fail() prints this on STDOUT and exits 1 — a bare JSON.parse would
  // read a failed audit as a completed one.
  const sb = sandbox(gate(`echo '{"error": "HTTP 401: bad key"}'\nexit 1`));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: sb.dir, python: sb.python });
  assert.equal(r.decision, 'unavailable');
  assert.match(r.reasons[0], /HTTP 401/);
});

test('non-JSON stdout is unavailable', () => {
  const sb = sandbox(gate(`echo 'Traceback (most recent call last):' >&2\necho 'not json at all'`));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: sb.dir, python: sb.python });
  assert.equal(r.decision, 'unavailable');
  assert.match(r.reasons[0], /not JSON/);
});

test('a timeout is unavailable, and says so', () => {
  const sb = sandbox(gate('sleep 5'));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: sb.dir, python: sb.python, timeoutMs: 200 });
  assert.equal(r.decision, 'unavailable');
  assert.match(r.reasons[0], /timed out/);
});

test('a missing interpreter is unavailable', () => {
  const sb = sandbox(gate(`echo '${JSON.stringify(CLEAN)}'`));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: sb.dir, python: 'definitely-not-python-xyz' });
  assert.equal(r.decision, 'unavailable');
});

test('empty stdout is unavailable', () => {
  const sb = sandbox(gate('exit 0'));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: sb.dir, python: sb.python });
  assert.equal(r.decision, 'unavailable');
  assert.match(r.reasons[0], /no stdout/);
});

test('a non-zero exit with no verdict never reads as a pass', () => {
  const sb = sandbox(gate(`echo 'unrelated output'\nexit 2`));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: sb.dir, python: sb.python });
  assert.equal(r.decision, 'unavailable');
});

// --- input preconditioning ---

test('a missing resume is unavailable', () => {
  const sb = sandbox(gate(`echo '${JSON.stringify(CLEAN)}'`), { resume: false });
  const r = lintTailoredResume({ resumePath: join(sb.dir, 'nope.md'), jobPath: sb.job, root: sb.dir, python: sb.python });
  assert.equal(r.decision, 'unavailable');
  assert.match(r.reasons[0], /resume not found/);
});

test('a missing gatekeeper is unavailable', () => {
  const sb = sandbox(gate('true'));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: join(sb.dir, 'nowhere') });
  assert.equal(r.decision, 'unavailable');
  assert.match(r.reasons[0], /gatekeeper missing/);
});

test('no job description is unavailable with an explanation', () => {
  const sb = sandbox(gate(`echo '${JSON.stringify(CLEAN)}'`));
  const r = lintTailoredResume({ resumePath: sb.resume, root: sb.dir, python: sb.python });
  assert.equal(r.decision, 'unavailable');
  assert.match(r.reasons[0], /nothing to compare against/);
});

test('a missing job file is unavailable', () => {
  const sb = sandbox(gate(`echo '${JSON.stringify(CLEAN)}'`));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: join(sb.dir, 'gone.txt'), root: sb.dir, python: sb.python });
  assert.equal(r.decision, 'unavailable');
  assert.match(r.reasons[0], /job description not found/);
});

// --- end-to-end against the gate stub, proving the wiring ---

test('a clean gate pass reaches decision "pass" through the wrapper', () => {
  const sb = sandbox(gate(`echo '${JSON.stringify(CLEAN)}'`));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: sb.dir, python: sb.python });
  assert.equal(r.decision, 'pass');
});

test('a failing gate halts through the wrapper, carrying both reasons', () => {
  const sb = sandbox(gate(`echo '${JSON.stringify(BOTH_BAD)}'`));
  const r = lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: sb.dir, python: sb.python });
  assert.equal(r.decision, 'halt');
  assert.equal(r.reasons.length, 2);
});

test('the gate is invoked as: gatekeeper <resume> <job> linter', () => {
  const sb = sandbox(gate(`printf '%s\\n' "$@" > "${join(tmpdir(), 'jev-lint-args.txt')}"\nprintf '%s\\n' '${JSON.stringify(CLEAN)}'`));
  lintTailoredResume({ resumePath: sb.resume, jobPath: sb.job, root: sb.dir, python: sb.python });
  const args = execFileSync('cat', [join(tmpdir(), 'jev-lint-args.txt')], { encoding: 'utf-8' }).trim().split('\n');
  assert.equal(args.length, 3, `expected three positional args, got ${JSON.stringify(args)}`);
  assert.match(args[0], /cv\.md$/);
  assert.match(args[1], /job\.txt$/);
  assert.equal(args[2], 'linter', 'the phase must be linter, not triage');
});

// --- CLI contract: only a real finding may exit non-zero ---

function runCli(args) {
  try {
    const out = execFileSync(process.execPath, [join(import.meta.dirname, '..', 'jev-post-linter.mjs'), ...args], {
      encoding: 'utf-8',
      env: { ...process.env, JEV_PYTHON: undefined },
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('the CLI exits 0 with no usable inputs (fail-open must not break a pipeline)', () => {
  const r = runCli([]);
  assert.equal(r.code, 0);
  assert.match(r.out, /Usage:/);
});

test('the CLI exits 0 for an unauditable resume', () => {
  const r = runCli(['/nonexistent/resume.md', '/nonexistent/job.txt']);
  assert.equal(r.code, 0, 'unavailable must exit 0 or every outage would halt every build');
  assert.match(r.out, /Gate 3 unavailable/);
});

test('the module imports without running a CLI tail', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, '..', 'jev-post-linter.mjs')).href)}); process.stdout.write("clean-import");`], { encoding: 'utf-8' });
  assert.equal(out, 'clean-import');
});
