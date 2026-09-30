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

import { walkTree } from './walk-tree.mjs';

// Re-exported so the historical import site keeps working; `lib/walk-tree.mjs`
// owns the predicate now, because the walk that consults it lives there.
export { isNestedCheckout } from './walk-tree.mjs';

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
 * `isNestedCheckout` in `lib/walk-tree.mjs`, which the walk consults on every
 * descent whether a caller remembers it or not.
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
  return walkTree(root, {
    skip: (entry) => SKIP_DIRS.has(entry.name),
    // Symlinked directories can point outside the checkout or back into it;
    // neither should make the walk recurse unpredictably. (walkTree's default,
    // named here because this walk's result is a gate's file list.)
    links: 'skip',
    // Below the root, ENOENT is a race with readdir — a concurrent checkout, a
    // branch switch, a test tearing down a temp tree. At the ROOT it throws,
    // which is walkTree's contract and the one this gate needs: an empty list
    // would make the syntax check report "0 .mjs files" and pass (#3419).
    onError: 'ignore',
  })
    .filter((f) => f.endsWith('.mjs'))
    // Sorted by FULL PATH, not left in walkTree's per-level entry order: both
    // callers report one line per file in iteration order, and a run-to-run
    // reordering of that output is noise in a diff.
    .sort();
}
