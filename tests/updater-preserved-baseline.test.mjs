/**
 * tests/updater-preserved-baseline.test.mjs — the #4355 fix.
 *
 * locallyModifiedSystemFiles()'s baseline used to be "the single most recent
 * `chore: auto-update system files` commit," shared by every path. That
 * self-poisons: when a run PRESERVES a file (skips its checkout because it
 * was locally modified), the resulting auto-update commit's tree still
 * contains the local edit for that file — and that same commit becomes the
 * baseline the NEXT run trusts. Diffing the file against a baseline that
 * already equals its own local content comes back empty, so the file
 * silently stops reading as "changed locally" even though it still differs
 * from the newer upstream, and apply()'s raw checkout overwrites it with no
 * warning and no `.bak`.
 *
 * The fix (preservedPathsTrailer / preservedPathsFromCommitMessage /
 * locallyModifiedSystemFiles's per-path baseline walk) is exercised here
 * against a throwaway repo, same shape as updater-local-system-edits.test.mjs
 * — but that file's replayUpdate() helper never models preservation at all,
 * which is exactly the gap that let #4355 ship unnoticed. This file's
 * replayUpdateWithPreservation() closes it, built from the SAME
 * preservedPathsTrailer() apply() itself calls, so the fixture can never
 * silently drift from what apply() actually writes.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import {
  gitIn,
  locallyModifiedSystemFiles,
  preservedPathsTrailer,
  preservedPathsFromCommitMessage,
} from '../update-system.mjs';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'co-preserved-baseline-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'oferta.md'), 'shipped oferta v1\n');
  writeFileSync(join(dir, 'modes', 'cover.md'), 'shipped cover v1\n');
  // VERSION is a real SYSTEM_PATHS entry, and every genuine release bumps it —
  // it is what guarantees an update commit always has SOMETHING to commit,
  // even on a run where every content file happens to be preserved or
  // byte-identical to upstream. Without it, replayUpdateWithPreservation()
  // below could hit "nothing to commit" on such a run, which real apply()
  // handles by skipping the commit — an edge case irrelevant to what this
  // file is testing, so the fixture sidesteps it instead of modeling it.
  writeFileSync(join(dir, 'VERSION'), '1\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');
  return { dir, g, ctx: { git: g, root: dir } };
}

function upstreamChange(repo, file, content) {
  repo.g('checkout', '-q', 'upstream');
  writeFileSync(join(repo.dir, ...file.split('/')), content);
  repo.g('commit', '-qam', `upstream: ${file}`);
  repo.g('checkout', '-q', 'main');
}

/**
 * Replays what apply() does for a run that preserves `preservedPaths`:
 * checks out every `allPaths` manifest entry from upstream with `:(exclude)`
 * pathspecs for each preserved (always concrete-file) path — the SAME
 * mechanism apply() uses, which is what makes this correct for a
 * directory-shaped manifest entry (e.g. `modes/`) preserving only ONE file
 * inside it, not just a plain top-level file. The resulting commit carries
 * the SAME trailer apply() writes, via the SAME function.
 */
function replayUpdateWithPreservation(repo, version, allPaths, preservedPaths) {
  const excludeSpecs = preservedPaths.map((p) => `:(exclude)${p}`);
  // Every real release bumps VERSION, so this always has something to stage
  // even when every content path is preserved this round.
  repo.g('checkout', '-q', 'upstream');
  writeFileSync(join(repo.dir, 'VERSION'), `${version}\n`);
  repo.g('commit', '-qam', `upstream: VERSION ${version}`);
  repo.g('checkout', '-q', 'main');
  try {
    repo.g('checkout', 'upstream', '--', ...allPaths, ...excludeSpecs, 'VERSION');
  } catch {
    // Every entry in allPaths is also excluded (fully preserved) — nothing to
    // check out except VERSION. Real apply() has pathFullyPreserved() skip
    // this case explicitly; the test fixture just falls back to checking out
    // VERSION alone, same net effect.
    repo.g('checkout', 'upstream', '--', 'VERSION');
  }
  const message = `chore: auto-update system files to v${version}${preservedPathsTrailer(preservedPaths)}`;
  repo.g('commit', '-qam', message);
}

const PATHS = ['modes/oferta.md', 'modes/cover.md'];

// ── Unit: preservedPathsTrailer / preservedPathsFromCommitMessage round-trip ─
{
  const empty = preservedPathsTrailer([]);
  const empty2 = preservedPathsTrailer(undefined);
  if (empty === '' && empty2 === '') {
    pass('preservedPathsTrailer([]) is the empty string — no trailer noise for the common case');
  } else {
    fail(`expected both empty, got ${JSON.stringify(empty)} / ${JSON.stringify(empty2)}`);
  }
}
{
  const trailer = preservedPathsTrailer(['modes/cover.md', 'AGENTS.md']);
  const message = `chore: auto-update system files to v1.2.0${trailer}`;
  const parsed = preservedPathsFromCommitMessage(message);
  if (
    message.startsWith('chore: auto-update system files to v1.2.0\n\nPreserved-Path: AGENTS.md\nPreserved-Path: modes/cover.md')
    && parsed.has('AGENTS.md') && parsed.has('modes/cover.md') && parsed.size === 2
  ) {
    pass('preservedPathsTrailer sorts its paths and preservedPathsFromCommitMessage parses them back out');
  } else {
    fail(`round-trip broke: message=${JSON.stringify(message)} parsed=${JSON.stringify([...parsed])}`);
  }
}
{
  const parsed = preservedPathsFromCommitMessage('chore: auto-update system files to v1.0.0');
  if (parsed.size === 0) {
    pass('a commit message with no trailer parses to an empty set (pre-fix history)');
  } else {
    fail(`expected empty set, got ${JSON.stringify([...parsed])}`);
  }
}

// ── 1. The #4355 reproduction: preserved on update N, still at risk on N+1 ──
{
  const repo = makeRepo();
  // Update N: upstream moved, oferta.md is preserved (the user edited it).
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v2\n');
  writeFileSync(join(repo.dir, 'modes', 'oferta.md'), 'MY LOCAL EDIT\n');
  repo.g('commit', '-qam', 'my local edit');
  let atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  replayUpdateWithPreservation(repo, '2', PATHS, atRisk);

  // Update N+1: upstream moves AGAIN. The naive single-baseline code trusted
  // the v2 auto-update commit (whose tree already holds "MY LOCAL EDIT") as
  // the baseline, saw no diff against it, and silently dropped oferta.md.
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v3\n');
  atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'modes/oferta.md') {
    pass('#4355: a file preserved on one update is still flagged at risk on the NEXT one');
  } else {
    fail(`#4355 case 1 expected ['modes/oferta.md'], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 2. ...and a THIRD update, still preserved twice in a row ────────────────
//    The bug compounds: a naive fix that only looks one commit back would
//    still self-poison on the second consecutive preservation.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v2\n');
  writeFileSync(join(repo.dir, 'modes', 'oferta.md'), 'MY LOCAL EDIT\n');
  repo.g('commit', '-qam', 'my local edit');
  let atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  replayUpdateWithPreservation(repo, '2', PATHS, atRisk);

  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v3\n');
  atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  replayUpdateWithPreservation(repo, '3', PATHS, atRisk); // preserved again

  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v4\n');
  atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'modes/oferta.md') {
    pass('two consecutive preserving updates still leave the file correctly flagged on the third');
  } else {
    fail(`case 2 expected ['modes/oferta.md'], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 3. A fresh, different edit made AFTER the preserving commit is detected ─
//    Guards against an over-broad fix that stops trusting a file's diff
//    entirely once it has ever been preserved.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v2\n');
  writeFileSync(join(repo.dir, 'modes', 'oferta.md'), 'first local edit\n');
  repo.g('commit', '-qam', 'first local edit');
  let atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  replayUpdateWithPreservation(repo, '2', PATHS, atRisk);

  writeFileSync(join(repo.dir, 'modes', 'oferta.md'), 'a second, different edit\n');
  repo.g('commit', '-qam', 'second edit, after the preserving commit');
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v3\n');

  atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'modes/oferta.md') {
    pass('a genuine edit made after the preserving commit is still detected');
  } else {
    fail(`case 3 expected ['modes/oferta.md'], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 4. Upstream independently adopts the exact preserved content — no noise ─
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v2\n');
  writeFileSync(join(repo.dir, 'modes', 'oferta.md'), 'a fix upstream will later adopt\n');
  repo.g('commit', '-qam', 'local fix');
  let atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  replayUpdateWithPreservation(repo, '2', PATHS, atRisk);

  // Upstream's next release happens to ship byte-identical content.
  upstreamChange(repo, 'modes/oferta.md', 'a fix upstream will later adopt\n');
  atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 0) {
    pass('content upstream independently adopted is not flagged, even after a preserving run');
  } else {
    fail(`case 4 expected [], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 5. Only the preserved file's baseline is affected — an unrelated file ───
//    preserved in the SAME commit still resolves its own baseline correctly,
//    and a file preserved in one run but not another gets the right one too.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v2\n');
  upstreamChange(repo, 'modes/cover.md', 'shipped cover v2\n');
  writeFileSync(join(repo.dir, 'modes', 'oferta.md'), 'oferta local edit\n');
  writeFileSync(join(repo.dir, 'modes', 'cover.md'), 'cover local edit\n');
  repo.g('commit', '-qam', 'two local edits');
  let atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  // Both preserved together in the v2 update.
  replayUpdateWithPreservation(repo, '2', PATHS, atRisk);

  // v3: oferta.md gets a genuinely new upstream version (still preserved,
  // since the local edit never changed); cover.md's local edit is DROPPED
  // (the user reverted to the shipped wording), so cover.md is NOT preserved
  // this round and syncs normally.
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v3\n');
  upstreamChange(repo, 'modes/cover.md', 'shipped cover v3\n');
  writeFileSync(join(repo.dir, 'modes', 'cover.md'), 'shipped cover v3\n'); // matches upstream now
  repo.g('commit', '-qam', 'drop the cover.md edit');
  atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  replayUpdateWithPreservation(repo, '3', PATHS, atRisk);

  // v4: a further upstream move on BOTH files. oferta.md must still be
  // flagged (its own baseline chain skips both v2 and v3, since both
  // preserved it); cover.md must NOT be flagged (it was genuinely synced in
  // v3, so v3 is its correct, trustworthy baseline).
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v4\n');
  upstreamChange(repo, 'modes/cover.md', 'shipped cover v4\n');
  atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'modes/oferta.md') {
    pass('each file resolves its OWN baseline: still-preserved oferta.md is flagged, synced cover.md is not');
  } else {
    fail(`case 5 expected ['modes/oferta.md'], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 6. A pre-fix auto-update commit (no trailer at all) degrades to the old,
//    single-shared-baseline behavior — this fix must not require rewriting
//    history nobody controls. Same shape as
//    updater-local-system-edits.test.mjs case 14, restated here because it is
//    the compatibility floor this fix must not fall through.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v2\n');
  // A raw, trailer-less commit — what every installed history looked like
  // before this fix shipped.
  repo.g('checkout', 'upstream', '--', ...PATHS);
  repo.g('commit', '-qm', 'chore: auto-update system files to v2');
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v3\n');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 0) {
    pass('a pre-fix, trailer-less auto-update commit still trusts its own tree as the baseline (no history rewrite required)');
  } else {
    fail(`case 6 expected [], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 7. Unreadable history degrades the warning, never the update ───────────
//    Same contract as updater-local-system-edits.test.mjs case 16, pinned
//    again here because this fix replaces the `git log` call it protects.
{
  const repo = makeRepo();
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v2\n');
  writeFileSync(join(repo.dir, 'modes', 'oferta.md'), 'local fix\n');
  const blind = {
    root: repo.dir,
    git: (...args) => {
      if (args[0] === 'log') throw new Error('shallow clone: no history here');
      return repo.g(...args);
    },
  };

  let threw = false;
  let atRisk = null;
  try {
    atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', blind);
  } catch {
    threw = true;
  }
  if (!threw && Array.isArray(atRisk) && atRisk.includes('modes/oferta.md')) {
    pass('unreadable auto-update history degrades to the merge-base fallback, never throws');
  } else {
    fail(`case 7 threw=${threw} atRisk=${JSON.stringify(atRisk)}`);
  }
  rmSync(repo.dir, { recursive: true, force: true });
}

// ── 8. A directory-shaped manifest entry: one preserved file inside it must
//    not defeat — or be defeated by — the rest of the directory (CodeRabbit
//    review on #4362). SYSTEM_PATHS genuinely ships directory entries like
//    `modes/` (see PATHS in updater-local-system-edits.test.mjs); the fix
//    above walks the RAW paths array, and `modes/'`s literal string is never
//    a member of any commit's preserved SET (that set only ever holds
//    concrete files, from `git diff --numstat`), so a naive per-path walk
//    would always resolve `modes/` to the newest commit regardless of what it
//    preserved — silently reproducing #4355 for every directory-shaped entry.
{
  const repo = makeRepo();
  const DIR_PATHS = ['modes/'];

  // v2: oferta.md preserved; cover.md syncs normally.
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v2\n');
  writeFileSync(join(repo.dir, 'modes', 'oferta.md'), 'MY LOCAL EDIT\n');
  repo.g('commit', '-qam', 'local edit');
  let atRisk = locallyModifiedSystemFiles(DIR_PATHS, 'upstream', repo.ctx);
  replayUpdateWithPreservation(repo, '2', DIR_PATHS, atRisk);

  // v3: upstream moves oferta.md again. The bug: grouping the whole `modes/`
  // pathspec under the v2 commit (whose tree already holds the local edit)
  // makes this diff come back empty.
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v3\n');
  atRisk = locallyModifiedSystemFiles(DIR_PATHS, 'upstream', repo.ctx);
  if (atRisk.length === 1 && atRisk[0] === 'modes/oferta.md') {
    pass('a directory-shaped manifest entry still flags its own preserved file on the next update');
  } else {
    fail(`case 8 expected ['modes/oferta.md'], got ${JSON.stringify(atRisk)}`);
  }
}

// ── 9. ...and divergent SIBLINGS under the same directory entry each resolve
//    their own baseline — this is the exact "divergent sibling files" case
//    the review comment asked for explicitly.
{
  const repo = makeRepo();
  const DIR_PATHS = ['modes/'];

  // v2: oferta.md preserved; cover.md syncs normally, untouched since.
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v2\n');
  writeFileSync(join(repo.dir, 'modes', 'oferta.md'), 'OFERTA LOCAL EDIT\n');
  repo.g('commit', '-qam', 'edit oferta');
  let atRisk = locallyModifiedSystemFiles(DIR_PATHS, 'upstream', repo.ctx);
  replayUpdateWithPreservation(repo, '2', DIR_PATHS, atRisk);

  // v3: cover.md NOW gets its own local edit and is preserved too, while
  // oferta.md remains preserved (still diverged, untouched since v2).
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v3\n');
  upstreamChange(repo, 'modes/cover.md', 'shipped cover v2\n');
  writeFileSync(join(repo.dir, 'modes', 'cover.md'), 'COVER LOCAL EDIT\n');
  repo.g('commit', '-qam', 'edit cover');
  atRisk = locallyModifiedSystemFiles(DIR_PATHS, 'upstream', repo.ctx);
  replayUpdateWithPreservation(repo, '3', DIR_PATHS, atRisk);

  // v4: both move upstream again. Both siblings must still be flagged, each
  // resolved against its own correct non-preserving baseline. v3 preserved
  // BOTH files (see the comment above), so oferta.md's walk skips v3 AND v2
  // (which also preserved it) and falls back to the pre-update merge-base.
  // cover.md's walk skips only v3 (which preserved it) and lands on v2 —
  // v2 never preserved cover.md, so it IS cover.md's baseline (CodeRabbit
  // review on #4362).
  upstreamChange(repo, 'modes/oferta.md', 'shipped oferta v4\n');
  upstreamChange(repo, 'modes/cover.md', 'shipped cover v3\n');
  atRisk = locallyModifiedSystemFiles(DIR_PATHS, 'upstream', repo.ctx).sort();
  const expected = ['modes/cover.md', 'modes/oferta.md'];
  if (JSON.stringify(atRisk) === JSON.stringify(expected)) {
    pass('divergent sibling files under the same directory entry each resolve their own baseline');
  } else {
    fail(`case 9 expected ${JSON.stringify(expected)}, got ${JSON.stringify(atRisk)}`);
  }
}
