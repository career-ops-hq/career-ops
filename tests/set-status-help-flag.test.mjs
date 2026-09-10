// tests/set-status-help-flag.test.mjs — set-status.mjs must answer --help/-h
// with the canonical states, exit 0, and never touch the tracker.
//
// HERMETIC: every run pins CAREER_OPS_TRACKER at a path that does not exist.
// If --help were NOT handled before the tracker check, the run would reach
// "No tracker found" instead of exiting on the flag itself — so that message
// doubles as proof the tracker was consulted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadCanonicalStates } from '../tracker-utils.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NO_TRACKER = join(tmpdir(), 'career-ops-no-such-tracker.md');
const NO_TRACKER_FOUND = /No tracker found/i;

function runSetStatus(...args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_TRACKER: NO_TRACKER },
  });
  assert.equal(r.error, undefined, `set-status.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `set-status.mjs was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const STATES = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));

test('--help exits 0 and prints the usage block', () => {
  const r = runSetStatus('--help');
  assert.equal(r.status, 0, `--help should exit 0, got ${r.status}: ${r.all}`);
  assert.match(r.all, /Usage: node set-status\.mjs/);
});

test('-h behaves identically to --help', () => {
  const long = runSetStatus('--help');
  const short = runSetStatus('-h');
  assert.equal(short.status, 0, `-h should exit 0, got ${short.status}`);
  assert.equal(short.stdout, long.stdout, '-h and --help should print the same text');
});

test('--help lists every canonical state from states.yml', () => {
  const r = runSetStatus('--help');
  assert.ok(STATES.length > 0, 'states.yml yielded no states');
  for (const st of STATES) {
    assert.ok(
      r.all.includes(st.label),
      `--help omitted canonical state "${st.label}" — the list must come from states.yml, not a hardcoded copy`,
    );
  }
});

test('--help explains each state rather than only naming it', () => {
  const r = runSetStatus('--help');
  const described = STATES.filter(st => st.description);
  assert.ok(described.length > 0, 'no states.yml entry carries a description');
  for (const st of described) {
    assert.ok(
      r.all.includes(st.description),
      `--help omitted the description for "${st.label}"`,
    );
  }
});

test('--help marks terminal states', () => {
  const r = runSetStatus('--help');
  assert.ok(STATES.some(st => st.terminal), 'no states.yml entry is marked terminal');
  assert.match(r.all, /\(terminal\)/, '--help should mark terminal states');
});

test('--help never consults the tracker', () => {
  const r = runSetStatus('--help');
  assert.doesNotMatch(
    r.all,
    NO_TRACKER_FOUND,
    '--help reached the tracker check; it must short-circuit before any tracker access',
  );
});

test('--help wins over otherwise-invalid arguments', () => {
  const r = runSetStatus('--report', 'not-a-number', 'Bogus', '--help');
  assert.equal(r.status, 0, `--help should win over invalid args, got ${r.status}: ${r.all}`);
  assert.match(r.all, /Usage: node set-status\.mjs/);
});

test('"--help" in a VALUE position is not a help request', () => {
  // Must stay the pre-existing "never consume a flag as a value" error: a help
  // screen exiting 0 would read as success to a script checking only the code.
  const r = runSetStatus('--report', '1', 'Applied', '--note', '--help');
  assert.equal(r.status, 1, `--note --help should exit 1, got ${r.status}: ${r.all}`);
  assert.match(r.all, /Missing value for --note/);
  assert.doesNotMatch(r.all, /Canonical states \(aliases/, 'a value position triggered the help screen');
});

test('an unrecognized flag still exits 1 and does not print help', () => {
  const r = runSetStatus('--bogus');
  assert.equal(r.status, 1, `unknown flag should exit 1, got ${r.status}`);
  assert.match(r.all, /Unknown flag: --bogus/);
  assert.doesNotMatch(r.all, NO_TRACKER_FOUND, 'unknown flag reached the tracker check');
});

test('bare invocation still reports a usage error rather than succeeding', () => {
  const r = runSetStatus();
  assert.equal(r.status, 1, `bare invocation should exit 1, got ${r.status}`);
  assert.match(r.all, /Usage: node set-status\.mjs/);
});
