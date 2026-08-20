// tests/cli-flag-validation.test.mjs — the CLIs that must reject a mistyped
// flag instead of answering from their defaults (#2919).
//
// The failure class lib/cli-flags.mjs exists to end: an unrecognized flag is
// ignored, the value flag it was meant to be falls back to its default, and
// the script reports a result for inputs nobody asked for at exit 0. Already
// fixed in scan-ats-full.mjs (#1633/#1635), reply-watch.mjs (#2743/#2745),
// dedup-tracker.mjs (#2744/#2746), scan.mjs (#2270), doctor.mjs (#2874),
// check-table-freshness.mjs (#2873), plugin-audit.mjs (#2813) and
// upskill.mjs and archive-posting.mjs (#2977).
//
// archive-posting.mjs is the one that does not merely report: a dropped
// --report writes a capture with no report prefix, findable only by rebuilding
// the filename from that day's date and the scraped company and role — so it
// stops resolving the next day, which is the exact failure --report exists to
// prevent. A dropped --dry-run is worse than a wrong answer: it is a live
// navigation and a real file, from a run the user asked to be a preview.
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
import { fileURLToPath, pathToFileURL } from 'node:url';

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
// the transposition a user actually makes, not an obviously bogus token. The
// third element is the pattern its usage block prints, because not every CLI
// spells that header the same way.
const SCRIPTS = [
  ['rejection-latency.mjs', '--traker'],
  ['process-quality.mjs', '--fiel'],
  ['detect-reposts.mjs', '--windo'],
  ['weekly-digest.mjs', '--dri'],
  ['upskill.mjs', '--min-report'],
  ['archive-posting.mjs', '--reprot', /USAGE/],
];

for (const [script, typo, usage = /Usage:/i] of SCRIPTS) {
  test(`${script} rejects ${typo} instead of falling back to its default`, () => {
    const r = runScript(script, typo, 'some-value');
    assert.equal(r.status, 1, `${script} ${typo} exited ${r.status}, want 1`);
    assert.match(r.all, /unrecognized flag/i, `${script} did not name the unrecognized flag`);
    assert.match(r.all, new RegExp(typo.replace(/^--/, '--')), `${script} did not echo ${typo} back`);
  });

  test(`${script} --help exits 0 and prints usage`, () => {
    const r = runScript(script, '--help');
    assert.equal(r.status, 0, `${script} --help exited ${r.status}, want 0`);
    assert.match(r.all, usage, `${script} --help printed no usage block`);
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

// --- archive-posting: the value flag whose operand looks like a flag --------

// --report's operand must reach archive-posting's OWN validator, which says
// "positive report number" — listing --report in valueFlags is what stops the
// shared helper from reporting "-1" as an unrecognized flag and burying the
// real diagnosis. Exits before any navigation, so no browser is launched.
test('archive-posting --report -1 reaches its own value check', () => {
  const r = runScript('archive-posting.mjs', '--report', '-1', '--dry-run', 'https://example.com/j');
  assert.equal(r.status, 1);
  assert.match(r.all, /positive report number/);
  assert.doesNotMatch(r.all, /unrecognized flag/i);
});

// A known value flag followed by another flag has no operand. In particular,
// --company must not swallow --dry-run and turn a requested preview into a
// live archive.
test('archive-posting rejects --company followed by --dry-run', () => {
  const r = runScript(
    'archive-posting.mjs',
    '--company', '--dry-run', 'https://boards.greenhouse.io/openai/jobs/123',
  );
  assert.equal(r.status, 1);
  assert.match(r.all, /--company requires a value/);
  assert.doesNotMatch(r.all, /Archiving 1 posting/);
});

// Missing operands are usage errors even when --help follows; validation must
// report the malformed command before taking the help exit-0 path.
test('archive-posting rejects --report followed by --help', () => {
  const r = runScript('archive-posting.mjs', '--report', '--help');
  assert.equal(r.status, 1);
  assert.match(r.all, /--report requires a value/);
  assert.doesNotMatch(r.all, /career-ops — Job Posting Archiver/);
});

// The guard against a validator that passes by rejecting everything: the real
// vocabulary must still work, in both spellings.
test('archive-posting still accepts its real flags in both forms', () => {
  const url = 'https://boards.greenhouse.io/openai/jobs/123';
  for (const argv of [
    ['--company=Anthropic', '--role=Engineer', '--report=42', '--dry-run', url],
    ['--company', 'Anthropic', '--role', 'Engineer', '--report', '42', '--dry-run', url],
  ]) {
    const r = runScript('archive-posting.mjs', ...argv);
    assert.equal(r.status, 0, `rejected a valid flag set: ${r.all.slice(0, 200)}`);
    assert.doesNotMatch(r.all, /unrecognized flag/i);
  }
});

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

// archive-posting.mjs has no CLI importer to borrow, so the hazard is spelled
// out directly: test-all.mjs imports archiveUrl/installEgressGuard from it, and
// a top-level call would read test-all's own argv — `node test-all.mjs --quick`
// exiting 1 on a flag that is perfectly valid for test-all, the whole suite
// killed by an unrelated import. The two trailing args reproduce that argv
// shape, so process.argv.slice(2) sees '--quick' exactly as it would there.
test('importing archive-posting does not judge its importer\'s argv', () => {
  const target = JSON.stringify(pathToFileURL(join(ROOT, 'archive-posting.mjs')).href);
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${target}); console.log('IMPORT OK');`,
      '--', 'test-all.mjs', '--quick'],
    { cwd: ROOT, encoding: 'utf-8', timeout: 30_000 },
  );
  const all = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 0, `archive-posting rejected its importer's flags: ${all.slice(0, 200)}`);
  assert.match(all, /IMPORT OK/, 'the probe never completed the import');
});
