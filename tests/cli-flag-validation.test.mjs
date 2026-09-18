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
// HERMETIC: paths use tmpdir fixtures; nothing reads or writes the real data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  ['clean-markers.mjs', '--dryrun'],
];

for (const [script, typo] of SCRIPTS) {
  test(`${script} rejects ${typo} instead of falling back to its default`, () => {
    const r = runScript(script, typo, 'some-value');
    assert.equal(r.status, 1, `${script} ${typo} exited ${r.status}, want 1`);
    assert.match(r.all, /unrecognized flag/i, `${script} did not name the unrecognized flag`);
    assert.ok(r.all.includes(typo), `${script} did not echo ${typo} back`);
  });
}


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


test('clean-markers.mjs --help exits 0 and prints usage', () => {
  const r = runScript('clean-markers.mjs', '--help');
  assert.equal(r.status, 0, `clean-markers.mjs --help exited ${r.status}, want 0`);
  assert.match(r.all, /Usage:/i, 'clean-markers.mjs --help printed no usage block');
  assert.doesNotMatch(r.all, /not found/i, '--help was still read as a filename');
});

test('clean-markers.mjs -h exits 0 and prints usage', () => {
  const r = runScript('clean-markers.mjs', '-h');
  assert.equal(r.status, 0, `clean-markers.mjs -h exited ${r.status}, want 0`);
  assert.match(r.all, /Usage:/i, 'clean-markers.mjs -h printed no usage block');
});

test('clean-markers.mjs --help --bogus still errors', () => {
  const r = runScript('clean-markers.mjs', '--help', '--bogus');
  assert.equal(r.status, 1, `clean-markers.mjs --help --bogus exited ${r.status}, want 1`);
  assert.match(r.all, /unrecognized flag/i);
});

// Exit 2 means no files were given and exit 1 means a file failed the audit.
// A pre-send gate needs both codes to stay distinct.
test('clean-markers.mjs still exits 2 with usage when given no files', () => {
  const r = runScript('clean-markers.mjs');
  assert.equal(r.status, 2, `no-args exited ${r.status}, want 2`);
  assert.match(r.all, /Usage:/i);
});

test('clean-markers.mjs still accepts --ascii as a known flag', () => {
  const r = runScript('clean-markers.mjs', 'clean', '--ascii', join(tmpdir(), 'career-ops-no-such-file.md'));
  assert.doesNotMatch(r.all, /unrecognized flag/i, '--ascii must not be rejected as unrecognized');
});

// The argument has to start with a dash for this to test anything, so the child
// runs inside the fixture dir and gets the bare relative name. An absolute path
// would begin with a slash and never reach the flag check.
test('clean-markers.mjs audits a dash-leading path after --', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-clean-markers-'));
  try {
    writeFileSync(join(dir, '-draft.md'), 'plain text\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'clean-markers.mjs'), 'audit', '--', '-draft.md'], {
      cwd: dir, encoding: 'utf-8', timeout: 30_000,
    });
    const all = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 0, `dash-leading path exited ${r.status}, want 0`);
    assert.doesNotMatch(all, /unrecognized flag/i, '-draft.md must not be read as a flag after --');
    assert.match(all, /PASS/, 'the dash-leading path should have been audited');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clean-markers.mjs still rejects an unknown flag before --', () => {
  const r = runScript('clean-markers.mjs', 'audit', '--dryrun', '--', 'x.md');
  assert.equal(r.status, 1, `unknown flag before -- exited ${r.status}, want 1`);
  assert.match(r.all, /unrecognized flag\(s\): --dryrun/);
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
