// tests/relocation-purchasing-power.test.mjs — #4694, jurisdiction-compliance-lens
// umbrella #2026: relocation purchasing-power comparison in salary-gap.mjs.
//
// Two integration paths, both exercised against the REAL CLI binary (not just
// the pure functions, which already have inline coverage in salary-gap.mjs's
// own --self-test):
//
//   1. Ad hoc mode (`--relocation --gross ... --posting-location ...`) — what
//      modes/oferta.md Signal 17 calls during a FRESH evaluation, before
//      anything is written to reports/ or the tracker.
//   2. The folded, per-application `relocation` field on the default/--summary
//      output — computed from a tracker row + a report's own
//      `posting_location` Machine Summary field, against a temp data root so
//      the real repo's own tracker/reports are never touched.
//
// All company/role/location fixtures here are fictional. The tax BRACKET
// NUMBERS come from the real shipped templates/jurisdiction-relocation-tax.yml
// (public CRA/provincial rates, not personal data) — using the real table is
// the point of an integration test for this feature.
//
// Run: node --test tests/relocation-purchasing-power.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'salary-gap.mjs');
const readFile = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return r;
}

test('ad hoc --relocation mode reproduces the #4694 motivating example (Halifax NS vs Midland ON)', () => {
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location', 'Halifax, NS',
    '--home-location', 'Midland, ON',
    '--currency', 'CAD',
  ]);
  assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true, `expected ok:true, got ${JSON.stringify(out)}`);
  assert.equal(out.inputs.homeCode, 'CA-ON');
  assert.equal(out.inputs.destCode, 'CA-NS');
  assert.equal(out.home.jurisdiction, 'Ontario, Canada');
  assert.equal(out.dest.jurisdiction, 'Nova Scotia, Canada');
  // NS's brackets bite harder than ON's at this income, so relocating there
  // keeps strictly less take-home at the same $60k gross.
  assert.ok(out.dest.takeHome < out.home.takeHome,
    `NS take-home (${out.dest.takeHome}) should be less than ON take-home (${out.home.takeHome})`);
  assert.ok(out.takeHomeDeltaAbs < 0, 'destination delta is negative (NS keeps less)');
  assert.match(out.limitations, /Not financial or tax advice/);
  // Every input is echoed back — transparent, not an opaque single number.
  assert.equal(out.inputs.grossAnnual, 60000);
  assert.equal(out.inputs.homeLocation, 'Midland, ON');
  assert.equal(out.inputs.postingLocation, 'Halifax, NS');
});

// ── CodeRabbit finding #3 (#4696): the --currency flag must actually be
//    checked against the table's own currency, not just echoed back. ──

test('ad hoc --relocation mode refuses a USD gross figure against the CAD table (currency-mismatch, not a silently-wrong number)', () => {
  const r = run([
    '--relocation', '--gross', '150000',
    '--posting-location', 'Halifax, NS',
    '--home-location', 'Midland, ON',
    '--currency', 'USD',
  ]);
  assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false, `expected ok:false for a USD gross against a CAD table, got ${JSON.stringify(out)}`);
  assert.equal(out.reason, 'currency-mismatch');
  assert.equal(out.home, undefined, 'no take-home figure is computed on a currency mismatch');
  assert.equal(out.dest, undefined, 'no take-home figure is computed on a currency mismatch');
});

test('ad hoc --relocation mode refuses an UNKNOWN currency against the CAD table', () => {
  const r = run([
    '--relocation', '--gross', '150000',
    '--posting-location', 'Halifax, NS',
    '--home-location', 'Midland, ON',
    '--currency', 'UNKNOWN',
  ]);
  assert.equal(r.status, 0, describeSpawn(r));
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'currency-mismatch');
});

test('ad hoc --relocation mode with --currency omitted entirely is treated as UNKNOWN, never assumed to match', () => {
  const r = run([
    '--relocation', '--gross', '150000',
    '--posting-location', 'Halifax, NS',
    '--home-location', 'Midland, ON',
  ]);
  assert.equal(r.status, 0, describeSpawn(r));
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false, `omitting --currency must not silently compute a CAD take-home, got ${JSON.stringify(out)}`);
  assert.equal(out.reason, 'currency-mismatch');
});

// ── CodeRabbit finding #2 (#4696): matchJurisdiction false positives. The
//    pure-function cases (word-boundary, case-sensitive abbreviations, and
//    the foreign-context city-name disambiguation) are covered exhaustively
//    in salary-gap.mjs's own --self-test; this is one end-to-end check that
//    the fix is actually wired into the ad hoc CLI path, not just the
//    exported function. ──

test('ad hoc --relocation mode: a same-named foreign city (Surrey, UK) never false-matches a Canadian jurisdiction', () => {
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location', 'Surrey, UK',
    '--home-location', 'Midland, ON',
    '--currency', 'CAD',
  ]);
  assert.equal(r.status, 0, describeSpawn(r));
  const out = JSON.parse(r.stdout);
  assert.equal(out.inputs.destCode, null, 'Surrey, UK must not resolve to CA-BC');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-jurisdiction-match');
});

test('ad hoc --relocation mode with no resolvable jurisdiction reports a reason, not a guess', () => {
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location', 'Somewhere Unrecognized',
    '--home-location', 'Also Unrecognized',
  ]);
  assert.equal(r.status, 0, describeSpawn(r));
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-jurisdiction-match');
});

test('ad hoc --relocation mode requires --gross and --posting-location (usage error, not a silent default)', () => {
  const r = run(['--relocation', '--posting-location', 'Halifax, NS']);
  assert.ok(exitedNonZero(r), describeSpawn(r, 'missing --gross must fail, not silently proceed'));
  assert.match(r.stderr, /Usage: node salary-gap\.mjs --relocation/);
});

// ── #4696 CodeRabbit CWE-78 finding: --posting-location-file reads the
//    JD-controlled location from a file instead of a shell argument, so a
//    crafted location containing shell metacharacters is never given to a
//    shell to interpret. These tests use spawnSync's array-argv form (which
//    never invokes a shell either way), so they prove the FEATURE works —
//    that the file's literal content reaches matchJurisdiction byte-for-byte,
//    including characters that would be dangerous if shell-interpolated —
//    not the shell-safety property itself, which is a property of the
//    prompt-spec instructions in modes/oferta.md and batch/batch-prompt.md
//    (covered by the dedicated tests below) rather than of this script. ──

function withTempFile(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-posting-location-'));
  const file = join(dir, 'posting-location.txt');
  writeFileSync(file, content);
  try {
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('ad hoc --relocation mode: --posting-location-file resolves the same jurisdiction as --posting-location with the same text', () => {
  withTempFile('Halifax, NS', (file) => {
    const r = run([
      '--relocation', '--gross', '60000',
      '--posting-location-file', file,
      '--home-location', 'Midland, ON',
      '--currency', 'CAD',
    ]);
    assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
    const out = JSON.parse(r.stdout);
    assert.equal(out.inputs.destCode, 'CA-NS');
    assert.equal(out.inputs.postingLocation, 'Halifax, NS', 'trailing newline from the file is trimmed');
    assert.equal(out.ok, true);
  });
});

test('ad hoc --relocation mode: --posting-location-file content containing shell metacharacters reaches the script as literal text, never shell-expanded', () => {
  withTempFile('Halifax, NS $(touch should-not-exist.txt)', (file) => {
    const r = run([
      '--relocation', '--gross', '60000',
      '--posting-location-file', file,
      '--home-location', 'Midland, ON',
      '--currency', 'CAD',
    ]);
    assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
    const out = JSON.parse(r.stdout);
    assert.equal(out.inputs.postingLocation, 'Halifax, NS $(touch should-not-exist.txt)',
      'the command-substitution-shaped text is passed through literally, not executed and not stripped');
    assert.equal(out.inputs.destCode, 'CA-NS', 'the alias still resolves despite the trailing junk text');
  });
});

test('ad hoc --relocation mode: --posting-location-b64 resolves the same jurisdiction as --posting-location with the same text', () => {
  const b64 = Buffer.from('Halifax, NS', 'utf8').toString('base64');
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location-b64', b64,
    '--home-location', 'Midland, ON',
    '--currency', 'CAD',
  ]);
  assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
  const out = JSON.parse(r.stdout);
  assert.equal(out.inputs.postingLocation, 'Halifax, NS');
  assert.equal(out.inputs.destCode, 'CA-NS');
  assert.equal(out.ok, true);
});

test('ad hoc --relocation mode: a base64 location containing shell metacharacters reaches the script as literal text', () => {
  const text = 'Halifax, NS $(touch should-not-exist.txt)';
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location-b64', Buffer.from(text, 'utf8').toString('base64'),
    '--home-location', 'Midland, ON',
    '--currency', 'CAD',
  ]);
  assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
  const out = JSON.parse(r.stdout);
  assert.equal(out.inputs.postingLocation, text,
    'the decoded text is passed through literally, never shell-expanded and never stripped');
  assert.equal(out.inputs.destCode, 'CA-NS', 'the alias still resolves despite the trailing junk text');
});

test('ad hoc --relocation mode: --posting-location-file still wins over --posting-location-b64 when both are given', () => {
  withTempFile('Halifax, NS', (file) => {
    const r = run([
      '--relocation', '--gross', '60000',
      '--posting-location-b64', Buffer.from('Vancouver, BC', 'utf8').toString('base64'),
      '--posting-location-file', file,
      '--home-location', 'Midland, ON',
      '--currency', 'CAD',
    ]);
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.equal(out.inputs.postingLocation, 'Halifax, NS', 'the file form stays the highest-precedence safe path');
  });
});

test('ad hoc --relocation mode: a malformed --posting-location-b64 is a usage error, not a silent fallback', () => {
  const cases = [
    ['not base64!', /Invalid --posting-location-b64: not base64/],
    // URL-safe alphabet (`-`/`_`) is not what the flag documents; reject rather
    // than rely on Buffer.from's leniency. `Pz8/` is valid base64 for `???`;
    // its URL-safe spelling replaces the slash with an underscore.
    ['Pz8_', /Invalid --posting-location-b64/],
    // Padding to a multiple of 4 is required.
    ['SGFsaWZheCwgTlM', /Invalid --posting-location-b64/],
  ];
  for (const [value, pattern] of cases) {
    const r = run([
      '--relocation', '--gross', '60000',
      '--posting-location-b64', value,
      '--home-location', 'Midland, ON',
      '--currency', 'CAD',
    ]);
    assert.ok(exitedNonZero(r), describeSpawn(r, `expected a non-zero exit for ${value}`));
    assert.match(r.stderr, pattern);
  }
});

test('ad hoc --relocation mode: a trailing --posting-location-b64 with no operand is a usage error naming the missing operand', () => {
  const r = run([
    '--relocation', '--gross', '60000',
    '--home-location', 'Midland, ON',
    '--currency', 'CAD',
    '--posting-location-b64',
  ]);
  assert.ok(exitedNonZero(r), describeSpawn(r, 'a missing operand must not silently succeed'));
  assert.match(r.stderr, /--posting-location-b64 requires a base64 operand/);
});

test('ad hoc --relocation mode: --posting-location-file takes precedence over --posting-location when both are given', () => {
  withTempFile('Halifax, NS', (file) => {
    const r = run([
      '--relocation', '--gross', '60000',
      '--posting-location', 'Vancouver, BC',
      '--posting-location-file', file,
      '--home-location', 'Midland, ON',
      '--currency', 'CAD',
    ]);
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.equal(out.inputs.postingLocation, 'Halifax, NS', 'the file form wins — it is the safe path, not a value a caller meant to replace');
  });
});

test('ad hoc --relocation mode: an unreadable --posting-location-file is a usage error, not a silent fallback', () => {
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location-file', join(tmpdir(), 'career-ops-does-not-exist-4696.txt'),
    '--home-location', 'Midland, ON',
    '--currency', 'CAD',
  ]);
  assert.ok(exitedNonZero(r), describeSpawn(r, 'expected a non-zero exit'));
  assert.match(r.stderr, /Could not read --posting-location-file/);
});

// ── #4696 CodeRabbit follow-up finding: flagValue() alone cannot distinguish
//    "flag absent" from "flag present but given a missing/invalid operand" —
//    both read as `null` once collapsed. A trailing --posting-location-file
//    with nothing after it must not silently fall back to --posting-location
//    (or a generic usage error that never mentions the missing operand), and
//    --posting-location-file --home-location "X" must not silently consume
//    --home-location as the file path and then fail with a confusing
//    "Could not read" error about a flag name instead of a path. ──

test('ad hoc --relocation mode: a trailing --posting-location-file with no operand is a usage error naming the missing operand, not a silent fallback', () => {
  const r = run([
    '--relocation', '--gross', '60000',
    '--home-location', 'Midland, ON',
    '--currency', 'CAD',
    '--posting-location-file',
  ]);
  assert.ok(exitedNonZero(r), describeSpawn(r, 'a missing operand must not silently succeed'));
  assert.match(r.stderr, /--posting-location-file requires a file path operand/);
  assert.doesNotMatch(r.stderr, /Could not read --posting-location-file/,
    'a missing operand is a distinct usage error, not a failed file read');
});

test('ad hoc --relocation mode: --posting-location-file followed by another flag never consumes that flag as the file path', () => {
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location-file', '--home-location', 'Midland, ON',
    '--currency', 'CAD',
  ]);
  assert.ok(exitedNonZero(r), describeSpawn(r, 'an operand that looks like another flag must not be read as a path'));
  assert.match(r.stderr, /--posting-location-file requires a file path operand/);
  assert.doesNotMatch(r.stderr, /Could not read --posting-location-file '--home-location'/,
    'must reject before ever attempting to read "--home-location" as a file');
});

test('ad hoc --relocation mode: --posting-location-file= with an empty operand is a usage error, not a silent empty location', () => {
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location-file=',
    '--home-location', 'Midland, ON',
    '--currency', 'CAD',
  ]);
  assert.ok(exitedNonZero(r), describeSpawn(r, 'expected a non-zero exit'));
  assert.match(r.stderr, /--posting-location-file requires a file path operand/);
});

// ── #4696 CodeRabbit finding #2 (follow-up round): matchJurisdiction must
//    not fall back to a weak city-alias match when the text names an
//    unseeded Canadian province/territory. One end-to-end check that the
//    fix (templates/jurisdiction-relocation-tax.yml-independent blocking
//    markers) is wired into the ad hoc CLI path; the exhaustive pure-function
//    cases live in salary-gap.mjs's own --self-test. ──

test('ad hoc --relocation mode: "Hamilton, Quebec" never false-matches CA-ON (unseeded province blocks the weak city alias)', () => {
  withTempFile('Hamilton, Quebec', (file) => {
    const r = run([
      '--relocation', '--gross', '60000',
      '--posting-location-file', file,
      '--home-location', 'Toronto, ON',
      '--currency', 'CAD',
    ]);
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.equal(out.inputs.destCode, null, '"Hamilton, Quebec" must not resolve to CA-ON');
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'no-jurisdiction-match');
  });
});

test('ad hoc --relocation mode: "Hamilton, QC" never false-matches CA-ON either', () => {
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location', 'Hamilton, QC',
    '--home-location', 'Toronto, ON',
    '--currency', 'CAD',
  ]);
  assert.equal(r.status, 0, describeSpawn(r));
  const out = JSON.parse(r.stdout);
  assert.equal(out.inputs.destCode, null, '"Hamilton, QC" must not resolve to CA-ON');
  assert.equal(out.ok, false);
});

// ── Prompt-spec wiring: both files must instruct the safe (base64) form for the
//    JD-controlled posting location, never the raw shell-argument form that
//    motivated the CWE-78 finding. ──

test('modes/oferta.md Signal 17 passes the JD location as base64, never --posting-location "<JD', () => {
  const oferta = readFile('modes/oferta.md') + readFile('modes/oferta-signals/17-relocation-purchasing-power.md');
  assert.match(oferta, /--posting-location-b64/, 'Signal 17 uses the base64 flag');
  assert.doesNotMatch(oferta, /--posting-location "<JD/, 'the JD-controlled value is never shell-interpolated directly');
});

test('batch/batch-prompt.md Signal 17 passes the JD location as base64, never --posting-location "<JD', () => {
  const batchPrompt = readFile('batch/batch-prompt.md');
  assert.match(batchPrompt, /--posting-location-b64/, 'Signal 17 uses the base64 flag');
  assert.doesNotMatch(batchPrompt, /--posting-location "<JD/, 'the JD-controlled value is never shell-interpolated directly');
});

test('both Signal 17 prompts annualize only explicit, sufficiently specified compensation periods', () => {
  for (const path of ['modes/oferta-signals/17-relocation-purchasing-power.md', 'batch/batch-prompt.md']) {
    const prompt = readFile(path);
    assert.match(prompt, /monthly[\s\S]{0,80}`midpoint × 12`/, `${path} documents monthly-to-annual conversion`);
    assert.match(prompt, /hourly[\s\S]{0,220}(?:JD states weekly hours|JD's stated weekly hours)/, `${path} requires JD-stated weekly hours for hourly annualization`);
    assert.match(prompt, /`midpoint × (?:the JD's stated|stated) weekly hours × 52`/, `${path} documents hourly-to-annual conversion`);
    assert.match(prompt, /never assume a 40-hour week or a 2,080-hour year/, `${path} forbids guessing hourly work schedules`);
    assert.match(prompt, /missing\/ambiguous period[\s\S]{0,100}(?:not evaluated|annual gross is unknown)/, `${path} skips compensation with an unclear period`);
  }
});

// ── #4696 CodeRabbit follow-up finding (second round): a single-quoted
//    heredoc with a FIXED delimiter is still exploitable — a JD location
//    containing a line identical to the delimiter closes the heredoc early
//    and the rest of the "location" text is executed as shell commands,
//    under --dangerously-skip-permissions in batch workers. The fix replaces
//    the heredoc with base64 encoding (only the base64 alphabet, which has no
//    shell-special characters, ever reaches a shell command line). These
//    tests lock that fix in so it cannot silently regress back to a heredoc
//    in either prompt file. ──

test('modes/oferta.md Signal 17 no longer uses a heredoc to write the JD location (heredoc delimiter collision, CWE-78 round 2)', () => {
  const oferta = readFile('modes/oferta.md') + readFile('modes/oferta-signals/17-relocation-purchasing-power.md');
  assert.doesNotMatch(oferta, /<<'?JD_LOCATION_EOF'?/, 'the fixed-delimiter heredoc must be gone, not just renamed');
  assert.doesNotMatch(oferta, /cat <<'/, 'no heredoc of any delimiter name should remain for the posting location');
});

test('batch/batch-prompt.md Signal 17 no longer uses a heredoc to write the JD location (heredoc delimiter collision, CWE-78 round 2)', () => {
  const batchPrompt = readFile('batch/batch-prompt.md');
  assert.doesNotMatch(batchPrompt, /<<'?JD_LOCATION_EOF'?/, 'the fixed-delimiter heredoc must be gone, not just renamed');
  assert.doesNotMatch(batchPrompt, /cat <<'/, 'no heredoc of any delimiter name should remain for the posting location');
});

test('modes/oferta.md Signal 17 passes the location as --posting-location-b64, never as a shell-transformed value', () => {
  const oferta = readFile('modes/oferta.md') + readFile('modes/oferta-signals/17-relocation-purchasing-power.md');
  assert.match(oferta, /--posting-location-b64/, 'the documented command uses the base64 argument');
  assert.doesNotMatch(oferta, /node -e .*Buffer\.from/, 'no shell-side decode step');
  assert.doesNotMatch(oferta, /mktemp/, 'no temp file for the location');
});

test('batch/batch-prompt.md Signal 17 passes the location as --posting-location-b64, never as a shell-transformed value', () => {
  const batchPrompt = readFile('batch/batch-prompt.md');
  assert.match(batchPrompt, /--posting-location-b64/, 'the documented command uses the base64 argument');
  assert.doesNotMatch(batchPrompt, /node -e .*Buffer\.from/, 'no shell-side decode step');
  assert.doesNotMatch(batchPrompt, /mktemp/, 'no temp file for the location');
});

test('a base64 location round-trips a non-ASCII city byte-for-byte through the CLI', () => {
  // The prompt asks the agent to compute the base64 itself; the script decodes
  // it. Multi-byte UTF-8 (accented city names, em dashes) has to survive the
  // round trip unmangled or the tax table is matched against a corrupted place.
  const rawLocation = 'Montréal, QC — île de Zürich café';
  const b64 = Buffer.from(rawLocation, 'utf-8').toString('base64');
  assert.doesNotMatch(b64, /[^A-Za-z0-9+/=]/, 'a correct base64 string contains only the base64 alphabet');

  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location-b64', b64,
    '--home-location', 'Toronto, ON',
    '--currency', 'CAD',
  ]);
  assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
  const out = JSON.parse(r.stdout);
  assert.equal(out.inputs.postingLocation, rawLocation, 'UTF-8 multi-byte characters must survive the round trip unmangled');
});

test('text shaped like the old heredoc-collision payload stays literal data under --posting-location-b64', () => {
  // No shell parses the decoded text and no file is written from it, so the
  // delimiter-shaped payload is just a (non-matching) location string.
  const rawLocation = 'JD_LOCATION_EOF\ntouch /tmp/career-ops-should-not-exist-4696\nJD_LOCATION_EOF';
  const r = run([
    '--relocation', '--gross', '60000',
    '--posting-location-b64', Buffer.from(rawLocation, 'utf-8').toString('base64'),
    '--home-location', 'Toronto, ON',
    '--currency', 'CAD',
  ]);
  assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
  const out = JSON.parse(r.stdout);
  assert.equal(out.inputs.postingLocation, rawLocation, 'the old-delimiter-shaped text is decoded as ordinary data');
});

// ── End-to-end: tracker row + report posting_location -> folded relocation field ──

function fixtureDataRoot(advertisedComp = '60k CAD per year') {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-relocation-'));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(join(dataRoot, 'reports'), { recursive: true });
  mkdirSync(join(dataRoot, 'config'), { recursive: true });

  // Fictional candidate, fictional company — only the province/city names and
  // tax brackets are real (public jurisdiction data, not personal data).
  writeFileSync(join(dataRoot, 'config', 'profile.yml'), [
    'candidate:',
    '  full_name: "Fictional Candidate"',
    '  email: "fictional.candidate@example.com"',
    '  location: "Toronto, ON"',
    '',
  ].join('\n'));

  writeFileSync(join(dataRoot, 'reports', '050-widgetco-2026-09-01.md'), [
    '# Evaluation: WidgetCo — Backend Engineer',
    '',
    '## Machine Summary',
    '',
    '```yaml',
    'company: "WidgetCo"',
    'role: "Backend Engineer"',
    `advertised_comp: "${advertisedComp}"`,
    'posting_location: "Halifax, NS"',
    '```',
    '',
  ].join('\n'));

  writeFileSync(join(dataRoot, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-09-01 | WidgetCo | Backend Engineer | 4.0/5 | Applied | ❌ | [50](reports/050-widgetco-2026-09-01.md) | relocation role |',
    '',
  ].join('\n'));

  return dataRoot;
}

test('folded output annotates the application with a relocation comparison from the report\'s posting_location + the profile\'s home location', () => {
  const dataRoot = fixtureDataRoot();
  try {
    const r = run([], { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' });
    assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
    const out = JSON.parse(r.stdout);
    const app = out.applications.find((a) => a.company === 'WidgetCo');
    assert.ok(app, `WidgetCo application not found in ${JSON.stringify(out.applications)}`);
    assert.equal(app.postingLocation, 'Halifax, NS');
    assert.ok(app.relocation?.ok, `expected a resolved relocation comparison, got ${JSON.stringify(app.relocation)}`);
    assert.equal(app.relocation.home.jurisdiction, 'Ontario, Canada');
    assert.equal(app.relocation.dest.jurisdiction, 'Nova Scotia, Canada');
    assert.ok(app.relocation.dest.takeHome < app.relocation.home.takeHome);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a re-evaluated application pairs the selected advertised compensation with that same report\'s posting_location', () => {
  const dataRoot = fixtureDataRoot();
  try {
    writeFileSync(join(dataRoot, 'reports', '051-widgetco-2026-09-15.md'), [
      '# Evaluation: WidgetCo — Backend Engineer',
      '',
      '## Machine Summary',
      '',
      '```yaml',
      'company: "WidgetCo"',
      'role: "Backend Engineer"',
      'advertised_comp: "90k CAD per year"',
      'posting_location: "Vancouver, BC"',
      '```',
      '',
    ].join('\n'));
    writeFileSync(join(dataRoot, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-09-15 | WidgetCo | Backend Engineer | 4.0/5 | Applied | ❌ | [50](reports/050-widgetco-2026-09-01.md) [51](reports/051-widgetco-2026-09-15.md) | re-evaluated role |',
      '',
    ].join('\n'));

    const r = run([], { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' });
    assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
    const app = JSON.parse(r.stdout).applications.find((a) => a.company === 'WidgetCo');
    assert.ok(app);
    assert.equal(app.advertised.raw, '90k CAD per year');
    assert.equal(app.advertised.postingLocation, 'Vancouver, BC');
    assert.equal(app.relocation.dest.jurisdiction, 'British Columbia, Canada');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a later advertised compensation without posting_location is never paired with an earlier report\'s destination', () => {
  const dataRoot = fixtureDataRoot();
  try {
    writeFileSync(join(dataRoot, 'reports', '051-widgetco-2026-09-15.md'), [
      '# Evaluation: WidgetCo — Backend Engineer',
      '',
      '## Machine Summary',
      '',
      '```yaml',
      'company: "WidgetCo"',
      'role: "Backend Engineer"',
      'advertised_comp: "90k CAD per year"',
      '```',
      '',
    ].join('\n'));
    writeFileSync(join(dataRoot, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-09-15 | WidgetCo | Backend Engineer | 4.0/5 | Applied | ❌ | [50](reports/050-widgetco-2026-09-01.md) [51](reports/051-widgetco-2026-09-15.md) | re-evaluated role |',
      '',
    ].join('\n'));

    const r = run([], { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' });
    assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
    const app = JSON.parse(r.stdout).applications.find((a) => a.company === 'WidgetCo');
    assert.ok(app);
    assert.equal(app.advertised.raw, '90k CAD per year');
    assert.equal(app.advertised.postingLocation, null);
    assert.equal(app.postingLocation, 'Halifax, NS', 'legacy application-level location still reflects the first linked report');
    assert.equal(app.relocation, null, 'the later salary must not inherit the earlier report location');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('folded relocation accepts a periodless annual-scale figure', () => {
  const dataRoot = fixtureDataRoot('60k CAD');
  try {
    const r = run([], { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' });
    assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
    const out = JSON.parse(r.stdout);
    const app = out.applications.find((a) => a.company === 'WidgetCo');
    assert.ok(app);
    assert.equal(app.advertised.raw, '60k CAD');
    assert.equal(app.advertised.period, null);
    assert.equal(app.advertised.value, 60000);
    assert.ok(app.relocation?.ok, 'a periodless annual-scale amount must get the relocation comparison');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('folded relocation rejects a periodless figure below annual magnitude', () => {
  const dataRoot = fixtureDataRoot('20 USD');
  try {
    const r = run([], { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' });
    assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
    const out = JSON.parse(r.stdout);
    const app = out.applications.find((a) => a.company === 'WidgetCo');
    assert.ok(app);
    assert.equal(app.advertised.raw, '20 USD');
    assert.equal(app.advertised.period, null);
    assert.equal(app.advertised.value, 20);
    assert.equal(app.relocation, null, 'an unlabelled hourly-scale amount must not be treated as annual gross');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('folded relocation accepts an annual period written before the currency', () => {
  const dataRoot = fixtureDataRoot('60k per year CAD');
  try {
    const r = run([], { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' });
    assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
    const out = JSON.parse(r.stdout);
    const app = out.applications.find((a) => a.company === 'WidgetCo');
    assert.ok(app?.relocation?.ok, `expected annual comparison, got ${JSON.stringify(app?.relocation)}`);
    assert.equal(app.advertised.value, 60000);
    assert.equal(app.advertised.period, 'annual');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('--summary mode renders the relocation line with the not-financial-advice caveat', () => {
  const dataRoot = fixtureDataRoot();
  try {
    const r = run(['--summary'], { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' });
    assert.equal(r.status, 0, describeSpawn(r, `exit 0 expected, got ${r.status}`));
    assert.match(r.stdout, /relocation:.*Ontario, Canada.*Nova Scotia, Canada/);
    assert.match(r.stdout, /not financial\/tax advice/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

// ── Documentation / prompt wiring (mirrors #2892's own wiring checks for the
//    AI-screening disclosure signal, scoped to this feature's own test file
//    rather than a new inline section in test-all.mjs — see that file's own
//    header: "NEW TESTS GO IN A FILE OF THEIR OWN") ──

test('modes/oferta.md Block G carries Signal 17 and its Risk Summary row', () => {
  const oferta = readFile('modes/oferta.md') + readFile('modes/oferta-signals/17-relocation-purchasing-power.md');
  assert.match(oferta, /\*\*17\. Relocation Purchasing Power\*\*/, 'Signal 17 heading present');
  assert.match(oferta, /node salary-gap\.mjs --relocation --gross/, 'Signal 17 instructs running the real CLI, not hand-computing the arithmetic');
  assert.match(oferta, /Not financial or tax advice|not financial or tax advice/i, 'Signal 17 carries the not-financial/tax-advice disclaimer');
  // The end bound is searched from the section start, as in test-all.mjs's
  // #2892 check: a block placed before Risk Summary that shows its own
  // "Block format:" would otherwise end the slice before it starts.
  const riskSummaryStart = oferta.indexOf('## Risk Summary (after Block G)');
  const riskSummarySection = oferta.slice(
    riskSummaryStart,
    oferta.indexOf('Block format:', riskSummaryStart),
  );
  assert.match(riskSummarySection, /Relocation purchasing power/, 'Risk Summary table carries the relocation purchasing-power row');
});

test('batch/batch-prompt.md Machine Summary schema carries posting_location and the relocation_purchasing_power risk_summary key', () => {
  const batchPrompt = readFile('batch/batch-prompt.md');
  const postingLocationCount = (batchPrompt.match(/posting_location:/g) ?? []).length;
  assert.ok(postingLocationCount >= 2, `expected posting_location in both schema blocks, found ${postingLocationCount}`);
  const relocKeyCount = (batchPrompt.match(/relocation_purchasing_power:/g) ?? []).length;
  assert.ok(relocKeyCount >= 2, `expected relocation_purchasing_power in both risk_summary blocks, found ${relocKeyCount}`);
});

test('templates/README.md documents the new jurisdiction-relocation-tax.yml table', () => {
  const templatesReadme = readFile('templates/README.md');
  assert.match(templatesReadme, /jurisdiction-relocation-tax\.yml/);
});

test('no posting_location, no relocation field attached — absence of data is silence, never a guessed penalty', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-relocation-none-'));
  try {
    mkdirSync(join(dataRoot, 'data'), { recursive: true });
    mkdirSync(join(dataRoot, 'reports'), { recursive: true });
    mkdirSync(join(dataRoot, 'config'), { recursive: true });
    writeFileSync(join(dataRoot, 'config', 'profile.yml'), 'candidate:\n  location: "Toronto, ON"\n');
    writeFileSync(join(dataRoot, 'reports', '051-othercorp-2026-09-02.md'), [
      '# Evaluation: OtherCorp — Eng', '', '## Machine Summary', '', '```yaml',
      'company: "OtherCorp"', 'role: "Eng"', 'advertised_comp: "80k CAD"', '```', '',
    ].join('\n'));
    writeFileSync(join(dataRoot, 'data', 'applications.md'), [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 2 | 2026-09-02 | OtherCorp | Eng | 4.0/5 | Applied | ❌ | [51](reports/051-othercorp-2026-09-02.md) | n |', '',
    ].join('\n'));
    const r = run([], { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' });
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    const app = out.applications.find((a) => a.company === 'OtherCorp');
    assert.ok(app);
    assert.equal(app.postingLocation, null);
    assert.equal(app.relocation, null, 'no posting location -> relocation stays null, not an attempted/failed comparison');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
