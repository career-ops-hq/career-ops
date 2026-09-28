// tests/gitignore-symlink-escape.test.mjs
//
// A trailing slash in .gitignore restricts the rule to directories, so a
// SYMLINK carrying that name is not ignored and `git add -A` stages it.
//
// `node_modules` is where this bites. A git worktree has no node_modules of its
// own, so the standard move is to symlink it from the main checkout, and that
// symlink then looks like an ordinary untracked path to git. It reached a PR
// here as a mode 120000 blob and reddened the `test` job on every platform:
// validate-system-paths-coverage.mjs walks `git ls-files` and requires each
// tracked path to be claimed in update-system.mjs, and node_modules is claimed
// by neither SYSTEM_PATHS nor USER_PATHS. The report names an unclaimed system
// path, which sends the contributor to the wrong file entirely.
//
// Measured before the fix, in a throwaway repo whose only rule was
// `node_modules/`: `git check-ignore -v node_modules` exited 1 against a
// symlink and 0 against a real directory.

import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, warn, rmSync, ROOT } from './helpers.mjs';

console.log('\n🔗 .gitignore rules cover a symlink of that name');

// ── The rule itself, checked statically so this runs everywhere ──────────────
{
  const lines = readFileSync(join(ROOT, '.gitignore'), 'utf-8').split('\n').map((l) => l.trim());
  const covers = lines.some((l) => l === 'node_modules');
  const dirOnly = lines.some((l) => l === 'node_modules/');
  if (covers && !dirOnly) pass('.gitignore ignores node_modules whatever its file type');
  else if (dirOnly) fail('.gitignore still carries the directory-only `node_modules/`, so a symlink escapes it');
  else fail('.gitignore has no node_modules rule at all');
}

// ── And behaviourally, against the real file git actually reads ──────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'gitignore-symlink-'));
  try {
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), readFileSync(join(ROOT, '.gitignore'), 'utf-8'));
    mkdirSync(join(dir, 'realdir'));

    let linked = true;
    try {
      symlinkSync('realdir', join(dir, 'node_modules'));
    } catch (err) {
      // Windows refuses symlinks without the privilege, which is an environment
      // gap rather than a defect. The static check above still ran.
      linked = false;
      warn(`symlink probe skipped (${err.code}) — the static rule check above still applies`);
    }

    const ask = (p) => spawnSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: dir }).status;

    // A gate that cannot report "not ignored" would pass this file no matter
    // what the rule said. Prove it can, before trusting the assertion below.
    if (ask('definitely-not-ignored.txt') === 1) pass('control: check-ignore reports an unignored path as unignored');
    else fail('control failed: check-ignore did not report an unignored path, so the probe below proves nothing');

    if (linked) {
      if (ask('node_modules') === 0) pass('a symlink named node_modules is ignored');
      else fail('a symlink named node_modules is NOT ignored — `git add -A` would stage it');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
