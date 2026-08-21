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
 * Tests 4-11 cover `stagedPathsOutside`, the guard that decides when committing the
 * index is equivalent to the scoped commit and therefore safe (#915 bug 2).
 * Tests 9-11 pin the #2337 preserved-file case, with its own negative control.
 *
 * Behavioural rather than source-pattern, driven against a throwaway repo through
 * the git-runner seam — same approach as tests/updater-rollback-behavior.test.mjs.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, gitRawIn, stagedPathsOutside } from '../update-system.mjs';

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
  // stagedPathsOutside needs the RAW runner: gitIn trims, which would strip a
  // leading space off a path and defeat the very case test 7 pins.
  const raw = (...args) => gitRawIn(dir, ...args);
  return { dir, g, raw };
}

const modeOf = (g, ref, path) => g('ls-tree', ref, '--', path).split(/\s+/)[0];

// Commit a file, then stage the executable bit the way `git checkout
// FETCH_HEAD -- <path>` does during an update: index only, working tree untouched.
function repoWithStagedModeBump(name) {
  const { dir, g, raw } = makeRepo();
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

// ── 4-6. stagedPathsOutside: the guard that keeps #915 bug 2 fixed ─────
{
  const { dir, g, raw } = makeRepo();
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

  const clean = stagedPathsOutside(['providers/', 'scan.mjs'], [], raw);
  if (clean.length === 0) pass('stagedPathsOutside: update-owned paths only → safe to commit the index');
  else fail(`expected none outside, got [${clean}]`);

  const dirCovered = stagedPathsOutside(['providers/'], [], raw);
  if (dirCovered.length === 1 && dirCovered[0] === 'scan.mjs') {
    pass('stagedPathsOutside: a directory entry covers files beneath it');
  } else {
    fail(`directory coverage wrong, got [${dirCovered}]`);
  }

  // A user's unrelated staged file must force the scoped fallback — this is the
  // regression #915 bug 2 fixed, and the reason the index path is guarded.
  writeFileSync(join(dir, 'cv.md'), 'user edit\n');
  g('add', 'cv.md');

  const withUser = stagedPathsOutside(['providers/', 'scan.mjs'], [], raw);
  if (withUser.includes('cv.md')) {
    pass('stagedPathsOutside: an unrelated staged file is reported, forcing the scoped commit');
  } else {
    fail(`unrelated staged file not detected, got [${withUser}]`);
  }

  rmSync(dir, { recursive: true, force: true });
}

// ── 7. Path names are preserved exactly (raised in PR review) ──────────
// A staged path with a leading space must NOT be normalised into a different
// one. Trimming would turn ` scan.mjs` into `scan.mjs`, match the owned entry,
// and silently sweep a user's file into the update commit — #915 bug 2
// reintroduced through the guard that exists to preserve it.
{
  const { dir, g, raw } = makeRepo();
  writeFileSync(join(dir, 'scan.mjs'), 'x\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  writeFileSync(join(dir, ' scan.mjs'), 'user file, leading space\n');
  g('add', '--', ' scan.mjs');

  const outside = stagedPathsOutside(['scan.mjs'], [], raw);
  if (outside.includes(' scan.mjs')) {
    pass('stagedPathsOutside: a leading-space path is not normalised into an owned one');
  } else {
    fail(`leading-space path mangled or matched; got ${JSON.stringify(outside)}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 8. Nothing staged at all ───────────────────────────────────────────
{
  const { dir, g, raw } = makeRepo();
  writeFileSync(join(dir, 'a.mjs'), 'x\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  if (stagedPathsOutside(['a.mjs'], [], raw).length === 0) {
    pass('stagedPathsOutside: empty index → nothing outside');
  } else {
    fail('empty index should report nothing outside');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ── 9-11. A PRESERVED file under an update-owned directory (PR review) ─
// #2337 leaves system files this install modified locally alone, expressed as
// `:(exclude)<path>` pathspecs. Those pathspecs match no staged path, so handing
// them to the guard as owned entries left the enclosing owned directory
// (`providers/`) still claiming the preserved file — the guard reported nothing
// unrelated, the bare index commit was selected, and the content the user asked
// to keep went into it under "chore: auto-update system files". That is #915
// bug 2 back, through the guard that exists to prevent it.
//
// Test 9 is the NEGATIVE CONTROL: it drives the guard the OLD way (exclusion
// pathspecs as owned entries, no preserved list) and shows the sweep, so 11 and
// 12 demonstrate a fix rather than describe an absence.
{
  const { dir, g, raw } = makeRepo();
  mkdirSync(join(dir, 'providers'));
  writeFileSync(join(dir, 'providers/acme.mjs'), 'local provider v1\n');
  writeFileSync(join(dir, 'providers/greenhouse.mjs'), 'upstream v1\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  // The user's local edit to the preserved file, already staged when the update
  // runs; plus a genuine update to another file under the same owned directory.
  writeFileSync(join(dir, 'providers/acme.mjs'), 'user local edit\n');
  writeFileSync(join(dir, 'providers/greenhouse.mjs'), 'upstream v2\n');
  g('add', 'providers/acme.mjs', 'providers/greenhouse.mjs');

  // Exactly how apply() builds them.
  const updated = ['providers/'];
  const preservedPaths = ['providers/acme.mjs'];
  const preserveSpecs = preservedPaths.map((f) => `:(exclude)${f}`);
  const pathsToStage = [...updated, ...preserveSpecs];

  const oldWay = stagedPathsOutside(pathsToStage, [], raw);
  if (oldWay.length === 0) {
    pass('negative control: exclusion pathspecs as owned entries hide the preserved file → bare index commit');
  } else {
    fail(`negative control did not reproduce — expected none outside, got [${oldWay}]`);
  }

  const ownedPaths = pathsToStage.filter((spec) => !spec.startsWith(':(exclude)'));
  const fixed = stagedPathsOutside(ownedPaths, preservedPaths, raw);
  if (fixed.includes('providers/acme.mjs')) {
    pass('stagedPathsOutside: a staged preserved file is unrelated despite its owned parent directory');
  } else {
    fail(`preserved file not reported, got [${fixed}]`);
  }

  // The guard's whole purpose: non-empty ⇒ apply() takes the path-scoped commit,
  // whose pathspec carries the exclusion, so the preserved content stays out.
  const usedIndexCommit = fixed.length === 0;
  g('commit', '-qm', 'chore: auto-update system files to v9.9.9', ...(usedIndexCommit ? [] : ['--', ...pathsToStage]));
  const committed = g('show', '--name-only', '--format=', 'HEAD').split('\n').map(s => s.trim()).filter(Boolean);

  if (!usedIndexCommit && committed.includes('providers/greenhouse.mjs') && !committed.includes('providers/acme.mjs')) {
    pass('path-scoped commit is selected, and the preserved file stays out of the update commit');
  } else {
    fail(`usedIndexCommit=${usedIndexCommit}, committed [${committed}]`);
  }
  rmSync(dir, { recursive: true, force: true });
}
