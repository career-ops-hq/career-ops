/**
 * updater-baseline-recency.test.mjs — #32 regression coverage.
 *
 * locallyModifiedSystemFiles() picks a "baseline" commit to diff against when
 * deciding whether a system file was edited by THIS install (vs. only by
 * upstream). It prefers the most recent commit whose message matches
 * `^chore: auto-update system files` over the plain `merge-base(HEAD,
 * upstreamRef)` fallback, on the theory that the updater commit is always the
 * more recent, tighter baseline.
 *
 * That assumption broke for cbeaulieu-gt/career-ops#32: the fork's only
 * matching updater commit was a stale one from a much earlier version, living
 * on history that has NO ancestor relationship with the merge-base of a
 * LATER, independently-merged upstream sync (PR #25) — the two candidates sit
 * on divergent lines from a shared, older root. `merge-base --is-ancestor`
 * cannot order them (it fails in both directions for genuinely unrelated
 * commits), so picking "more recent" requires comparing commit time (`%ct`),
 * not ancestry. Getting this wrong anchored the diff on the ancient commit,
 * which made ~220 files the fork had never touched — merely re-synced from
 * upstream via the PR merge — look locally modified, permanently stuck.
 *
 * Two properties are pinned here:
 *   1. (the bug) an updater commit OLDER than a since-superseded merge-base
 *      must lose to that merge-base, even when neither is an ancestor of the
 *      other.
 *   2. (the pre-existing, intended behavior — must not regress) an updater
 *      commit NEWER than the plain merge-base still wins, which is the
 *      #2337-adjacent case the updater-commit preference exists for: a file
 *      the previous `apply` run itself updated must not look user-edited
 *      just because the old merge-base predates that run.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, locallyModifiedSystemFiles } from '../update-system.mjs';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'co-baseline-recency-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  return { dir, g, ctx: { git: g, root: dir } };
}

/** Commit whatever is staged/dirty with an explicit committer+author time. */
function commitAt(g, message, isoDate, extraArgs = []) {
  const savedAuthor = process.env.GIT_AUTHOR_DATE;
  const savedCommitter = process.env.GIT_COMMITTER_DATE;
  process.env.GIT_AUTHOR_DATE = isoDate;
  process.env.GIT_COMMITTER_DATE = isoDate;
  try {
    g('add', '-A');
    g('commit', '-qm', message, ...extraArgs);
  } finally {
    if (savedAuthor === undefined) delete process.env.GIT_AUTHOR_DATE; else process.env.GIT_AUTHOR_DATE = savedAuthor;
    if (savedCommitter === undefined) delete process.env.GIT_COMMITTER_DATE; else process.env.GIT_COMMITTER_DATE = savedCommitter;
  }
}

const PATHS = ['x.md'];

// ── 1. #32: a stale, unrelated-branch updater commit must lose to a newer,
//    independently-merged upstream sync — even with no ancestor relation ──
{
  const repo = makeRepo();
  const { dir, g, ctx } = repo;

  // Shared root, x.md = v1.
  writeFileSync(join(dir, 'x.md'), 'v1\n');
  commitAt(g, 'root', '2026-01-01T00:00:00');
  g('branch', 'upstream');

  // Main's OWN old auto-update commit, early — diverges from the shared root
  // without ever touching the upstream branch again. This is the stale
  // updater commit the grep will find.
  writeFileSync(join(dir, 'x.md'), 'v1-old-apply\n');
  commitAt(g, 'chore: auto-update system files to v1.3.0', '2026-01-02T00:00:00');
  // Revert the file back so it doesn't look like a genuine, still-live user
  // edit later — only the historical existence of this commit matters.
  writeFileSync(join(dir, 'x.md'), 'v1\n');
  commitAt(g, 'revert to v1 for the test setup', '2026-01-02T00:05:00');

  // Upstream progresses independently on its own branch, unmerged into main
  // yet: v1 -> v2 (the content main will later adopt via a real merge).
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'x.md'), 'v2\n');
  commitAt(g, 'upstream: x.md v2', '2026-06-01T00:00:00');
  g('checkout', '-q', 'main');

  // Main merges upstream's v2 in — a REAL merge, establishing a genuine
  // merge-base. main's x.md now matches upstream's v2 exactly.
  g('merge', '--no-ff', '-m', 'sync: merge upstream (like PR #25)', 'upstream');

  // Upstream keeps moving after the sync: v2 -> v3. This is real, pending
  // drift main has not adopted yet.
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'x.md'), 'v3\n');
  commitAt(g, 'upstream: x.md v3', '2026-08-01T00:00:00');
  g('checkout', '-q', 'main');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', ctx);
  if (!atRisk.includes('x.md')) {
    pass('#32: a file only re-synced from a newer, unrelated-branch upstream merge is not flagged as user-edited');
  } else {
    fail(`#32 regression: x.md wrongly flagged as locally modified — got ${JSON.stringify(atRisk)}`);
  }

  rmSync(dir, { recursive: true, force: true });
}

// ── 2. Pre-existing behavior must not regress: a NEWER updater commit still
//    beats a stale plain merge-base (the #2337-adjacent case this branch was
//    added for in the first place) ──
{
  const repo = makeRepo();
  const { dir, g, ctx } = repo;

  // Shared root.
  writeFileSync(join(dir, 'y.md'), 'v1\n');
  commitAt(g, 'root', '2026-01-01T00:00:00');
  g('branch', 'upstream');

  // Upstream advances.
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'y.md'), 'v2\n');
  commitAt(g, 'upstream: y.md v2', '2026-02-01T00:00:00');
  g('checkout', '-q', 'main');

  // main runs an "apply": adopts upstream's v2 via a plain checkout+commit
  // (no merge — this is exactly what update-system.mjs's apply() does, so it
  // does NOT create ancestry with the upstream branch).
  g('checkout', 'upstream', '--', 'y.md');
  commitAt(g, 'chore: auto-update system files to v2.0.0', '2026-02-02T00:00:00');

  // Upstream advances again after that apply.
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'y.md'), 'v3\n');
  commitAt(g, 'upstream: y.md v3', '2026-03-01T00:00:00');
  g('checkout', '-q', 'main');

  const atRisk = locallyModifiedSystemFiles(['y.md'], 'upstream', ctx);
  if (!atRisk.includes('y.md')) {
    pass('a file the previous apply run itself updated is not flagged just because the plain merge-base predates that run');
  } else {
    fail(`#2 regression: y.md wrongly flagged as locally modified — got ${JSON.stringify(atRisk)}`);
  }

  rmSync(dir, { recursive: true, force: true });
}
