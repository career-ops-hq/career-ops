/**
 * walk-tree.mjs — the only hand-rolled directory recursion in this repository.
 *
 * ## Why one walker
 *
 * Every recursive walk in this repo has to answer the same question before it
 * descends: *is this child a checkout of its own?* A linked worktree or a
 * nested clone is a complete second copy of this repository, at whatever commit
 * it happens to sit on, and a gate that walks into one grades source the branch
 * under test does not contain — passing or failing on the age of somebody
 * else's working tree (#3499, #3762).
 *
 * With fourteen hand-rolled recursions that question had to be answered
 * fourteen times, and a static test tried to prove it had been by reading the
 * source of each one. Over four review rounds that test found and closed
 * *eleven distinct bypasses*: a guard on the directory being read rather than
 * the one about to be entered; a guard on an unrelated path; `const full = dir`
 * (a parent wearing a child's name); a result computed and dropped; a guard
 * placed after the descent; a guard on the second of two descents; the right
 * argument in the wrong branch. Each fix was real, and round twelve would very
 * likely have found something too — because `guardsEveryDescent()` was asking a
 * **dataflow** question with **text matching**, and an approximation of a
 * dataflow question has no fixed point (#3818).
 *
 * So the guard stops being a judgement about fourteen recursions and becomes a
 * property of the one that remains. There is a single place to get it wrong, a
 * single behavioural test that proves it is not got wrong
 * (`tests/walk-tree.test.mjs`), and the static rule left over asks about
 * *presence* — "is there another recursion here?" — which is decidable, rather
 * than about semantics, which is not.
 *
 * ## Why the exemption lives at the call site
 *
 * Some walks must NOT skip a marked directory: `plugins/_lock.mjs` hashes a
 * third-party plugin tree for integrity, and a directory that could opt out of
 * the hash by planting a `.git` marker is a place to hide code. Those callers
 * pass `allowNestedCheckouts: true` — declared next to the reason it exists,
 * rather than in an `EXEMPT` map in a test file that needs its own assertion to
 * keep from going stale.
 *
 * ## What does NOT belong here
 *
 * Keep the options object small or it becomes a config blob with a walker
 * attached. Most callers already post-filter their results and should keep
 * doing so — there is deliberately no `match`, no `extensions`, no `depth`
 * limit. A walk whose requirements would distort this signature (`intake.mjs`'s
 * realpath dedupe and alias resolution; `plugins/_lock.mjs`'s refusal to hash
 * a non-regular file) stays hand-rolled with a reasoned exemption in the gate,
 * which is a better outcome than a shared function nobody can read.
 */

import { existsSync, readdirSync, realpathSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Is `dir` a checkout of its own, rather than a subdirectory of this one?
 *
 * Any `.git` entry counts, of either type. A `.git` FILE is a linked worktree
 * or a submodule; a `.git` DIRECTORY below the root is a nested independent
 * clone. All three are somebody else's source tree that happens to sit inside
 * this one, and none of them is a file this repository's gates should grade.
 *
 * Excluding the *name* `.git` is not enough on its own, which is what made
 * #3499 hard to see: that catches the whole of git's storage in a normal clone
 * and none of it in a linked worktree, so the one exclusion meant to keep git
 * out of the walk slid straight past a second copy of the repository. The
 * consequences then differed per consumer — the syntax gates silently checked
 * ~2x the files (1097 reported in a 576-file checkout);
 * `tests/local-today-gates.test.mjs` failed outright, naming *correct* files as
 * violations because the stale copy predated the convention;
 * `tests/main-guard-convention.test.mjs` passed, because the stale copy
 * happened to satisfy that convention.
 *
 * Detecting the marker rather than blanket-ignoring `.claude/worktrees/`
 * (Claude Code's default location, which is how this was found) is both
 * narrower and broader: it holds for a worktree placed anywhere, and it costs
 * nothing for a checkout that has none.
 *
 * NOT applied to a walk root — see `walkTree`.
 *
 * @param {string} dir - Absolute path to a directory.
 * @returns {boolean} True if `dir` carries its own git marker.
 */
export function isNestedCheckout(dir) {
  return existsSync(join(dir, '.git'));
}

/**
 * Walk `root` depth-first and visit every regular file below it.
 *
 * **The nested-checkout guard is not optional and not the caller's job.** Every
 * directory this function is about to descend into is tested first, and a
 * marked one is not entered. That is the whole reason this module exists; see
 * the header.
 *
 * The walk root itself is deliberately never tested. The root's own `.git` is
 * what makes it a repository, and running a gate from inside a linked worktree
 * (where `.git` is a file too) must check that worktree's source rather than
 * skip all of it and report a passing scan of nothing.
 *
 * @param {string} root - Absolute path to walk. Must exist; see `onError`.
 * @param {object} [options]
 * @param {(entry: import('fs').Dirent, dir: string, depth: number) => boolean} [options.skip]
 *   Per-entry veto, called for files and directories alike before anything else
 *   is done with them. `depth` is 0 for entries directly inside `root`, so a
 *   caller can express a root-only exclusion. Return true to ignore the entry.
 * @param {(abs: string, entry: import('fs').Dirent) => void} [options.onFile]
 *   Called for each regular file. Optional — the return value carries the same
 *   paths.
 * @param {(abs: string, entry: import('fs').Dirent) => void} [options.onDir]
 *   Called for each directory that survived `skip` and the nested-checkout
 *   guard, before descending into it. Exists for walks that must materialise
 *   directories (a tree copy), including empty ones.
 * @param {'skip'|'follow'|'reject'} [options.links='skip']
 *   Symlinked entries: ignored, resolved with `statSync` (a broken link is
 *   ignored), or fatal. The default is `skip` because a symlinked directory can
 *   point outside the checkout or back into it, and neither should make a walk
 *   recurse unpredictably.
 * @param {'ignore'|'throw'} [options.onError='ignore']
 *   What to do when a directory BELOW the root cannot be read. `ignore` treats
 *   it as a race — readdir listed it and it was gone by the time we recursed,
 *   which a concurrent `git checkout` or a test tearing down a temp tree will
 *   do — and aborting a whole run over a directory that has ceased to be helps
 *   nobody. A missing or unreadable ROOT always throws whatever the setting:
 *   that is not a race, it is a bad argument, and swallowing it would return an
 *   empty list, so a gate would report "0 files" and pass having checked
 *   nothing. That failure mode is strictly worse than the bug it replaced
 *   (#3419), so it is not reachable from here. A caller that legitimately
 *   tolerates a missing root (`tests/helpers.mjs`'s `walkFiles`) says so in its
 *   own contract with an `existsSync` check.
 * @param {boolean} [options.sort=true]
 *   Sort each directory's entries by name before visiting them. On by default
 *   because readdir order is filesystem order, which varies by platform, and
 *   every caller here either reports results in iteration order (where a
 *   run-to-run reordering is diff noise) or hands them to a test runner (where
 *   it is a reordering of the run itself).
 * @param {boolean} [options.allowNestedCheckouts=false]
 *   Descend into marked directories anyway. For walks anchored at a tree this
 *   repository does not own, where skipping a marked directory would let it
 *   hide code from an integrity hash or a deny-list scan. Declare it at the
 *   call site with the reason.
 * @returns {string[]} Absolute paths of every file visited, in traversal order.
 */
export function walkTree(root, {
  skip = null,
  onFile = null,
  onDir = null,
  links = 'skip',
  onError = 'ignore',
  sort = true,
  allowNestedCheckouts = false,
} = {}) {
  if (links !== 'skip' && links !== 'follow' && links !== 'reject') {
    throw new TypeError(`walkTree: links must be 'skip', 'follow' or 'reject' (got ${JSON.stringify(links)})`);
  }
  if (onError !== 'ignore' && onError !== 'throw') {
    throw new TypeError(`walkTree: onError must be 'ignore' or 'throw' (got ${JSON.stringify(onError)})`);
  }

  const files = [];
  // Real paths of the directories between the root and the one being read.
  // Populated only when links are followed; see the cycle guard below.
  const chain = new Set();
  if (links === 'follow') {
    try { chain.add(realpathSync(root)); } catch { /* a missing root throws in walk(), with its own errno */ }
  }

  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (depth > 0 && onError === 'ignore' && err?.code === 'ENOENT') return;
      throw err;
    }
    if (sort) entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (skip && skip(entry, dir, depth)) continue;
      const abs = join(dir, entry.name);

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        if (links === 'skip') continue;
        if (links === 'reject') throw new Error(`walkTree: refusing to follow symlink: ${abs}`);
        try {
          const st = statSync(abs);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue; // broken link
        }
      }

      if (isDir) {
        // THE guard. One recursion in the repository means one place this can
        // be got wrong, and one behavioural test that proves it is not.
        if (!allowNestedCheckouts && isNestedCheckout(abs)) continue;

        // Cycle guard, and only under `links: 'follow'` — with links skipped
        // there is no way to re-enter a directory, so the default path pays
        // nothing. A link pointing at one of its own ancestors (docs/current ->
        // docs/) passes statSync as an ordinary directory and would otherwise
        // be descended until the path length or the stack gives out. The two
        // callers that follow links both walk trees a user can shape:
        // `test-all.mjs`'s repo copy and `seed-fixture.mjs`'s fixture manifest.
        //
        // Scoped to the ANCESTOR CHAIN, not a global visited set: two sibling
        // links onto the same real directory are not a cycle, and collapsing
        // them would silently drop the second copy from a tree copy that is
        // supposed to mirror what is there.
        if (links === 'follow') {
          let real;
          try { real = realpathSync(abs); } catch { continue; }
          if (chain.has(real)) continue;
          chain.add(real);
          if (onDir) onDir(abs, entry);
          walk(abs, depth + 1);
          chain.delete(real);
          continue;
        }

        if (onDir) onDir(abs, entry);
        walk(abs, depth + 1);
      } else if (isFile) {
        files.push(abs);
        if (onFile) onFile(abs, entry);
      }
    }
  };

  walk(root, 0);
  return files;
}

/**
 * Every file under `root`, as one call — the replacement for
 * `readdirSync(dir, { recursive: true })` and `globSync`.
 *
 * Those two are banned outside this module for the same reason the hand-rolled
 * recursions are: neither consults `isNestedCheckout`, so both walk straight
 * into a nested checkout and hand the caller a list of files from a tree the
 * caller does not own. Their callers then have to remember to filter the
 * results, which is the same "did you remember the guard?" question this module
 * exists to stop asking.
 *
 * @param {string} root - Absolute path to walk.
 * @param {object} [options]
 * @param {RegExp} [options.match] - Tested against each absolute path; unmatched files are dropped.
 * @param {(entry: import('fs').Dirent, dir: string, depth: number) => boolean} [options.skip] - As `walkTree`.
 * @param {boolean} [options.allowNestedCheckouts=false] - As `walkTree`.
 * @returns {string[]} Absolute paths, in traversal order.
 */
export function listTree(root, { match = null, skip = null, allowNestedCheckouts = false } = {}) {
  const files = walkTree(root, { skip, allowNestedCheckouts });
  return match ? files.filter((f) => match.test(f)) : files;
}
