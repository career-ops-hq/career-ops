/**
 * updater-never-shipped-prune.test.mjs — the stale-file prune must not delete a
 * file upstream has NEVER shipped.
 *
 * `staleSystemFiles()` selects on "absent from upstream's current tree", which
 * cannot distinguish a file upstream retired from a file upstream never
 * carried. Under the ~50 directory-prefix SYSTEM_PATHS entries (`providers/`,
 * `tests/`, `templates/`, `docs/`, `modes/<lang>/`, ...) that second case is any
 * file a fork or contributor added, and `apply()` deleted it on every update
 * (#3971 — same root cause as #3636 / #3696, on a surface where no USER_PATHS
 * carve-out applies and no filename shape distinguishes the file).
 *
 * `wasEverShippedUpstream()` settles it from upstream's history, which
 * `apply()` has already fetched. These tests pin the four behaviours that
 * matter: never-shipped is kept, retired-upstream still prunes, a moved file
 * still prunes via its old path, and an unusable history keeps the file.
 */

import { pass, fail } from './helpers.mjs';
import { wasEverShippedUpstream } from '../update-system.mjs';

console.log('\n🧪 Testing never-shipped vs. retired-upstream prune discrimination...');

// A fake `git rev-list`: non-empty output means the path exists somewhere in
// the ref's history, which is exactly what the real command reports.
const historyContaining = (...paths) => (...args) => {
  const file = args[args.length - 1];
  return paths.includes(file) ? 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' : '';
};

// The decision `apply()` actually makes, mirroring its call site:
//   if (!wasEverShippedUpstream(f, ref)) { keep; continue; }
// Tests assert through this rather than the bare return value — a helper named
// for the SHIPPED state is easy to read with the wrong polarity at the point
// where it decides a DELETE.
const wouldPrune = (file, revList) => wasEverShippedUpstream(file, 'FETCH_HEAD', revList);

// ── 1. a file upstream never shipped is kept ────────────────────────────────
{
  // The real incident: a fork's own provider, spelled exactly like a shipped
  // one, absent from upstream's tree because it was never there to begin with.
  const revList = historyContaining('providers/greenhouse.mjs');
  if (wasEverShippedUpstream('providers/acme.mjs', 'FETCH_HEAD', revList)) {
    fail('a provider absent from upstream history was reported as shipped — it would be pruned');
  } else {
    pass('a file absent from upstream history is not treated as shipped (kept)');
  }
}

// ── 2. a file upstream really did retire still prunes ───────────────────────
{
  // Guards against "fix" by blanket-disabling the prune, which would reopen
  // #2532 (retired files persisting on installs forever).
  const revList = historyContaining('modes/retired-mode.md');
  if (wasEverShippedUpstream('modes/retired-mode.md', 'FETCH_HEAD', revList)) {
    pass('a file present in upstream history is still prunable when the current tree drops it');
  } else {
    fail('a genuinely retired upstream file was kept — the prune step is now a no-op');
  }
}

// ── 3. a file upstream MOVED still prunes at its old path ───────────────────
{
  // lib/context-budget.test.mjs -> tests/context-budget.test.mjs was a real
  // v1.32.0 move; the old path must not survive as a stale duplicate.
  const revList = historyContaining('lib/context-budget.test.mjs');
  if (wasEverShippedUpstream('lib/context-budget.test.mjs', 'FETCH_HEAD', revList)) {
    pass('a moved file still prunes at its old path (the old path is in history)');
  } else {
    fail('a moved file was kept at its old path, leaving a stale duplicate behind');
  }
}

// ── 4. an unusable history keeps the file (fail safe) ───────────────────────
{
  // A rev walk that errors (broken ref, git unavailable) proves nothing. The
  // caller prunes only on a TRUE return, so the safe answer is false: pruning
  // requires positive proof the file was shipped. Asserted through
  // `wouldPrune` rather than the raw return value, because reading the
  // polarity backwards here is exactly how the inverted fallback got written
  // and then confirmed by its own test.
  const revListThrows = () => { throw new Error('fatal: bad object FETCH_HEAD'); };
  if (wouldPrune('providers/acme.mjs', revListThrows)) {
    fail('an errored rev walk pruned the file — a broken ref would delete fork-local code');
  } else {
    pass('an errored rev walk keeps the file rather than pruning on no evidence');
  }
}

// ── 4b. a shallow clone keeps the file too ──────────────────────────────────
{
  // Truncated history does not throw; the walk simply finds nothing. Same
  // verdict as the error case, reached by a different route.
  const revListEmpty = () => '';
  if (wouldPrune('modes/retired-mode.md', revListEmpty)) {
    fail('a shallow clone pruned a file whose history it cannot see');
  } else {
    pass('a shallow clone keeps the file rather than pruning on truncated history');
  }
}

// ── 5. an empty path is not treated as shipped ──────────────────────────────
{
  const revList = historyContaining('');
  if (wasEverShippedUpstream('', 'FETCH_HEAD', revList)) {
    fail('an empty candidate path was reported as shipped');
  } else {
    pass('an empty candidate path is rejected without consulting history');
  }
}
