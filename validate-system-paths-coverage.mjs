#!/usr/bin/env node

/**
 * validate-system-paths-coverage.mjs — structural coverage check for the
 * auto-updater layer split.
 *
 * Every tracked file in the repo must be covered by either SYSTEM_PATHS
 * (system layer, fetched on `update-system.mjs apply`) or USER_PATHS
 * (user-owned, never touched). Anything else is a coverage gap: it
 * lives in the repo but the auto-updater won't propagate it to
 * clients on `apply`. That breaks them on the next test run.
 *
 * Run: node validate-system-paths-coverage.mjs
 * Exit 0 = clean. Exit 1 = orphan files listed.
 */

import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extractArrayFromSource, localUserPaths, LOCAL_PATHS_FILE } from './update-system.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(ROOT, 'update-system.mjs');

if (!existsSync(sourcePath)) {
  console.error('FAIL: update-system.mjs not found');
  process.exit(1);
}

const source = readFileSync(sourcePath, 'utf-8');

const SYSTEM_PATHS = extractArrayFromSource(source, 'SYSTEM_PATHS');
const USER_PATHS = extractArrayFromSource(source, 'USER_PATHS');

if (SYSTEM_PATHS.length === 0 || USER_PATHS.length === 0) {
  console.error('FAIL: SYSTEM_PATHS or USER_PATHS not found in update-system.mjs');
  process.exit(1);
}
// Paths a fork declared as its own in the gitignored local file (#2421).
// Without these, a tracked fork-local file (a nightly runner, an .mcp.json)
// is an orphan here and fails the whole suite, and the only fix is to edit
// USER_PATHS inside update-system.mjs — the file `apply` overwrites and git
// re-merges on every sync. A malformed declaration fails loudly: this guard
// exists to be trustworthy, so it must never fall back to a partial view.
let LOCAL_PATHS;
try {
  LOCAL_PATHS = localUserPaths(ROOT);
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
}

const ALL_PATHS = [...SYSTEM_PATHS, ...USER_PATHS, ...LOCAL_PATHS];

const EXCLUDES = [
  '.coderabbit.yaml',
  '.editorconfig',
  '.envrc',
  '.npmignore',
  '.release-please-manifest.json',
  'release-please-config.json',
  'renovate.json',
  'flake.lock',
  'flake.nix',
  'batch/logs/.gitkeep',
  'batch/tracker-additions/.gitkeep',
  'interview-prep/.gitkeep',
];

// .gitignore is excluded from the manifest but NOT from installs, and the
// difference is the whole of #2756. It cannot join SYSTEM_PATHS: it is the one
// system file users also write to, so the raw `git checkout` that ships every
// other path would delete their own rules. It reaches installs by a different
// route instead — update-system.mjs's reconcileGitignore(), which appends the
// system-owned rules an install is missing and touches nothing else.
//
// Kept in its own group rather than folded in above, because the entries above
// genuinely never reach an install and this one does. Reading it as the same
// kind of exclusion is what let 43 releases' worth of new ignore rules stay in
// this repository only, leaving a candidate's CV stageable in every fork.
const RECONCILED_NOT_CHECKED_OUT = ['.gitignore'];

// Trees that live in the repo but deliberately OUTSIDE the updater's world:
// web/ is the experimental web UI — its own release-please component, never
// shipped by update-system.mjs, never in the npm package. Excluding it here is
// part of that isolation contract, not a coverage gap.
const EXCLUDE_PREFIXES = ['web/'];

function covered(file) {
  // If explicitly excluded, it is covered
  if (EXCLUDES.includes(file)) return true;
  if (RECONCILED_NOT_CHECKED_OUT.includes(file)) return true;
  if (EXCLUDE_PREFIXES.some((p) => file.startsWith(p))) return true;

  return ALL_PATHS.some((path) =>
    path.endsWith('/') ? file.startsWith(path) : file === path,
  );
}

if (process.argv.includes('--self-test')) {
  console.log('Running validate-system-paths-coverage.mjs self-tests...');
  
  const assert = (condition, message) => {
    if (!condition) {
      console.error(`FAIL: ${message}`);
      process.exit(1);
    }
  };

  // Test explicitly excluded files
  assert(covered('.gitignore') === true, '.gitignore must be covered (excluded)');
  assert(covered('.coderabbit.yaml') === true, '.coderabbit.yaml must be covered (excluded)');
  assert(covered('.editorconfig') === true, '.editorconfig must be covered (excluded, #1438/#1613)');

  // Test exact matches in SYSTEM_PATHS / USER_PATHS
  assert(covered('CLAUDE.md') === true, 'CLAUDE.md must be covered (exact match)');
  assert(covered('.claude/settings.json') === true, '.claude/settings.json must be covered (USER_PATHS exact match, #1408)');
  assert(covered('.claude/hooks/pre-push-backup.sh') === true, '.claude/hooks/ scripts must be covered (USER_PATHS dir prefix match, same class as #1408)');

  // Test directory prefix matches (which end in '/')
  assert(covered('providers/justjoin.mjs') === true, 'providers/justjoin.mjs must be covered (dir prefix match)');

  // Test sibling mismatch (strict prefix match)
  assert(covered('providers-sibling/justjoin.mjs') === false, 'providers-sibling/justjoin.mjs must NOT be covered');
  assert(covered('web/package.json') === true, 'web/ tree must be covered (isolation-contract prefix exclude)');
  assert(covered('web-dashboard/index.html') === false, 'web-dashboard/ must NOT ride the web/ prefix exclude');
  assert(covered('.npmignore') === true, '.npmignore must be covered (excluded)');

  // Test unrelated file
  assert(covered('untracked-orphan-file-xyz.js') === false, 'untracked-orphan-file-xyz.js must NOT be covered');

  console.log('ALL SELF-TESTS PASSED');
  process.exit(0);
}

let tracked;
try {
  tracked = execFileSync('git', ['ls-files'], {
    cwd: ROOT,
    encoding: 'utf-8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
} catch (err) {
  console.error('FAIL: git ls-files failed:', err.message);
  process.exit(1);
}

// An empty file list is NOT "nothing to check" — it means this run could not
// inspect anything, and reporting success would make the guard a no-op.
//
// That is exactly what happened for as long as this check has existed. test-all
// runs the scripts from a throwaway copy created *inside* the repo, and
// `git ls-files` from an untracked subdirectory returns zero paths. So CI printed
// "OK: 0 tracked files covered" and exited 0 while the real tree had an
// unregistered top-level file. A file missing from SYSTEM_PATHS is not cosmetic:
// `update-system` never ships it, so every user who updates silently loses it.
// This bug class has landed five times (#649, #704, .editorconfig, and twice
// since) and the guard meant to stop it was green throughout.
//
// A check that cannot look must fail, not pass.
if (tracked.length === 0) {
  console.error('FAIL: git ls-files returned no paths — this run could not inspect anything.');
  console.error('');
  console.error('Run this from the repository root. An empty listing usually means the');
  console.error('script was invoked from an untracked directory (a temp copy, a fixture');
  console.error('dir), where git reports nothing and the coverage check is meaningless.');
  process.exit(1);
}

const orphans = tracked.filter((f) => !covered(f));

if (orphans.length > 0) {
  console.error('Coverage gap — tracked files not in SYSTEM_PATHS or USER_PATHS:');
  for (const orphan of orphans) console.error(`  ${orphan}`);
  console.error('');
  console.error('Add each path to update-system.mjs SYSTEM_PATHS (if system layer)');
  console.error('or USER_PATHS (if user-owned), then re-run this check.');
  process.exit(1);
}

console.log(`OK: ${tracked.length} tracked files covered by SYSTEM_PATHS or USER_PATHS`);
process.exit(0);
