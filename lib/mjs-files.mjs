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

import { readdirSync } from 'fs';
import { join } from 'path';

/**
 * Directories excluded from the walk.
 *
 * `.git` and `node_modules` are not repository source. `output`, `data`,
 * `coverage` and `test-results` hold generated or user content, so including
 * them would make the result depend on what a given checkout happens to have
 * run — a clean clone and a working install would disagree about how many
 * files were checked, and a stray `.mjs` dropped in `output/` could fail the
 * lint of a repository whose source is fine.
 */
export const SKIP_DIRS = new Set(['.git', 'node_modules', 'output', 'data', 'coverage', 'test-results']);

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
      if (entry.isDirectory()) walk(full, false);
      else if (entry.name.endsWith('.mjs')) files.push(full);
    }
  };
  walk(root, true);
  return files.sort();
}
