// tests/help-flag-handled.test.mjs — `--help` prints help, on every CLI that
// has one.
//
// Six scripts did not recognise the flag, and an unrecognised flag was simply
// discarded — so `--help` fell through to the analysis and the script RAN:
//
//   calibrate.mjs --help              printed a full calibration report
//   salary-gap.mjs --help             printed JSON
//   tracker-sync-check.mjs --help     printed JSON
//   story-provenance-check.mjs --help printed JSON
//
// Nothing errored, which is the problem: the user asked what the flags are and
// got output that answers a different question, with no sign the flag was never
// read. For a script that writes, the same silent-discard would run the write.
//
// Two invariants, because either alone is satisfiable the wrong way: help must
// be PRINTED (not just exit 0), and the work must NOT have run.
//
// Run:  node --test tests/help-flag-handled.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const FIXED = [
  'calibrate.mjs', 'salary-gap.mjs', 'tracker-sync-check.mjs',
  'story-provenance-check.mjs', 'negotiation-roi.mjs', 'jd-skill-gap.mjs',
];

function help(script) {
  const r = spawnSync(process.execPath, [join(ROOT, script), '--help'], {
    cwd: ROOT, encoding: 'utf-8', timeout: 60_000,
  });
  assert.equal(r.error, undefined, `${script} failed to spawn: ${r.error?.message}`);
  return r;
}

for (const script of FIXED) {
  test(`${script} --help prints usage and exits 0`, () => {
    const r = help(script);
    assert.equal(r.status, 0, `exited ${r.status}: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, /^Usage:/m, `no usage block:\n${r.stdout.slice(0, 200)}`);
  });

  test(`${script} --help does not run the script`, () => {
    // The half that matters. Exiting 0 with a usage block would still be wrong
    // if the analysis had also run — the original bug produced output too.
    const r = help(script);
    assert.doesNotMatch(r.stdout, /^\s*\{/, `it printed JSON as well as usage:\n${r.stdout.slice(0, 200)}`);
    assert.ok(r.stdout.split('\n').length < 40, `output is too long to be usage alone (${r.stdout.split('\n').length} lines)`);
  });

  test(`${script} --help names only flags it accepts`, () => {
    // Usage that lists an option the script ignores is worse than none — it
    // sends the user to write a flag that silently does nothing.
    const src = readFileSync(join(ROOT, script), 'utf-8');
    const documented = [...help(script).stdout.matchAll(/^\s+(--[a-z-]+)/gm)].map((m) => m[1]);
    assert.ok(documented.length > 0, 'the usage block lists no flags');
    const phantom = documented.filter((f) => f !== '--help' && !src.includes(`'${f}'`));
    assert.deepEqual(phantom, [], `${script} documents flag(s) it does not accept: ${phantom.join(', ')}`);
  });
}

test('-h is accepted wherever --help is', () => {
  // Every script in the repo that offers one offers both; a CLI that answers
  // --help and silently runs on -h has the original bug for half its users.
  for (const script of FIXED) {
    const r = spawnSync(process.execPath, [join(ROOT, script), '-h'], { cwd: ROOT, encoding: 'utf-8', timeout: 60_000 });
    assert.equal(r.status, 0, `${script} -h exited ${r.status}`);
    assert.match(r.stdout, /^Usage:/m, `${script} -h did not print usage`);
  }
});

// CLIs that still discard --help. A SHRINKING ALLOWLIST, in the style this repo
// already uses for coverage ratchets: the point is not that this list is empty
// today — nineteen entries is far more than one change should touch — but that
// it can only get shorter. A new CLI cannot join it, and removing an entry
// requires actually fixing that script.
//
// Each of these has the same defect the six fixed here had: an unrecognised
// flag is discarded, so `--help` falls through and the script runs.
const KNOWN_WITHOUT_HELP = new Set([
  'batch-evaluate-gemini.mjs', 'cv-templates.mjs', 'fetch-jd.mjs', 'followup-seed.mjs',
  'generate-cover-letter.mjs', 'generate-latex.mjs', 'generate-pdf.mjs', 'intake.mjs',
  'match-star.mjs', 'normalize-statuses.mjs', 'openrouter-runner.mjs', 'plugins.mjs',
  'scan-hn.mjs', 'scan-interamt.mjs', 'seed-fixture.mjs', 'tracker.mjs',
  'validate-plugin-registry.mjs', 'validate-untrusted-content-coverage.mjs',
  'verify-portals.mjs',
]);

test('no NEW CLI silently swallows --help, and the allowlist only shrinks', () => {
  const offenders = [];
  const fixed = [];
  for (const file of readdirSync(ROOT).filter((f) => f.endsWith('.mjs'))) {
    if (/-tests\.mjs$|^test-|^playwright/.test(file)) continue;
    const src = readFileSync(join(ROOT, file), 'utf-8');
    if (!src.includes('isMainModule(import.meta.url)')) continue;   // not a CLI
    const handles = /'--help'|"--help"/.test(src);
    if (!handles && !KNOWN_WITHOUT_HELP.has(file)) offenders.push(file);
    if (handles && KNOWN_WITHOUT_HELP.has(file)) fixed.push(file);
  }
  assert.deepEqual(
    offenders.sort(),
    [],
    `these CLIs discard --help, so the flag falls through and the script runs instead:\n  ${offenders.join('\n  ')}`,
  );
  // The ratchet's other end: a fixed script must leave the list, or the list
  // stops describing anything and quietly rots.
  assert.deepEqual(
    fixed.sort(),
    [],
    `these now handle --help and should be removed from KNOWN_WITHOUT_HELP:\n  ${fixed.join('\n  ')}`,
  );
});
