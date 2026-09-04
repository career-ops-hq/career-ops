/**
 * mjs-files.mjs — the one definition of "every .mjs file in this repository".
 *
 * Two things syntax-check this repo: `scripts/check-syntax.mjs` (run as
 * `npm run lint`) and section 1 of `test-all.mjs`. They used to disagree about
 * what "every file" meant, and only one of them said so.
 *
 * `test-all.mjs` read the repository root with a NON-recursive `readdirSync`,
 * so its gate covered 121 of the ~575 `.mjs` files here — and it printed one
 * `{file} syntax OK` line per file, so a reader watching 121 green lines had no
 * way to tell that the directory holding 263 of them was never opened. Worse,
 * the gate NARROWED every time a file moved out of the root and never
 * mentioned it: #3306 moved eleven suites into `tests/` and #3388 moved nine,
 * and each one silently left the gate. The shortfall was eventually noticed
 * only as a two-check arithmetic discrepancy in an unrelated PR (#3411), which
 * is not a way to find out (#3419).
 *
 * Sharing the walker is the fix rather than copying the recursion into
 * `test-all.mjs`: two independently maintained definitions of the same set is
 * exactly the drift that caused this, and a second copy would be free to
 * re-diverge the next time one of them learned about a directory.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Directories excluded from the walk BY NAME.
 *
 * `.git` and `node_modules` are not repository source. `output`, `data`,
 * `coverage` and `test-results` hold generated or user content, so including
 * them would make the result depend on what a given checkout happens to have
 * run — a clean clone and a working install would disagree about how many
 * files were checked, and a stray `.mjs` dropped in `output/` could fail the
 * lint of a repository whose source is fine.
 *
 * A name is not enough to keep git's storage out on its own — see
 * `isNestedCheckout` below, which the walk also consults.
 */
export const SKIP_DIRS = new Set(['.git', 'node_modules', 'output', 'data', 'coverage', 'test-results']);

/**
 * Is `dir` a checkout of its own, rather than a subdirectory of this one?
 *
 * `SKIP_DIRS` drops a directory *named* `.git`, which is the whole of git's
 * storage in a normal clone — and none of it in a linked worktree, which marks
 * itself with a `.git` FILE pointing at the parent's gitdir. So the one
 * exclusion meant to keep git out of the walk slid straight past a worktree and
 * the walkers descended into a complete second copy of the repository, at
 * whatever commit that worktree happened to sit on: 1097 files reported in a
 * 576-file checkout (#3499).
 *
 * The consequences differed per consumer, which is what made it hard to see.
 * The syntax gates silently checked ~2x the files and reported a count that
 * depended on whether the developer had a worktree open;
 * `tests/local-today-gates.test.mjs` failed outright, naming *correct* source
 * files as violations because the stale copies predated the convention;
 * `tests/main-guard-convention.test.mjs` passed, because the stale copy
 * happened to satisfy that particular convention. A contributor got a red suite
 * for a commit they did not write, or a green one that checked the wrong tree —
 * the exact "gate covering a file set nobody chose" failure this module exists
 * to remove (#3306, #3388, #3411, #3419).
 *
 * Detecting the marker rather than the name is both narrower and broader than
 * blanket-ignoring `.claude/worktrees/` (Claude Code's default location, which
 * is how this was found): it holds for a worktree placed anywhere, and it costs
 * nothing for a checkout that has none.
 *
 * Any `.git` entry counts, of either type. A `.git` file is a linked worktree
 * or a submodule; a `.git` directory below the root is a nested independent
 * clone. All three are somebody else's source tree that happens to sit inside
 * this one, and none of them is a file this repository's gates should be
 * grading.
 *
 * NOT applied to the walk root. The root's own `.git` is what makes it the
 * repository, and this predicate is deliberately blind to how the root is
 * stored — running the gate from inside a linked worktree (`.git` is a file
 * there too) must check that worktree's source, not skip all of it and report a
 * passing scan of nothing.
 *
 * @param {string} dir - Absolute path to a directory found below the walk root.
 * @returns {boolean} True if `dir` carries its own git marker.
 */
export function isNestedCheckout(dir) {
  return existsSync(join(dir, '.git'));
}

/**
 * Every `.mjs` file under `root`, recursively, sorted by full path.
 *
 * Sorted because both callers report per-file results in iteration order and a
 * run-to-run reordering of that output is noise in a diff — the readdir order
 * is not guaranteed across platforms or filesystems.
 *
 * @param {string} root - Absolute path to walk.
 * @returns {string[]} Absolute paths, lexicographically sorted.
 */
export function collectMjsFiles(root) {
  const files = [];

  // `isRoot` exists because ENOENT means two different things here and only one
  // of them is survivable.
  //
  // Below the root it is a race: readdir listed a directory, and it was gone by
  // the time we recursed into it — a concurrent `git checkout`, a branch
  // switch, a test tearing down a temp tree. The directory genuinely no longer
  // exists, so there is nothing to check in it, and aborting a whole lint run
  // over a directory that has ceased to be helps nobody. Deliberately untested:
  // the branch is reachable only by winning a race against readdir, and the
  // in-process attempt at forcing it (patching `fs.readdirSync` after this
  // module has already bound the named import) passes with the branch removed —
  // a test asserting nothing is worse than no test.
  //
  // AT the root it is not a race, it is a bad argument, and swallowing it would
  // return an empty list — so the syntax gate would report "0 .mjs files" and
  // pass, having checked nothing. That is the exact failure shape this module
  // was written to remove (#3419), and it would be strictly worse than the bug
  // it replaced. A missing root throws.
  const walk = (dir, isRoot) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err?.code === 'ENOENT' && !isRoot) return;
      throw err;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Symlinked directories can point outside the checkout or back into it;
      // neither should make the walk recurse unpredictably.
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isNestedCheckout(full)) continue;
        walk(full, false);
      } else if (entry.name.endsWith('.mjs')) files.push(full);
    }
  };
  walk(root, true);
  return files.sort();
}
