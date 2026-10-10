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

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMjsFiles } from '../lib/mjs-files.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const FIXED = [
  'calibrate.mjs', 'salary-gap.mjs', 'tracker-sync-check.mjs',
  'story-provenance-check.mjs', 'negotiation-roi.mjs', 'jd-skill-gap.mjs',
];

// ── Isolation ───────────────────────────────────────────────────────────────
//
// These six CLIs read cv.md, the tracker and interview-prep/story-bank.md. The
// whole premise of the suite is that they might NOT stop at --help, so a run
// against the developer's own root is a run that reads their data — and the
// assertions would then depend on whose machine it is. Every child gets its own
// data root, and every variable that could point back out of it is cleared:
// CAREER_OPS_TRACKER outranks the resolved root (#3988), and the per-file
// overrides would each pull one read back to a real path.
const sandboxes = [];
function makeRoot(populated) {
  const dir = mkdtempSync(join(tmpdir(), 'co-help-'));
  sandboxes.push(dir);
  mkdirSync(join(dir, 'data'), { recursive: true });
  if (!populated) return dir;

  // A root with enough in it that a script which FAILS to stop at --help
  // produces different output than it does against an empty one. That
  // difference is the assertion further down.
  mkdirSync(join(dir, 'interview-prep'), { recursive: true });
  writeFileSync(join(dir, 'cv.md'), '# CV\n\nLed a team of 12 and cut costs by 30%.\n');
  writeFileSync(
    join(dir, 'data', 'applications.md'),
    '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 1 | 2026-01-05 | Northwind Robotics | Backend Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-x.md) | fixture |\n',
  );
  writeFileSync(
    join(dir, 'interview-prep', 'story-bank.md'),
    '## Cost work\n\n- Cut costs by 30% across a team of 12.\n',
  );
  return dir;
}

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function runIn(root, script, args) {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    // cwd is the sandbox, not ROOT: a script resolving an input relative to the
    // process's directory must land inside the fixture, not in the checkout.
    // Module resolution is by file path, so the sibling imports still load.
    cwd: root,
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_PROFILE: '',
      CAREER_OPS_REPORTS_DIR: '',
    },
  });
  assert.equal(r.error, undefined, `${script} failed to spawn: ${r.error?.message}`);
  return r;
}

const EMPTY_ROOT = makeRoot(false);
const FULL_ROOT = makeRoot(true);

function help(script) {
  return runIn(EMPTY_ROOT, script, ['--help']);
}

for (const script of FIXED) {
  test(`${script} --help prints usage and exits 0`, () => {
    const r = help(script);
    assert.equal(r.status, 0, `exited ${r.status}: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, /^Usage:/m, `no usage block:\n${r.stdout.slice(0, 200)}`);
  });

  test(`${script} --help does not run the script`, () => {
    // The half that matters, and the hard half to assert. Rejecting JSON and
    // capping the line count leaves a script that prints a SHORT non-JSON
    // report passing — the check would be satisfied by the wrong thing.
    //
    // The invariant that actually holds: help does not depend on the data. Run
    // the same argv against an empty root and a populated one; a script that
    // stops at --help cannot tell them apart, and a script that falls through
    // to its analysis reads a tracker, a CV and a story bank in one and not the
    // other. Byte-identical stdout is therefore proof the work did not run, and
    // it needs no knowledge of what each script's output looks like.
    const empty = runIn(EMPTY_ROOT, script, ['--help']);
    const full = runIn(FULL_ROOT, script, ['--help']);
    assert.equal(
      full.stdout,
      empty.stdout,
      `${script} --help produced different output against a populated data root, so it read the data ` +
        `instead of stopping at the flag:\n--- empty ---\n${empty.stdout.slice(0, 300)}\n--- populated ---\n${full.stdout.slice(0, 300)}`,
    );
    // Cheap corroboration, kept because it names the original symptom directly.
    assert.doesNotMatch(empty.stdout, /^\s*\{/, `it printed JSON as well as usage:\n${empty.stdout.slice(0, 200)}`);
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

test('-h is accepted wherever --help is, and suppresses the same work', () => {
  // Every script in the repo that offers one offers both; a CLI that answers
  // --help and silently runs on -h has the original bug for half its users.
  //
  // Status and a usage line are not enough on their own: the short alias is the
  // one more likely to be wired to a different branch, so it gets the same
  // data-independence proof as --help, plus an equality check against --help's
  // own output so the two cannot drift into answering differently.
  for (const script of FIXED) {
    const short = runIn(EMPTY_ROOT, script, ['-h']);
    assert.equal(short.status, 0, `${script} -h exited ${short.status}: ${short.stderr.slice(0, 200)}`);
    assert.match(short.stdout, /^Usage:/m, `${script} -h did not print usage`);

    const shortFull = runIn(FULL_ROOT, script, ['-h']);
    assert.equal(
      shortFull.stdout,
      short.stdout,
      `${script} -h read the data root instead of stopping at the flag`,
    );
    assert.equal(short.stdout, help(script).stdout, `${script} answers -h and --help differently`);
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
  'generate-cover-letter.mjs', 'generate-pdf.mjs', 'intake.mjs',
  'match-star.mjs', 'openrouter-runner.mjs', 'plugins.mjs',
  'seed-fixture.mjs', 'tracker.mjs',
  'validate-plugin-registry.mjs', 'validate-untrusted-content-coverage.mjs',
  // generate-latex.mjs and verify-portals.mjs were here and have since been
  // fixed upstream; the ratchet's other end caught that on the rebase and
  // required their removal, which is the half of it that keeps the list from
  // quietly rotting into a description of nothing.
  //
  // normalize-statuses.mjs, scan-hn.mjs and scan-interamt.mjs left the same way
  // on this rebase: all three gained KNOWN_FLAGS containing '--help' between
  // 2026-09-30 and 2026-10-03, from other contributors.

  // Surfaced by widening the scan below from one directory to the whole tree.
  // These are NOT new CLIs joining a list that is supposed to shrink — they
  // have always had the defect, and readdirSync(ROOT) simply could not see
  // them. Listing them is what makes the wider scan adoptable in one change
  // instead of turning it into a seven-script fix; the ratchet's rule is
  // unchanged and the list may only get shorter from here.
  //
  // keyword-match.mjs is the one worth a second look: it PRINTS usage for
  // `--help`, which reads as handled, but only because the flag falls through
  // to its "report file not found" path — so it exits 1 and would run the
  // comparison if a file by that name existed.
  'batch/aggregate-tokens.mjs',
  'keyword-match.mjs',
  'migrate-scan-runs.mjs',
  'plugins/h1b-sponsor/install-h1b-index.mjs',
  'plugins/h1b-sponsor/token.mjs',
  'scripts/export-ats-text.mjs',

  // Not user-facing CLIs, so `--help` is not a question anyone asks them. They
  // carry the isMainModule guard because something else invokes them — a
  // workflow step and the web app's own job runner — and neither is reachable
  // from a shell prompt the way every other entry here is.
  //
  // These two are the only additions; the list is net SHORTER than before this
  // change, which is the direction the ratchet allows. The three root-level
  // CLIs the same scan surfaced (cv-title-check.mjs, scan-dayforce.mjs,
  // sync-pdf-flags.mjs) are user-facing and were FIXED in this PR rather than
  // listed, because listing them is what turns this into a description of
  // nothing.
  '.github/scripts/sponsors.mjs',
  'web/scripts/scheduled-jobs-runner.mjs',
]);

/**
 * Source with comments and string literals blanked out.
 *
 * The substring test used to run over the raw file, so a CLI that merely
 * MENTIONS the flag — in a usage string it never prints, in a comment
 * explaining that it does not support one, in a message naming another
 * script's flag — counted as handling it. Blanking both means the match has to
 * come from code.
 *
 * Crude on purpose: it does not parse JS, it just removes the two regions where
 * a mention is not a use. Erring toward blanking is the safe direction — it can
 * only move a file INTO the offender list, which fails loudly, never quietly
 * out of it.
 *
 * @param {string} src
 * @returns {string}
 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')       // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')     // line comments (not a URL's //)
    .replace(/`(?:\\.|[^`\\])*`/g, '``')        // template literals (usage text lives here)
    .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => m)  // single-quoted: KEPT, this is how flags are written
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => m); // double-quoted: kept for the same reason
}

test('no NEW CLI silently swallows --help, and the allowlist only shrinks', () => {
  const offenders = [];
  const fixed = [];
  // Recursive, via the shared walker: readdirSync(ROOT) saw only the top level
  // and missed nested CLIs such as batch/aggregate-tokens.mjs. collectMjsFiles
  // also carries SKIP_DIRS and the nested-checkout guard, so a second checkout
  // parked under the tree is not scanned as this repository's source (#3499).
  for (const abs of collectMjsFiles(ROOT)) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    if (/(^|\/)tests\//.test(rel)) continue;
    if (/-tests\.mjs$|(^|\/)test-|(^|\/)playwright/.test(rel)) continue;
    const code = codeOnly(readFileSync(abs, 'utf-8'));
    // The CLI test reads code too. lib/is-main-module.mjs documents the call in
    // its own JSDoc, so a raw substring match classified the helper that defines
    // the guard as a CLI that forgot one.
    if (!code.includes('isMainModule(import.meta.url)')) continue;   // not a CLI
    // The allowlist is keyed by BASENAME, which was unambiguous while the scan
    // was one directory deep. Keyed by path now, with the basename still
    // accepted so the nineteen existing entries keep meaning what they meant.
    const key = KNOWN_WITHOUT_HELP.has(rel) ? rel : rel.split('/').pop();
    const handles = /'--help'|"--help"/.test(code);
    if (!handles && !KNOWN_WITHOUT_HELP.has(key)) offenders.push(rel);
    if (handles && KNOWN_WITHOUT_HELP.has(key)) fixed.push(key);
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
