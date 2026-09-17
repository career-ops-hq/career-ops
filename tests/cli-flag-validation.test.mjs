// tests/cli-flag-validation.test.mjs — CLIs must reject a mistyped flag
// instead of answering from their defaults (#2980).
//
// The failure class lib/cli-flags.mjs exists to end: an unrecognized flag is
// ignored, the value flag it was meant to be falls back to its default, and
// the script reports a result for inputs nobody asked for at exit 0. Already
// fixed in scan-ats-full.mjs (#1633/#1635), reply-watch.mjs (#2743/#2745),
// dedup-tracker.mjs (#2744/#2746), scan.mjs (#2270), doctor.mjs (#2874),
// fix-slugs.mjs (#2980), and application-artifacts.mjs (#2774).
//
// verify-portals.mjs (#4250) is the sharpest instance: it probes every tracked
// company, so a flag that fell through to the default sweep spent minutes on
// 100+ network requests while printing nothing. It was reported as a Windows
// module-load hang; it is neither Windows-specific nor a hang.
//
// HERMETIC: paths use tmpdir fixtures; nothing reads or writes the real data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

// Each script paired with a realistic typo of one of ITS OWN flags
const SCRIPTS = [
  ['fix-slugs.mjs', '--dryrun'],
  ['fix-slugs.mjs', '--fle'],
  ['linkedin-join.mjs', '--csvv'],
  ['linkedin-join.mjs', '--sinse'],
  ['application-artifacts.mjs', '--reprot'],
  ['verify-portals.mjs', '--stict'],
  ['verify-portals.mjs', '--flie'],
];

for (const [script, typo] of SCRIPTS) {
  test(`${script} rejects ${typo} instead of falling back to its default`, () => {
    const r = runScript(script, typo, 'some-value');
    assert.equal(r.status, 1, `${script} ${typo} exited ${r.status}, want 1`);
    assert.match(r.all, /unrecognized flag/i, `${script} did not name the unrecognized flag`);
    assert.ok(r.all.includes(typo), `${script} did not echo ${typo} back`);
  });
}


// The reported symptom (#4250): with no --help handler the flag fell through to
// the live sweep, so this exited only when 100+ probes finished — or never. The
// harness's own 30s timeout is what makes that a failure rather than a slow pass.
for (const flag of ['--help', '-h']) {
  test(`verify-portals.mjs ${flag} prints usage without touching the network`, () => {
    const r = runScript('verify-portals.mjs', flag);
    assert.equal(r.status, 0, `verify-portals.mjs ${flag} exited ${r.status}, want 0`);
    assert.match(r.all, /Usage:/, `verify-portals.mjs ${flag} printed no usage block`);
    assert.match(r.all, /--add/, 'usage should list the flags the script accepts');
    // the sweep's summary line ("138 live, 2 live-but-empty, …"); the usage text
    // legitimately contains the words "live" and "unresolved" on its own
    assert.doesNotMatch(r.all, /\d+ live,/, 'usage must not be a sweep result');
  });
}

// indexOf() cannot see `--flag=value`, so this form silently dropped the value
// and swept the DEFAULT portals.yml instead of the file the caller named.
test('verify-portals.mjs --file=<path> is honoured, not silently discarded', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'co-vp-')), 'nope.yml');
  const r = runScript('verify-portals.mjs', `--file=${missing}`);
  assert.equal(r.status, 0, `exited ${r.status}, want 0`);
  assert.ok(r.all.includes(missing), `did not use the path it was given: ${r.all.trim().slice(0, 200)}`);
});

test('fix-slugs.mjs --help exits 0 and prints usage', () => {
  const r = runScript('fix-slugs.mjs', '--help');
  assert.equal(r.status, 0, `fix-slugs.mjs --help exited ${r.status}, want 0`);
  assert.match(r.all, /Usage:/i, 'fix-slugs.mjs --help printed no usage block');
});

test('fix-slugs.mjs -h exits 0 and prints usage', () => {
  const r = runScript('fix-slugs.mjs', '-h');
  assert.equal(r.status, 0, `fix-slugs.mjs -h exited ${r.status}, want 0`);
  assert.match(r.all, /Usage:/i, 'fix-slugs.mjs -h printed no usage block');
});

test('fix-slugs.mjs --help --bogus still errors', () => {
  const r = runScript('fix-slugs.mjs', '--help', '--bogus');
  assert.equal(r.status, 1, `fix-slugs.mjs --help --bogus exited ${r.status}, want 1`);
  assert.match(r.all, /unrecognized flag/i);
});


test('application-artifacts.mjs --help exits 0 and prints usage', () => {
  const r = runScript('application-artifacts.mjs', '--help');
  assert.equal(r.status, 0, `application-artifacts.mjs --help exited ${r.status}, want 0`);
  assert.match(r.all, /Usage:/i, 'application-artifacts.mjs --help printed no usage block');
});

test('application-artifacts.mjs -h exits 0 and prints usage', () => {
  const r = runScript('application-artifacts.mjs', '-h');
  assert.equal(r.status, 0, `application-artifacts.mjs -h exited ${r.status}, want 0`);
  assert.match(r.all, /Usage:/i, 'application-artifacts.mjs -h printed no usage block');
});

test('application-artifacts.mjs --help --bogus still errors', () => {
  const r = runScript('application-artifacts.mjs', '--help', '--bogus');
  assert.equal(r.status, 1, `application-artifacts.mjs --help --bogus exited ${r.status}, want 1`);
  assert.match(r.all, /unrecognized flag/i);
});

// --help must not reach the required-argument check: before #2774 the flag was
// swallowed by parseArgs's strict mode and reported as an unknown option.
test('application-artifacts.mjs --help wins over the missing-required-args error', () => {
  const r = runScript('application-artifacts.mjs', '--help');
  assert.doesNotMatch(r.all, /Unknown option/i, '--help was still treated as an unrecognized option');
});

test('fix-slugs rejects unknown flags before checking or reading portals file', () => {
  const r = runScript('fix-slugs.mjs', '--file', join(tmpdir(), 'non-existent-portals.yml'), '--unknown-flag');
  assert.equal(r.status, 1);
  assert.match(r.all, /unrecognized flag\(s\): --unknown-flag/);
  assert.doesNotMatch(r.all, /no portals file at/i);
});

test('fix-slugs honours both --file <path> and --file=<path> syntax', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-fixslugs-flag-'));
  try {
    const customPortals = join(dir, 'custom.yml');
    // Non-existent custom path should be reported when flags are valid
    const r1 = runScript('fix-slugs.mjs', '--file', customPortals);
    assert.match(r1.all, new RegExp(`no portals file at ${customPortals.replace(/\\/g, '\\\\')}`));

    const r2 = runScript('fix-slugs.mjs', `--file=${customPortals}`);
    assert.match(r2.all, new RegExp(`no portals file at ${customPortals.replace(/\\/g, '\\\\')}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix-slugs rejects missing --file values (bare, empty, or next-is-flag)', () => {
  const rBare = runScript('fix-slugs.mjs', '--file');
  assert.equal(rBare.status, 1, 'bare --file must exit 1');
  assert.match(rBare.all, /--file requires a value/);

  const rEmpty = runScript('fix-slugs.mjs', '--file=');
  assert.equal(rEmpty.status, 1, '--file= must exit 1');
  assert.match(rEmpty.all, /--file requires a value/);

  const rFlag = runScript('fix-slugs.mjs', '--file', '--fix');
  assert.equal(rFlag.status, 1, '--file --fix must exit 1 without treating --fix as a filename');
  assert.match(rFlag.all, /--file requires a value/);

  const rApply = runScript('fix-slugs.mjs', '--file', '--apply');
  assert.equal(rApply.status, 1, '--file --apply must exit 1');
  assert.match(rApply.all, /--file requires a value/);

  const rDryRun = runScript('fix-slugs.mjs', '--file', '--dry-run');
  assert.equal(rDryRun.status, 1, '--file --dry-run must exit 1');
  assert.match(rDryRun.all, /--file requires a value/);

  const rShortFlag = runScript('fix-slugs.mjs', '--file', '-h');
  assert.equal(rShortFlag.status, 1, '--file -h must exit 1 without treating -h as a filename');
  assert.match(rShortFlag.all, /--file requires a value/);
  assert.doesNotMatch(rShortFlag.all, /no portals file at/i);

  const rShortFlagEq = runScript('fix-slugs.mjs', '--file=-h');
  assert.equal(rShortFlagEq.status, 1, '--file=-h must exit 1 without treating -h as a filename');
  assert.match(rShortFlagEq.all, /--file requires a value/);
  assert.doesNotMatch(rShortFlagEq.all, /no portals file at/i);
});

// --- missing operand for a RECOGNIZED value-taking flag (#3087) ------------
//
// A different defect than an unrecognized flag: the flag is spelled right,
// but nothing (or another flag) follows it, so flagValue()/indexOf() reads
// the wrong thing as the value and the script proceeds on it silently at
// exit 0 — doctor.mjs diagnosing a directory literally named "--json" is the
// sharpest case. validateFlags's `requireOperand` option closes this for
// callers that opt in; each case below fails inside validateFlags itself,
// before any data/ access, so — like the --today/--summary case above — no
// fixture is needed.

test('doctor: --target --json does not diagnose a directory named "--json"', () => {
  const r = runScript('doctor.mjs', '--target', '--json');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--target requires a value/);
});

test('detect-reposts: --window --summary does not silently fall back to the default window', () => {
  const r = runScript('detect-reposts.mjs', '--window', '--summary');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--window requires a value/);
});

test('process-quality: --file --min-threshold does not read --min-threshold as a path', () => {
  const r = runScript('process-quality.mjs', '--file', '--min-threshold');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--file requires a value/);
});

test('process-quality: --min-threshold --summary does not silently fall back to threshold 1', () => {
  const r = runScript('process-quality.mjs', '--min-threshold', '--summary');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--min-threshold requires a value/);
});

test('weekly-digest: --dir --summary does not scan a directory named "--summary"', () => {
  const r = runScript('weekly-digest.mjs', '--dir', '--summary');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--dir requires a value/);
});

// archive-posting.mjs hand-rolls its own argv loop rather than going through
// validateFlags, so its --company/--role handling needed its own adjacency
// check (the same class of bug through a different door — see archive-posting.mjs).
test('archive-posting: --company --pipeline does not set the company slug to "--pipeline"', () => {
  const r = runScript('archive-posting.mjs', 'https://example.com/job', '--company', '--pipeline');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--company requires a value/);
});

test('archive-posting: --role --dry-run does not set the role slug to "--dry-run"', () => {
  const r = runScript('archive-posting.mjs', 'https://example.com/job', '--role', '--dry-run');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--role requires a value/);
});

// application-artifacts.mjs opts in rather than carrying its own guard, so
// every one of its value flags relies on requireOperand. `--report --help` is
// the shape that matters: without the option it printed usage at exit 0 and
// the malformed flag was never named.
test('application-artifacts.mjs rejects a value flag with no operand', () => {
  for (const flag of ['--report', '--company', '--role', '--version', '--root']) {
    const r = runScript('application-artifacts.mjs', flag);
    assert.equal(r.status, 1, `bare ${flag} exited ${r.status}, want 1`);
    assert.ok(r.all.includes(`${flag} requires a value`), `bare ${flag} was not reported`);
  }
});

test('application-artifacts: --report --help does not print usage at exit 0', () => {
  const r = runScript('application-artifacts.mjs', '--report', '--help');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--report requires a value/);
});

test('application-artifacts: --report --company does not read "--company" as the value', () => {
  const r = runScript('application-artifacts.mjs', '--report', '--company', 'Acme');
  assert.equal(r.status, 1, `want exit 1, got ${r.status}`);
  assert.match(r.all, /--report requires a value/);
});

// linkedin-join.mjs hand-rolled its argv before #3200 review, so `--csv=<path>`
// was discarded and the tool read the default export instead: a plausible
// report about a file nobody asked for, exit 0. The `=` form is the case a
// typo-only table would not catch.
test('linkedin-join.mjs honours the --flag=value form', () => {
  const r = runScript('linkedin-join.mjs', '--csv=/nonexistent/probe.csv', '--summary');
  assert.equal(r.status, 1, `exited ${r.status}, want 1`);
  assert.ok(r.all.includes('/nonexistent/probe.csv'),
    'the supplied path was discarded — the script fell back to its default export');
});

test('linkedin-join.mjs rejects a value flag with no operand', () => {
  const r = runScript('linkedin-join.mjs', '--csv', '--summary');
  assert.equal(r.status, 1, `exited ${r.status}, want 1`);
  assert.match(r.all, /--csv requires a value/i);
});

test('linkedin-join.mjs --help exits 0 and prints usage', () => {
  const r = runScript('linkedin-join.mjs', '--help');
  assert.equal(r.status, 0, `--help exited ${r.status}, want 0`);
  assert.match(r.all, /Usage:/i);
});

test('linkedin-join.mjs --help --bogus still errors', () => {
  const r = runScript('linkedin-join.mjs', '--help', '--bogus');
  assert.equal(r.status, 1, `--help --bogus exited ${r.status}, want 1`);
  assert.match(r.all, /unrecognized flag/i);
});
