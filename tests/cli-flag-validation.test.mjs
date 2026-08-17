// tests/cli-flag-validation.test.mjs — four reporting CLIs must reject a
// mistyped flag instead of answering from their defaults (#2919).
//
// The failure class lib/cli-flags.mjs exists to end: an unrecognized flag is
// ignored, the value flag it was meant to be falls back to its default, and
// the script reports a result for inputs nobody asked for at exit 0. Already
// fixed in scan-ats-full.mjs (#1633/#1635), reply-watch.mjs (#2743/#2745),
// dedup-tracker.mjs (#2744/#2746), scan.mjs (#2270), doctor.mjs (#2874),
// check-table-freshness.mjs (#2873) and plugin-audit.mjs (#2813).
//
// rejection-latency.mjs is the sharpest case and gets its own fixture: its
// output is a blacklist suggestion, so the silent failure is a FALSE ALL-CLEAR
// the user then acts on. The fixture below has one company 217 days past the
// 30-day courtesy threshold, so "no post-interview silence exceeded" is proof
// the flag was dropped and a different tracker was read.
//
// HERMETIC: every path is a tmpdir fixture; nothing reads or writes the real
// data/ directory. Each run asserts the subprocess actually ran (no spawn
// error, no signal), so a timeout cannot pass as a silent success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function runScript(script, ...args) {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  assert.equal(r.error, undefined, `${script} failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `${script} was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// Each script paired with a realistic typo of one of ITS OWN value flags —
// the transposition a user actually makes, not an obviously bogus token.
const SCRIPTS = [
  ['rejection-latency.mjs', '--traker'],
  ['process-quality.mjs', '--fiel'],
  ['detect-reposts.mjs', '--windo'],
  ['weekly-digest.mjs', '--dri'],
];

for (const [script, typo] of SCRIPTS) {
  test(`${script} rejects ${typo} instead of falling back to its default`, () => {
    const r = runScript(script, typo, 'some-value');
    assert.equal(r.status, 1, `${script} ${typo} exited ${r.status}, want 1`);
    assert.match(r.all, /unrecognized flag/i, `${script} did not name the unrecognized flag`);
    assert.match(r.all, new RegExp(typo.replace(/^--/, '--')), `${script} did not echo ${typo} back`);
  });

  test(`${script} --help exits 0 and prints usage`, () => {
    const r = runScript(script, '--help');
    assert.equal(r.status, 0, `${script} --help exited ${r.status}, want 0`);
    assert.match(r.all, /Usage:/i, `${script} --help printed no usage block`);
  });

  // CodeRabbit caught the reverse ordering as a bug on #2745 and #2746: the
  // unrecognized-flag check must run BEFORE --help, or `--help --bogus` exits
  // 0 having never looked at --bogus.
  test(`${script} --help --bogus still errors`, () => {
    const r = runScript(script, '--help', '--bogus');
    assert.equal(r.status, 1, `${script} --help --bogus exited ${r.status}, want 1`);
    assert.match(r.all, /unrecognized flag/i);
  });
}

// --- rejection-latency: the false all-clear, and the `=` form (#2401) -------

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-flagval-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const tracker = join(dir, 'data', 'applications.md');
    const active = join(dir, 'data', 'active-interviews.md');
    writeFileSync(
      tracker,
      '# Applications Tracker\n\n' +
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
        '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
        '| 1 | 2026-01-05 | SandboxCo | Staff Eng | 4.5/5 | Interview | ✅ | [1](reports/001-sandboxco-2026-01-05.md) | — |\n',
    );
    writeFileSync(
      active,
      '# Active Interviews\n\n' +
        '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |\n' +
        '|---------|------|-------|-----------|-------------|--------|-------|\n' +
        '| SandboxCo | Staff Eng | Round 3 | 2026-01-10 | Panel | Done | #1 in tracker |\n',
    );
    return fn({ tracker, active });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FLAGGED = /SandboxCo/;
const ALL_CLEAR = /No post-interview silence exceeded/i;

test('rejection-latency finds the 217-day row with space-separated flags', () => {
  withFixture(({ tracker, active }) => {
    const r = runScript(
      'rejection-latency.mjs',
      '--tracker', tracker, '--file', active, '--today', '2026-08-15', '--summary',
    );
    assert.equal(r.status, 0);
    assert.match(r.all, FLAGGED, 'the flagged company is missing — fixture or join broke');
    assert.doesNotMatch(r.all, ALL_CLEAR);
  });
});

test('rejection-latency honours the --flag=value form (#2401)', () => {
  withFixture(({ tracker, active }) => {
    const r = runScript(
      'rejection-latency.mjs',
      `--tracker=${tracker}`, `--file=${active}`, '--today=2026-08-15', '--summary',
    );
    assert.equal(r.status, 0);
    // Before the fix this printed the all-clear: indexOf() cannot see the `=`
    // form, so both paths silently fell back to the real data/ directory.
    assert.match(r.all, FLAGGED, 'the `=` form was silently discarded');
    assert.doesNotMatch(r.all, ALL_CLEAR);
  });
});

test('rejection-latency: a trailing value flag is a usage error, not a default', () => {
  // hasFlag is paired with flagValue precisely so this stays an error —
  // flagValue alone returns undefined for both "absent" and "no value given",
  // which would silently reinstate the default tracker.
  const r = runScript('rejection-latency.mjs', '--summary', '--tracker');
  assert.equal(r.status, 2, `want exit 2, got ${r.status}`);
  assert.match(r.all, /--tracker requires a value/);
});

test('rejection-latency: --today --summary does not set the date to "--summary"', () => {
  const r = runScript('rejection-latency.mjs', '--today', '--summary');
  assert.equal(r.status, 2);
  assert.match(r.all, /--today requires a value/);
});

// --- the importer hazard ---------------------------------------------------

// process-quality.mjs and detect-reposts.mjs are imported by other CLIs, so
// their validateFlags call must sit inside the main-module guard. At top level
// it would judge the IMPORTER's argv and reject its valid flags.
test('validating importable modules does not break their importers', () => {
  withFixture(({ tracker, active }) => {
    // rejection-latency imports parseActiveInterviews from process-quality
    const r1 = runScript(
      'rejection-latency.mjs',
      '--tracker', tracker, '--file', active, '--today', '2026-08-15', '--summary',
    );
    assert.equal(r1.status, 0, 'process-quality rejected its importer\'s flags');
    assert.doesNotMatch(r1.all, /unrecognized flag/i);
  });
  // company-history imports detectReposts/parseScanHistory from detect-reposts
  const r2 = runScript('company-history.mjs', '--help');
  assert.equal(r2.status, 0, 'detect-reposts rejected its importer\'s flags');
  assert.doesNotMatch(r2.all, /unrecognized flag/i);
});
