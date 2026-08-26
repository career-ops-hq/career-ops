// tests/main-guard-convention.test.mjs — every entrypoint answers "was I run?"
// through lib/is-main-module.mjs, and answers it correctly through a symlink
// (#3170).
//
// The defect: `import.meta.url === pathToFileURL(process.argv[1]).href` compares
// a realpath-resolved URL (Node resolves the ESM entry through realpath) against
// whatever spelling the caller typed. Reached through a symlink the two never
// match, the CLI tail is skipped, and the process exits 0 having produced
// nothing — `node /tmp/co/generate-pdf.mjs` reported success and wrote no PDF.
//
// Two halves, and both are needed:
//
//   1. BEHAVIOUR — a real entrypoint, invoked through a real symlink, still runs.
//      Without this the convention check below only pins a spelling.
//   2. CONVENTION — no file references the process entry path at all, outside
//      the helper and a short justified exemption list. Sixty files hand-rolled
//      the comparison in six spellings and all but one were wrong; a reviewer
//      cannot be expected to catch the sixty-first, and a comparison-shaped
//      detector is defeated by one intermediate variable — so the rule bans the
//      raw ingredient (process.argv[1]), not the recipe.
//
// Run:  node --test tests/main-guard-convention.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainModule } from '../lib/is-main-module.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Link `ROOT` into a fresh temp dir, or report that this machine cannot.
 *
 * Directory symlinks are not universally available: on Windows they need
 * SeCreateSymbolicLinkPrivilege unless Developer Mode is on (the privilege whose
 * absence aborted a whole suite in #2828), junctions refuse network and some
 * mounted volumes, and a container can be stricter still. 'junction' is ignored
 * off Windows and is the one type Windows grants unprivileged, so it is the best
 * first try — but a machine that still cannot link must SKIP these assertions,
 * not redden a suite over a platform capability. tests/helpers.mjs's
 * linkRepoPackage() takes the same position (it falls back to a copy); a copy is
 * no substitute here, because the symlink IS the thing under test.
 *
 * @param {string} prefix - mkdtemp prefix for the containing directory.
 * @returns {{link: string, cleanup: () => void} | null} Null when unsupported.
 */
function linkedRoot(prefix) {
  const linkRoot = mkdtempSync(join(tmpdir(), prefix));
  const link = join(linkRoot, 'repo');
  const cleanup = () => rmSync(linkRoot, { recursive: true, force: true });
  try {
    symlinkSync(ROOT, link, 'junction');
  } catch (err) {
    cleanup();
    console.log(`  SKIP: symlink unsupported here (${err.code || err.message})`);
    return null;
  }
  return { link, cleanup };
}

// ── 1. Behaviour ────────────────────────────────────────────────────────────

test('a CLI reached through a symlinked directory still runs', (t) => {
  // generate-pdf.mjs is the probe on purpose: it is the file #3170 was filed
  // about, the one that reported success while writing no PDF. It is also a
  // good probe mechanically — --help is zero-network, exits in ~0.4s, and
  // prints deterministic usage. Any silent-no-op regression shows up as empty
  // stdout, which is exactly the shape the bug had.
  const linked = linkedRoot('main-guard-');
  if (!linked) return t.skip('directory symlinks unavailable on this machine');
  const { link, cleanup } = linked;
  try {
    const direct = spawnSync(process.execPath, [join(ROOT, 'generate-pdf.mjs'), '--help'], {
      encoding: 'utf-8', timeout: 30_000,
    });
    const viaLink = spawnSync(process.execPath, [join(link, 'generate-pdf.mjs'), '--help'], {
      encoding: 'utf-8', timeout: 30_000,
    });
    // BOTH streams: generate-pdf.mjs writes its usage to stderr, and a probe that
    // watched only stdout would see "" from a working CLI and "" from a silently
    // suppressed one — the two outcomes this test exists to tell apart.
    const output = (r) => `${r.stdout}${r.stderr}`;
    assert.ok(output(direct).trim().length > 0, 'the direct invocation printed nothing — bad probe');
    assert.ok(
      output(viaLink).trim().length > 0,
      'invoked through a symlink the CLI printed nothing and exited ' +
        `${viaLink.status} — the main-guard silently suppressed it (#3170)`,
    );
    assert.equal(output(viaLink), output(direct), 'the symlinked invocation behaved differently');
    assert.equal(viaLink.status, direct.status);
  } finally {
    cleanup();
  }
});

test('isMainModule is false for a module that is not the entry', () => {
  // The whole point of the guard: importing a module must not fire its CLI.
  // Under `node --test` THIS file is the entry, so the negative case has to be
  // asked about a different file — any real entrypoint will do.
  const other = pathToFileURL(join(ROOT, 'check-table-freshness.mjs')).href;
  assert.equal(isMainModule(other), false);
  // A non-file scheme is a legitimate "not the entry", not a bad call.
  assert.equal(isMainModule('data:text/javascript,export default 1'), false);
});

test('isMainModule refuses a filesystem path instead of quietly returning false', () => {
  // The footgun that would reintroduce #3170 one call site at a time:
  // isMainModule(import.meta.filename) resolves, compares false, and suppresses
  // the CLI in silence. It must crash and name the mistake instead.
  assert.throws(() => isMainModule(join(ROOT, 'check-table-freshness.mjs')), /filesystem path/,
    'a path must throw, not return false');
  assert.throws(() => isMainModule('C:\\repo\\pdf.mjs'), /filesystem path/, 'a Windows path must throw too');
  // Drive-RELATIVE, no separator: still a path, and it parses as a one-letter
  // URL scheme, so it reached the "not a file: URL" branch and returned false.
  assert.throws(() => isMainModule('C:repo\\pdf.mjs'), /filesystem path/,
    'a drive-relative Windows path must throw, not return false');
  assert.throws(() => isMainModule(''), TypeError);
  assert.throws(() => isMainModule(undefined), TypeError);
});

test('isMainModule is true for the file node was pointed at, symlinked or not', (t) => {
  const linked = linkedRoot('main-guard-self-');
  if (!linked) return t.skip('directory symlinks unavailable on this machine');
  const { link, cleanup } = linked;
  try {
    const probe = "import { isMainModule } from './lib/is-main-module.mjs';" +
      'process.stdout.write(String(isMainModule(import.meta.url)));';
    for (const base of [ROOT, link]) {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: base, encoding: 'utf-8', timeout: 30_000,
      });
      // `node -e` has no argv[1] at all, so this pins the other half of the
      // contract: nothing was "run", so nothing is main.
      assert.equal(r.stdout, 'false', `node -e reported main from ${base}`);
    }
  } finally {
    cleanup();
  }
});

// ── 2. Convention ───────────────────────────────────────────────────────────
//
// The rule is stronger than "don't compare import.meta.url against argv[1]":
// NO file may reference the process entry path at all, outside the helper and
// the justified exemptions below. A comparison-shaped detector is defeated by
// one intermediate variable —
//
//   const entry = process.argv[1];
//   if (entry && pathToFileURL(entry).href === import.meta.url) { ... }
//
// — and the only legitimate consumer of argv[1] in this codebase IS the
// main-guard question, which isMainModule() answers. So the reference itself is
// the violation. This also removes the need to strip block comments (a naive
// stripper is derailed by /* and */ inside the glob strings and regex literals
// this repo is full of): only whole-line comments are excused, and a reference
// inside a string fails CLOSED — add an exemption with a reason, or rewrite.

const ENTRY_REF = /process\.argv\[1\]|process\.argv\.at\(\s*1\s*\)/;

// A line that is nothing but comment. Block-comment BODIES are covered by the
// leading `*` of this repo's JSDoc style; a reference sharing a line with code
// is treated as code, which can only over-report, never under-report.
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

const SKIP_DIRS = new Set([
  'node_modules', '.git',
  // User-layer / generated trees (gitignored, may hold arbitrary user files).
  // batch/ is deliberately NOT here: its tracked scripts (aggregate-tokens.mjs)
  // are entrypoints like any other and stay under enforcement.
  'output', 'data', 'reports', 'jds', 'documents', 'interview-prep',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // .tmp-* probe dirs; no tracked dotdir ships .mjs
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

// Every exemption carries its reason; an unexplained entry is a review smell.
const EXEMPT = new Map([
  // The helper is the one place allowed to read the entry path.
  ['lib/is-main-module.mjs', 'is the comparison'],
  // This file quotes the pattern in its detector self-test and error messages.
  ['tests/main-guard-convention.test.mjs', 'quotes the pattern to test the detector'],
  // Assigns argv[1] inside a spawned child's preamble so the copied script's
  // main-guard fires under `node -e` — the child's entry path, not a guard.
  ['tests/scan-ats-full-outage-checkpoint.test.mjs', 'sets a child process\u2019s argv[1] in a spawn preamble'],
  // Asserts that a bash-embedded node snippet reads its input file via ITS OWN
  // argv[1] (injection safety, not a main-guard); the literal lives in strings.
  ['tests/batch-runner-jd-prefetch.test.mjs', 'asserts another script\u2019s argv[1] usage in strings'],
]);

// ── The #3170 ratchet ───────────────────────────────────────────────────────
//
// Converting ~60 entrypoints is too wide for one reviewable change, so it lands
// in batches. The naive order — convert everything, then add this test — leaves
// the tree unguarded for the whole series, which is exactly the window in which
// a sixty-first hand-rolled guard slips in unnoticed.
//
// So the test ships FIRST, and every not-yet-converted file is listed here. The
// list only ever SHRINKS: each batch deletes its own entries, and the dead-entry
// check below FAILS if a listed file no longer references the entry path, so a
// conversion cannot land without shrinking it. A newly added entrypoint is not
// on this list and is therefore caught from day one.
//
// When the last entry goes, delete PENDING, its uses, and this comment. A
// ratchet that outlives its job is just a permanent hole.
const PENDING = new Set([
  'add-entry.mjs',
  'application-answers.mjs',
  'application-artifacts.mjs',
  'archive-posting.mjs',
  'assessment-log.mjs',
  'batch-evaluate-gemini.mjs',
  'batch/aggregate-tokens.mjs',
  'browser-extract.mjs',
  'check-table-freshness.mjs',
  'classify-tier.mjs',
  'company-funded.mjs',
  'company-history.mjs',
  'contacts.mjs',
  'cv-templates.mjs',
  'detect-reposts.mjs',
  'discover-ats.mjs',
  'extract-latex-content.mjs',
  'find.mjs',
  'fix-slugs.mjs',
  'followup-cadence.mjs',
  'followup-seed.mjs',
  'funnel-velocity.mjs',
  'generate-cover-letter.mjs',
  'generate-latex.mjs',
  'img-to-pdf.mjs',
  'intake.mjs',
  'invite-match.mjs',
  'jd-similarity.mjs',
  'jd-skill-gap.mjs',
  'match-star.mjs',
  'negotiation-roi.mjs',
  'normalize-statuses.mjs',
  'openrouter-runner.mjs',
  'paste-reply.mjs',
  'patch-latex-content.mjs',
  'plugin-audit.mjs',
  'plugins.mjs',
  'process-quality.mjs',
  'rank-pipeline.mjs',
  'rejection-latency.mjs',
  'reserve-report-num.mjs',
  'salary-gap.mjs',
  'scan-ats-full.mjs',
  'scan-hn.mjs',
  'scan.mjs',
  'seed-fixture.mjs',
  'stats.mjs',
  'story-provenance-check.mjs',
  'tracker-sync-check.mjs',
  'tracker.mjs',
  'update-system.mjs',
  'upgrade-tests.mjs',
  'upskill.mjs',
  'validate-plugin-registry.mjs',
  'validate-untrusted-content-coverage.mjs',
  'verify-cv-facts.mjs',
  'verify-portals.mjs',
  'weekly-digest.mjs',
]);

function entryRefViolations(src) {
  const hits = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (COMMENT_LINE.test(lines[i])) continue;
    if (ENTRY_REF.test(lines[i])) hits.push(i + 1);
  }
  return hits;
}

test('no file outside the helper reads the process entry path', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (EXEMPT.has(rel) || PENDING.has(rel)) continue;
    const hits = entryRefViolations(readFileSync(file, 'utf-8'));
    if (hits.length) offenders.push(`${rel}:${hits.join(',')}`);
  }
  assert.deepEqual(
    offenders,
    [],
    'these files reference process.argv[1] directly. Sixty entrypoints hand-rolled the ' +
      '"am I main?" comparison from it, in six spellings, and all but one silently no-opped ' +
      "through a symlinked checkout (#3170). Use lib/is-main-module.mjs's " +
      'isMainModule(import.meta.url) instead — and if you genuinely need the entry path for ' +
      'something else, add an exemption WITH A REASON to EXEMPT in this test:\n  ' +
      offenders.join('\n  '),
  );
});

test('neither the exemption list nor the ratchet carries a dead entry', () => {
  // An exemption that outlives its reference is a hole waiting for a new one,
  // and a PENDING entry that outlives its conversion silently un-guards a file
  // that is already correct. Same check, both lists.
  for (const [rel] of EXEMPT) {
    const src = readFileSync(join(ROOT, rel), 'utf-8');
    assert.ok(ENTRY_REF.test(src), `${rel} no longer references the entry path — remove its exemption`);
  }
  for (const rel of PENDING) {
    const src = readFileSync(join(ROOT, rel), 'utf-8');
    assert.ok(
      ENTRY_REF.test(src),
      `${rel} is converted but still listed in PENDING — delete it from the ratchet (#3170)`,
    );
  }
});

test('the convention check can actually see a violation', () => {
  // A detector that matches nothing passes forever. Feed it the exact line
  // #3170 was filed about, the one-variable-of-indirection evasion, and the
  // fix, and require the right answer for each.
  const oldSpelling = 'const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);';
  assert.deepEqual(entryRefViolations(oldSpelling), [1], 'the detector no longer matches the original defect');
  const laundered = 'const entry = process.argv.at(1);\nif (entry) run();';
  assert.deepEqual(entryRefViolations(laundered), [1], 'the detector misses the variable-indirection evasion');
  assert.deepEqual(entryRefViolations('const isMain = isMainModule(import.meta.url);'), [], 'the detector flags the fix');
  assert.deepEqual(entryRefViolations('// process.argv[1] is explained here\n * and here (JSDoc body)'), [], 'comment lines must be excused');
});
