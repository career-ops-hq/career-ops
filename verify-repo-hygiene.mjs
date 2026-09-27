#!/usr/bin/env node

/**
 * verify-repo-hygiene.mjs — repository and commit hygiene, deterministic and
 * read-only (no LLM, no network, no writes).
 *
 * The companion to verify-cv-style.mjs. That gate guards what a generated CV
 * *claims*; this one guards whether the work *around* the CV is safe to hand
 * over: that system files are actually registered with the updater, that the
 * user's gitignored layer has not been committed by accident, and that nothing
 * secret-shaped is sitting in an uncommitted diff.
 *
 * Motivation is concrete, not theoretical. `validate-system-paths-coverage.mjs`
 * already checks SYSTEM_PATHS, but it enumerates with `git ls-files`, so it can
 * only ever see TRACKED files: a brand-new system script that was written but
 * never registered, and never committed, is invisible to it. That is the exact
 * state in which `update-system.mjs apply` would silently leave the file behind
 * on the next update. This script closes that hole by also reading
 * `git ls-files --others --exclude-standard`, which sees untracked-but-not-
 * ignored files while still correctly ignoring the user layer.
 *
 * Checks (severity in brackets):
 *   [fail] user-layer-tracked     a gitignored user file is now tracked
 *   [fail] system-unregistered    a system file exists but is not in SYSTEM_PATHS
 *   [fail] system-path-missing     a SYSTEM_PATHS entry has no file on disk
 *   [fail] system-path-untracked   a SYSTEM_PATHS entry is not tracked by git
 *   [warn] system-dirty            a SYSTEM_PATHS file has uncommitted edits
 *   [warn] secret-in-diff          a secret-shaped string is in the pending diff
 *
 * The two `warn` classes are deliberately warnings and not failures: an
 * in-progress edit and a staged-but-uncommitted change are normal states
 * mid-task. The four `fail` classes are states that are wrong at rest, and
 * that a human should have to consciously override.
 *
 * Usage:
 *   node verify-repo-hygiene.mjs
 *   node verify-repo-hygiene.mjs --json
 *   node verify-repo-hygiene.mjs --strict     treat warnings as failures
 *   node verify-repo-hygiene.mjs --self-test
 *
 * Exit: 0 clean, 1 on any fail (or on any finding with --strict), 2 on setup
 * problems (not a git repository, git binary missing).
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isMainModule } from './lib/is-main-module.mjs';
import { SYSTEM_PATHS, SYSTEM_TOMBSTONES } from './update-system.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── The user layer ──────────────────────────────────────────────────────────
// Never auto-updated, never committed. If any of these show up in
// `git ls-files`, a personal document has been staged for publication.
const USER_LAYER = [
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'modes/_custom.md',
  'article-digest.md',
  'interview-prep/story-bank.md',
  'portals.yml',
  'data/applications.md',
  '.env',
];

// ── What counts as a system file ────────────────────────────────────────────
// Deliberately narrow. A file qualifies only if it would be shipped to other
// users by update-system.mjs, i.e. it lives at the repo root as a script or a
// mode/config doc, or inside one of the shipped directories.
const SYSTEM_DIRS = ['templates', 'dashboard', 'batch', 'providers', 'tests', 'lib', 'modes'];

function looksLikeSystemFile(rel) {
  const top = rel.split('/')[0];
  if (SYSTEM_DIRS.includes(top)) return true;
  if (rel.includes('/')) return false;
  return /\.(mjs|js)$/.test(rel) || rel === 'AGENTS.md';
}

/**
 * Secret shapes. The `validate` hook on the last pattern exists because a
 * plain `key = <16 word chars>` match flags ordinary code — `password =
 * getPasswordPrompt()` and `token = response.token` are assignments, not
 * credentials. So an assigned value must also carry some entropy: a digit, and
 * no code-ish punctuation (a call, a property access, a subscript).
 */
const SECRET_PATTERNS = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: 'private key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, why: 'AWS access key id' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, why: 'GitHub token' },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/, why: 'OpenAI-style secret key' },
  { re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, why: 'Slack token' },
  {
    re: /\b(?:api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*["']?([A-Za-z0-9_\-]{16,})/i,
    why: 'assigned credential',
    validate: (value) => /[0-9]/.test(value) && !/[.()[\]{}]/.test(value),
  },
];

function finding(code, severity, target, detail) {
  return { code, severity, target, detail };
}

// ── Pure checks (unit-tested; no git access) ────────────────────────────────

/** A gitignored user document has been committed. */
export function checkUserLayerTracked(tracked, userLayer = USER_LAYER) {
  const out = [];
  const set = new Set(tracked);
  for (const p of userLayer) {
    if (set.has(p)) {
      out.push(finding('user-layer-tracked', 'fail', p,
        'This is a user-layer file (personal, never auto-updated, gitignored by design) but git tracks it. Remove it from the index with `git rm --cached` and confirm the .gitignore rule still covers it.'));
    }
  }
  return out;
}

/**
 * A system file exists on disk but is absent from SYSTEM_PATHS, so
 * update-system.mjs apply will never write it to another install.
 */
export function checkUnregisteredSystemFiles(untracked, systemPaths = SYSTEM_PATHS) {
  const out = [];
  const registered = new Set(systemPaths);
  for (const p of untracked) {
    if (!looksLikeSystemFile(p)) continue;
    if (registered.has(p)) continue;
    out.push(finding('system-unregistered', 'fail', p,
      'A system file exists on disk and is not gitignored, but it is not in SYSTEM_PATHS. `update-system.mjs apply` will not ship it, and `validate-system-paths-coverage.mjs` cannot see it because that check enumerates tracked files only. Add it to SYSTEM_PATHS in update-system.mjs.'));
  }
  return out;
}

/**
 * A tombstone dropped from SYSTEM_PATHS no longer prunes anything, which is
 * the one direction of drift that actually changes behaviour. Pure set
 * membership on two exported constants, so it is valid in any checkout.
 */
export function checkTombstonesRegistered(entries, tombstones = SYSTEM_TOMBSTONES) {
  const out = [];
  const entrySet = new Set(entries);
  for (const p of tombstones) {
    if (!entrySet.has(p)) {
      out.push(finding('tombstone-not-registered', 'fail', p,
        'Declared a tombstone in SYSTEM_TOMBSTONES but not present in SYSTEM_PATHS. Its pruning reason has gone: staleSystemFiles() only prunes paths SYSTEM_PATHS knows about, so the orphan is now left on disk forever.'));
    }
  }
  return out;
}

/**
 * SYSTEM_PATHS entries must exist on disk and be tracked.
 *
 * A retired path stays in SYSTEM_PATHS on purpose — staleSystemFiles() needs the
 * membership so it can prune the orphan on an upgraded install — so a tombstone
 * legitimately has no file and is exempt.
 */
export function checkSystemPathEntries(entries, { exists, tracked }, tombstones = SYSTEM_TOMBSTONES) {
  const out = [];
  const trackedSet = tracked instanceof Set ? tracked : new Set(tracked);
  for (const p of entries) {
    if (p.endsWith('/')) continue; // directory prefix, not a file
    if (tombstones.has(p)) continue; // intentionally absent
    if (!exists(p)) {
      out.push(finding('system-path-missing', 'fail', p,
        'Registered in SYSTEM_PATHS but no such file on disk, and not declared a tombstone. Remove the entry, restore the file, or add it to SYSTEM_TOMBSTONES if the move was intentional.'));
      continue;
    }
    if (!trackedSet.has(p)) {
      out.push(finding('system-path-untracked', 'fail', p,
        'Registered in SYSTEM_PATHS but untracked by git. `update-system.mjs apply` checks these paths out from the index, so an untracked entry can never be restored — commit it.'));
    }
  }
  return out;
}

/**
 * How much of the registered system layer is actually in the git index.
 *
 * The coverage rules above describe the repo as it *ships*, so they only mean
 * something when the index carries the system layer. verify-pipeline's own test
 * fixtures copy the working tree into a temp directory and commit only the
 * handful of files each fixture is about; the files are on disk but untracked.
 * Calling that "278 untracked system paths" would fail the pipeline for reasons
 * unrelated to what the fixture tests, so measure index completeness and let
 * that one family stand down — while saying so in the output rather than
 * reporting a clean pass.
 *
 * Measuring the index rather than disk presence is what makes this work: a
 * fixture is a complete-looking filesystem, so only the index distinguishes it
 * from a real checkout. It is also the right question for an "untracked" rule.
 * A file deleted from disk but still in the index leaves this at 1.0, so
 * system-path-missing still fires on a real repo.
 *
 * Tombstones are excluded: they are supposed to be absent, so counting them
 * would make a real repo look partial.
 */
export function indexCompleteness(tracked, systemPaths = SYSTEM_PATHS, tombstones = SYSTEM_TOMBSTONES) {
  const files = systemPaths.filter((p) => !p.endsWith('/') && !tombstones.has(p));
  if (!files.length) return { ratio: 1, present: 0, expected: 0 };
  const trackedSet = tracked instanceof Set ? tracked : new Set(tracked);
  const present = files.filter((p) => trackedSet.has(p)).length;
  return { ratio: present / files.length, present, expected: files.length };
}

export const MIN_COMPLETENESS = 0.9;

/** Uncommitted edits to a system file: normal mid-task, worth reporting. */
export function checkDirtySystemFiles(dirty, systemPaths = SYSTEM_PATHS) {
  const out = [];
  const registered = new Set(systemPaths);
  for (const p of dirty) {
    if (!registered.has(p)) continue;
    out.push(finding('system-dirty', 'warn', p,
      'System file has uncommitted changes. If the session ends here, `update-system.mjs apply` has no committed restore point for it.'));
  }
  return out;
}

/** Secret-shaped strings in the pending diff. */
export function scanDiffForSecrets(diffText) {
  const out = [];
  const lines = String(diffText || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Only added lines carry new risk; context and removals do not.
    if (!/^\+/.test(lines[i]) || /^\+\+\+/.test(lines[i])) continue;
    for (const { re, why, validate } of SECRET_PATTERNS) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      // A pattern may capture the candidate value and require it to look like
      // entropy rather than code before it counts as a credential.
      if (validate && m[1] !== undefined && !validate(m[1])) continue;
      out.push(finding('secret-in-diff', 'warn', `diff:${i + 1}`,
        `Looks like a${/^[aeiou]/i.test(why) ? 'n' : ''} ${why} in an added line: "${lines[i].trim().slice(0, 90)}". If it is a real credential, revoke and rotate it — removing it from the working tree does not remove it from any prior commit.`));
      break;
    }
  }
  return out;
}

// ── Git access ──────────────────────────────────────────────────────────────

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: HERE, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    if (allowFail) return '';
    throw err;
  }
}

function assertRepo() {
  const inside = git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }).trim();
  if (inside !== 'true') {
    const err = new Error('not a git repository — repository hygiene checks need git');
    err.setup = true;
    throw err;
  }
}

export function verify() {
  assertRepo();

  const tracked = git(['ls-files']).split('\n').filter(Boolean);
  // --exclude-standard is what keeps the user layer out of the untracked set:
  // those files are ignored, so they are not "others".
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const dirty = git(['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean);
  const diff = git(['diff', 'HEAD']);

  const exists = (rel) => existsSync(join(HERE, rel));
  const completeness = indexCompleteness(tracked);
  const partial = completeness.ratio < MIN_COMPLETENESS;

  const skipped = [];
  if (partial) {
    skipped.push(`SYSTEM_PATHS coverage rules skipped — only ${completeness.present}/${completeness.expected} registered system files are in the git index, so this is a partial checkout (verify-pipeline fixtures copy the tree and commit a subset). The index and diff rules still ran.`);
  }

  const findings = [
    // Index/diff rules: meaningful in any checkout.
    ...checkUserLayerTracked(tracked),
    ...checkUnregisteredSystemFiles(untracked),
    ...checkTombstonesRegistered(SYSTEM_PATHS),
    ...checkDirtySystemFiles(dirty),
    ...scanDiffForSecrets(diff),
    // Coverage rules: only in a checkout that actually has the system layer.
    ...(partial ? [] : checkSystemPathEntries(SYSTEM_PATHS, { exists, tracked: new Set(tracked) })),
  ];

  const fails = findings.filter((f) => f.severity === 'fail');
  return {
    findings,
    skipped,
    partial,
    verdict: fails.length ? 'block' : 'ok',
    stats: {
      tracked: tracked.length,
      untracked: untracked.length,
      dirty: dirty.length,
      systemPaths: SYSTEM_PATHS.length,
      userLayer: USER_LAYER.length,
      completeness: completeness.ratio,
    },
  };
}

// ── Self-test ───────────────────────────────────────────────────────────────

function runSelfTest() {
  const has = (out, code) => out.some((f) => f.code === code);
  const tracked = (paths) => new Set(paths);
  const yes = (p) => ({ exists: () => true });

  const cases = [
    // ── user layer ──
    ['tracked user layer is caught', has(checkUserLayerTracked(['cv.md']), 'user-layer-tracked'), true],
    ['untracked user layer is fine', has(checkUserLayerTracked(['verify-cv-style.mjs']), 'user-layer-tracked'), false],
    ['the whole user layer is caught', has(checkUserLayerTracked([...USER_LAYER]), 'user-layer-tracked'), true],

    // ── unregistered system files (the hole this script exists to close) ──
    ['unregistered root script is caught', has(checkUnregisteredSystemFiles(['new-thing.mjs']), 'system-unregistered'), true],
    ['unregistered script in a system dir is caught', has(checkUnregisteredSystemFiles(['templates/new.html']), 'system-unregistered'), true],
    ['a registered file is not flagged', has(checkUnregisteredSystemFiles(['verify-cv-style.mjs']), 'system-unregistered'), false],
    ['a data file is not a system file', has(checkUnregisteredSystemFiles(['reports/001-x.md']), 'system-unregistered'), false],
    ['an unregistered md that is not a mode doc is ignored', has(checkUnregisteredSystemFiles(['notes.md']), 'system-unregistered'), false],

    // ── SYSTEM_PATHS integrity ──
    ['missing system path is caught', has(checkSystemPathEntries(['gone.mjs'], { exists: () => false, tracked: tracked(['gone.mjs']) }), 'system-path-missing'), true],
    ['untracked system path is caught', has(checkSystemPathEntries(['a.mjs'], { exists: yes, tracked: tracked([]) }), 'system-path-untracked'), true],
    ['a healthy entry passes', has(checkSystemPathEntries(['a.mjs'], { exists: yes, tracked: tracked(['a.mjs']) }), 'system-path-untracked'), false],
    ['a directory entry is not treated as a file', has(checkSystemPathEntries(['templates/'], { exists: yes, tracked: tracked([]) }), 'system-path-missing'), false],

    // ── tombstones ──
    ['a declared tombstone is exempt from missing', has(checkSystemPathEntries(['gone.mjs'], { exists: () => false, tracked: tracked([]) }, new Set(['gone.mjs'])), 'system-path-missing'), false],
    ['the real tombstone does not trip the gate', has(checkSystemPathEntries([...SYSTEM_TOMBSTONES], { exists: () => false, tracked: tracked([]) }), 'system-path-missing'), false],
    ['a tombstone outside SYSTEM_PATHS is caught', has(checkTombstonesRegistered([], new Set(['orphan.mjs'])), 'tombstone-not-registered'), true],
    ['a registered tombstone is fine', has(checkTombstonesRegistered(['a.mjs'], new Set(['a.mjs'])), 'tombstone-not-registered'), false],
    ['the real tombstone is still registered', has(checkTombstonesRegistered(SYSTEM_PATHS), 'tombstone-not-registered'), false],
    ['a tombstone does not exempt a different path', has(checkSystemPathEntries(['a.mjs', 'b.mjs'], { exists: yes, tracked: tracked([]) }, new Set(['a.mjs'])), 'system-path-untracked'), true],
    ['a tombstone absent from disk is still untracked-safe', has(checkSystemPathEntries(['gone.mjs'], { exists: () => false, tracked: tracked([]) }, new Set(['gone.mjs'])), 'system-path-untracked'), false],
    
    // ── completeness gate (what keeps verify-pipeline fixtures green) ──
    ['a full index measures 1', indexCompleteness(['a.mjs', 'b.mjs'], ['a.mjs', 'b.mjs'], new Set()).ratio, 1],
    ['a fixture index measures low', indexCompleteness(['a.mjs'], ['a.mjs', 'b.mjs'], new Set()).ratio, 0.5],
    ['a files-on-disk-but-untracked fixture measures low', indexCompleteness(['x.txt'], SYSTEM_PATHS).ratio < MIN_COMPLETENESS, true],
    ['an empty registry is treated as complete', indexCompleteness([], [], new Set()).ratio, 1],
    ['a half-present index is below the gate', indexCompleteness(['a.mjs'], ['a.mjs', 'b.mjs'], new Set()).ratio < MIN_COMPLETENESS, true],
    ['the real index clears the gate', indexCompleteness([...SYSTEM_PATHS]).ratio >= MIN_COMPLETENESS, true],
    ['a tombstone is not counted against completeness', indexCompleteness(['a.mjs'], ['a.mjs', 'b.mjs'], new Set(['b.mjs'])).ratio, 1],

    // ── dirty system files ──
    ['dirty registered system file warns', has(checkDirtySystemFiles(['a.mjs'], ['a.mjs']), 'system-dirty'), true],
    ['dirty unregistered file does not warn as system', has(checkDirtySystemFiles(['a.mjs'], ['b.mjs']), 'system-dirty'), false],

    // ── secrets ──
    ['a private key in the diff is caught', has(scanDiffForSecrets('+-----BEGIN RSA PRIVATE KEY-----'), 'secret-in-diff'), true],
    ['an AWS key id is caught', has(scanDiffForSecrets('+AKIAIOSFODNN7EXAMPLE'), 'secret-in-diff'), true],
    ['a github token is caught', has(scanDiffForSecrets('+ghp_abcdefghijklmnopqrstuvwxyz0123'), 'secret-in-diff'), true],
    ['an assigned api key is caught', has(scanDiffForSecrets('+api_key = "AKIAIOSFODNN7EXAMPLE"'), 'secret-in-diff'), true],
    ['a removed secret is not flagged', has(scanDiffForSecrets('-AKIAIOSFODNN7EXAMPLE'), 'secret-in-diff'), false],
    ['a context line is not flagged', has(scanDiffForSecrets(' AKIAIOSFODNN7EXAMPLE'), 'secret-in-diff'), false],
    ['an ordinary word is not flagged', has(scanDiffForSecrets('+const password = getPasswordPrompt();'), 'secret-in-diff'), false],
    ['the word token in prose is not flagged', has(scanDiffForSecrets('+// the token is a signed JWT'), 'secret-in-diff'), false],
    ['a property access is not flagged', has(scanDiffForSecrets('+  token: response.token,'), 'secret-in-diff'), false],
    ['a call result is not flagged', has(scanDiffForSecrets('+  const apiKey = readApiKeyFromEnv();'), 'secret-in-diff'), false],
    ['an all-letter assignment is not flagged', has(scanDiffForSecrets('+  password: mySuperSecretPassword,'), 'secret-in-diff'), false],
    ['a high-entropy hex value IS flagged', has(scanDiffForSecrets('+  api_key = a3f5b7c9d1e2f4a6b8c0'), 'secret-in-diff'), true],
    ['a quoted jwt IS flagged', has(scanDiffForSecrets('+  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"'), 'secret-in-diff'), true],
  ];

  let failed = 0;
  for (const [name, got, want] of cases) {
    const ok = got === want;
    if (!ok) failed++;
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} self-tests pass`);
  return failed === 0 ? 0 : 1;
}

// ── Output ──────────────────────────────────────────────────────────────────

const SEV = { fail: '❌', warn: '⚠️' };

function printSummary(result) {
  console.log('Repository Hygiene Check');
  console.log('─'.repeat(60));
  const s = result.stats;
  console.log(`Tracked ${s.tracked} · untracked ${s.untracked} · dirty ${s.dirty} · SYSTEM_PATHS ${s.systemPaths} · user layer ${s.userLayer}`);
  if (result.partial) {
    console.log('');
    for (const note of result.skipped) console.log(`  ℹ️  ${note}`);
  }
  console.log('');
  if (!result.findings.length) {
    console.log('  ✅ no findings — system files registered, user layer untracked, no secrets pending');
    return;
  }
  const byCode = {};
  for (const f of result.findings) (byCode[f.code] ||= []).push(f);
  for (const [code, list] of Object.entries(byCode)) {
    console.log(`  ${SEV[list[0].severity]} ${code} (${list.length})`);
    for (const f of list.slice(0, 10)) {
      console.log(`       ${f.target} — ${f.detail}`);
    }
    if (list.length > 10) console.log(`       … and ${list.length - 10} more`);
  }
}

function usage() {
  return [
    'Usage: node verify-repo-hygiene.mjs [--json] [--strict] [--self-test]',
    '',
    '  --json       machine-readable',
    '  --strict     treat warnings as failures',
    '  --self-test  run the rule self-tests',
    '  -h, --help   this message',
  ].join('\n');
}

export function runCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--self-test') return runSelfTest();
  if (args.includes('-h') || args.includes('--help')) { console.log(usage()); return 0; }

  let result;
  try {
    result = verify();
  } catch (err) {
    if (err && err.setup) { console.error(`ERROR: ${err.message}`); return 2; }
    throw err;
  }

  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else printSummary(result);

  if (result.verdict === 'block') return 1;
  if (args.includes('--strict') && result.findings.length) return 1;
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runCli();
}
