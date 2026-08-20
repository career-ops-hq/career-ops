/**
 * updater-rollback-behavior.test.mjs — BEHAVIORAL rollback tests (#2015 follow-up).
 *
 * The rest of updater-migration-tests.mjs verifies the updater by source-pattern
 * assertions (the file's convention, because apply()/revertPaths are ROOT-bound
 * with heavy side effects). This file drives the real `removeAdditionsNotInHead`
 * export against a throwaway git repo via the git-runner seam, so it verifies the
 * rollback *behaves* right — the property that actually protects user data — not
 * just that the code reads right (@FReptar0 + CodeRabbit review of #2110).
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, removeAdditionsNotInHead, staleSystemFiles } from '../update-system.mjs';

// A throwaway git repo plus a ctx that binds the rollback helper's git runner
// and filesystem root to it, so nothing touches the real working tree.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'co-rollback-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  // `gitIn` inherits the environment, so the contributor's GLOBAL git config
  // applies inside this throwaway repo. With `commit.gpgsign = true` set
  // globally (1Password's ssh signer, gpg-agent, a hardware key) every commit
  // below fails, and because these are execFileSync calls the failure is not a
  // red assertion: the process DIES here and every later section of the suite
  // silently never runs, so `Results:` never prints (#2754). A global
  // `core.hooksPath` breaks it the same way.
  //
  // The sibling fixture in updater-local-system-edits.test.mjs has carried
  // these two lines since a CodeRabbit review flagged the same thing; this one
  // was left behind, which is why the failure looks environment-specific
  // instead of structural.
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  return { dir, g, ctx: { git: g, root: dir } };
}

// Paths currently staged as changes vs HEAD — the snapshot apply() takes as
// `initialStatusPaths` before it mutates anything.
function stagedPaths(g) {
  return new Set(g('diff', '--cached', '--name-only', 'HEAD').split('\n').filter(Boolean));
}

console.log('\n🧪 Testing updater rollback behavior (#2015)...');

// ── 0. system-file pruning is complete but user-safe (#2532) ──
{
  const local = ['plugins-registry.json', 'tests/old.test.mjs', 'data/applications.md', 'scratch.txt'];
  const remote = ['tests/new.test.mjs', 'data/applications.md'];
  const system = ['plugins-registry.json', 'tests/', 'data/'];
  const user = ['data/'];
  const stale = staleSystemFiles(local, remote, system, user);
  if (stale.length === 2 && stale.includes('plugins-registry.json') && stale.includes('tests/old.test.mjs')) {
    pass('stale system pruning removes upstream-deleted root files and system descendants');
  } else {
    fail(`stale system pruning selected the wrong files: ${JSON.stringify(stale)}`);
  }
  if (staleSystemFiles(local, [], system, user).length === 0) {
    pass('stale system pruning never treats an empty remote tree as a delete-all signal');
  } else {
    fail('stale system pruning would delete files from an empty remote tree');
  }

  const userDeleted = staleSystemFiles(
    ['data/applications.md', 'tests/old.test.mjs'],
    ['tests/new.test.mjs'],
    ['tests/', 'data/'],
    ['data/'],
  );
  if (userDeleted.includes('tests/old.test.mjs') && !userDeleted.includes('data/applications.md')) {
    pass('stale system pruning excludes an upstream-deleted user-layer file');
  } else {
    fail(`stale system pruning would select a user-layer file: ${JSON.stringify(userDeleted)}`);
  }
}

// ── 1. protectedPaths: a user's pre-staged work survives a rollback ──
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/OLD.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // Before any update: the user has their own staged addition AND a staged
  // modification under the docs/ system pathspec.
  writeFileSync(join(dir, 'docs/USER.md'), 'user work');
  writeFileSync(join(dir, 'docs/OLD.md'), 'user edit');
  g('add', 'docs/USER.md', 'docs/OLD.md');
  const protectedPaths = stagedPaths(g);

  // The update then stages a brand-new file under the same directory pathspec.
  writeFileSync(join(dir, 'docs/NEW.md'), 'from update');
  g('add', 'docs/NEW.md');

  // Roll back the docs/ pathspec.
  removeAdditionsNotInHead('docs/', protectedPaths, ctx);

  if (!existsSync(join(dir, 'docs/NEW.md'))) {
    pass('rollback removes the addition the update introduced (docs/NEW.md)');
  } else {
    fail('rollback left the update addition docs/NEW.md behind');
  }
  if (existsSync(join(dir, 'docs/USER.md'))) {
    pass('rollback preserves the user\'s pre-staged addition (protectedPaths)');
  } else {
    fail('rollback DESTROYED the user\'s pre-staged docs/USER.md — data loss');
  }
  if (existsSync(join(dir, 'docs/OLD.md'))) {
    pass('rollback preserves the user\'s pre-staged modification');
  } else {
    fail('rollback destroyed the user\'s staged modification docs/OLD.md');
  }
  // The index no longer carries the update's addition, but still carries the
  // user's staged work.
  const staged = stagedPaths(g);
  if (!staged.has('docs/NEW.md') && staged.has('docs/USER.md') && staged.has('docs/OLD.md')) {
    pass('index reflects only the update addition being unstaged');
  } else {
    fail(`index wrong after rollback: ${[...staged].join(', ')}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 2. --diff-filter=A: a merely modified file is never removed ──
{
  const { dir, g, ctx } = makeRepo();
  mkdirSync(join(dir, 'modes'));
  writeFileSync(join(dir, 'modes/a.md'), 'v1');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // A staged MODIFICATION (not an addition) and a staged ADDITION, no protection.
  writeFileSync(join(dir, 'modes/a.md'), 'v2');
  writeFileSync(join(dir, 'modes/b.md'), 'new');
  g('add', '-A');

  removeAdditionsNotInHead('modes/', new Set(), ctx);

  if (existsSync(join(dir, 'modes/a.md'))) {
    pass('rollback never deletes a modified file (only additions are targeted)');
  } else {
    fail('rollback deleted a modified file — --diff-filter=A guard failed');
  }
  if (!existsSync(join(dir, 'modes/b.md'))) {
    pass('rollback removes an unprotected addition');
  } else {
    fail('rollback left an unprotected addition behind');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 3. a single-file pathspec is handled like a directory one ──
{
  const { dir, g, ctx } = makeRepo();
  writeFileSync(join(dir, 'seed.txt'), 'x');
  g('add', '-A');
  g('commit', '-qm', 'base');

  writeFileSync(join(dir, 'browser-extract.mjs'), 'added by update');
  g('add', 'browser-extract.mjs');

  removeAdditionsNotInHead('browser-extract.mjs', new Set(), ctx);

  if (!existsSync(join(dir, 'browser-extract.mjs'))) {
    pass('rollback removes an added file for a file pathspec');
  } else {
    fail('rollback left an added file for a file pathspec');
  }
  rmSync(dir, { recursive: true, force: true });
}
