/**
 * updater-commit-file-modes.test.mjs — the update commit must not drop file modes.
 *
 * `git commit -m … -- <pathspec>` builds the commit from the WORKING TREE for
 * those paths rather than from the index. Where `core.fileMode` is false — the
 * default on Windows — the working tree cannot express the executable bit, so a
 * mode change that `git checkout FETCH_HEAD -- <path>` staged is dropped from the
 * commit and left behind in the index. The install is dirty the moment a "clean"
 * update finishes, and every later update re-stages and re-drops the same bit.
 *
 * Test 1 is the NEGATIVE CONTROL: it reproduces that loss with the pathspec form,
 * so tests 2 and 3 are demonstrating a fix rather than describing an absence.
 * Tests 4-7 cover `stagedPathsOutside`, the guard that decides when committing the
 * index is equivalent to the scoped commit and therefore safe (#915 bug 2).
 *
 * Behavioural rather than source-pattern, driven against a throwaway repo through
 * the git-runner seam — same approach as tests/updater-rollback-behavior.test.mjs.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, stagedPathsOutside } from '../update-system.mjs';

// A throwaway repo pinned to core.fileMode=false, which is what makes the bug
// reachable. On a filesystem that records the executable bit this setting is what
// Windows checkouts get by default; forcing it makes the test meaningful on every
// platform instead of passing vacuously on Linux and macOS.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'co-filemode-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'core.fileMode', 'false');
  return { dir, g };
}

const modeOf = (g, ref, path) => g('ls-tree', ref, '--', path).split(/\s+/)[0];

// Commit a file, then stage the executable bit the way `git checkout
// FETCH_HEAD -- <path>` does during an update: index only, working tree untouched.
function repoWithStagedModeBump(name) {
  const { dir, g } = makeRepo();
  writeFileSync(join(dir, name), 'console.log(1)\n');
  g('add', name);
  g('commit', '-qm', 'base');
  g('update-index', '--chmod=+x', name);
  return { dir, g };
}

console.log('\n🧪 Testing update-commit file-mode preservation...');

// ── 1. NEGATIVE CONTROL: the pathspec form loses the mode ──────────────
{
  const { dir, g } = repoWithStagedModeBump('tool.mjs');
  try {
    g('commit', '-qm', 'scoped', '--', 'tool.mjs');
  } catch {
    // "nothing to commit" for this pathspec — itself the bug, so not a failure here.
  }
  const committed = modeOf(g, 'HEAD', 'tool.mjs');
  const stillStaged = g('diff', '--cached', '--name-only').split('\n').filter(Boolean);

  if (committed === '100644' && stillStaged.includes('tool.mjs')) {
    pass('negative control: pathspec commit drops the staged mode and leaves the index dirty');
  } else {
    fail(`negative control did not reproduce — committed ${committed}, staged [${stillStaged}]`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 2. The index-based commit preserves the mode ───────────────────────
{
  const { dir, g } = repoWithStagedModeBump('tool.mjs');
  g('commit', '-qm', 'index-based');

  if (modeOf(g, 'HEAD', 'tool.mjs') === '100755') {
    pass('index commit records the executable bit the update staged');
  } else {
    fail(`index commit recorded ${modeOf(g, 'HEAD', 'tool.mjs')}, expected 100755`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 3. …and leaves the tree clean, which is the user-visible symptom ───
{
  const { dir, g } = repoWithStagedModeBump('tool.mjs');
  g('commit', '-qm', 'index-based');

  const dirty = g('status', '--porcelain').split('\n').filter(Boolean);
  if (dirty.length === 0) {
    pass('working tree is clean after the update commit');
  } else {
    fail(`tree still dirty after commit: ${dirty.join(' | ')}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 4-7. stagedPathsOutside: the guard that keeps #915 bug 2 fixed ─────
{
  const { dir, g } = makeRepo();
  mkdirSync(join(dir, 'providers'));
  writeFileSync(join(dir, 'providers/acme.mjs'), 'x\n');
  writeFileSync(join(dir, 'scan.mjs'), 'x\n');
  writeFileSync(join(dir, 'cv.md'), 'personal\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // Only update-owned paths staged.
  writeFileSync(join(dir, 'providers/acme.mjs'), 'updated\n');
  writeFileSync(join(dir, 'scan.mjs'), 'updated\n');
  g('add', 'providers/acme.mjs', 'scan.mjs');

  const clean = stagedPathsOutside(['providers/', 'scan.mjs'], g);
  if (clean.length === 0) pass('stagedPathsOutside: update-owned paths only → safe to commit the index');
  else fail(`expected none outside, got [${clean}]`);

  const dirCovered = stagedPathsOutside(['providers/'], g);
  if (dirCovered.length === 1 && dirCovered[0] === 'scan.mjs') {
    pass('stagedPathsOutside: a directory entry covers files beneath it');
  } else {
    fail(`directory coverage wrong, got [${dirCovered}]`);
  }

  // A user's unrelated staged file must force the scoped fallback — this is the
  // regression #915 bug 2 fixed, and the reason the index path is guarded.
  writeFileSync(join(dir, 'cv.md'), 'user edit\n');
  g('add', 'cv.md');

  const withUser = stagedPathsOutside(['providers/', 'scan.mjs'], g);
  if (withUser.includes('cv.md')) {
    pass('stagedPathsOutside: an unrelated staged file is reported, forcing the scoped commit');
  } else {
    fail(`unrelated staged file not detected, got [${withUser}]`);
  }

  rmSync(dir, { recursive: true, force: true });
}

// ── 8. Nothing staged at all ───────────────────────────────────────────
{
  const { dir, g } = makeRepo();
  writeFileSync(join(dir, 'a.mjs'), 'x\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  if (stagedPathsOutside(['a.mjs'], g).length === 0) {
    pass('stagedPathsOutside: empty index → nothing outside');
  } else {
    fail('empty index should report nothing outside');
  }
  rmSync(dir, { recursive: true, force: true });
}
