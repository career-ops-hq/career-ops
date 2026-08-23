/**
 * updater-baseline-recency.test.mjs — #32 regression coverage.
 *
 * locallyModifiedSystemFiles() baselines its diff on the newer of {updater
 * commit, merge-base(HEAD, upstreamRef)}: ancestry orders them when it can,
 * commit time (`%ct`) is the fallback for genuinely unrelated commits. #32:
 * a stale, unrelated-branch updater commit wrongly anchored the diff and
 * flagged ~220 merely re-synced files as locally modified.
 *
 * Pinned: (1) a stale updater commit must lose to a newer merge-base even
 * with no ancestor relation; (2) a newer updater commit must still beat a
 * stale merge-base — the pre-existing #2337-adjacent behavior — must not
 * regress.
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

  writeFileSync(join(dir, 'x.md'), 'v1\n');
  commitAt(g, 'root', '2026-01-01T00:00:00');
  g('branch', 'upstream');

  // Stale updater commit on its own side branch — never touches upstream
  // again, so it has no ancestor relation to the later merge-base.
  writeFileSync(join(dir, 'x.md'), 'v1-old-apply\n');
  commitAt(g, 'chore: auto-update system files to v1.3.0', '2026-01-02T00:00:00');
  // Revert so the content isn't mistaken for a live edit; only the commit's
  // existence (for the grep) matters.
  writeFileSync(join(dir, 'x.md'), 'v1\n');
  commitAt(g, 'revert to v1 for the test setup', '2026-01-02T00:05:00');

  // Upstream advances independently, unmerged into main yet.
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'x.md'), 'v2\n');
  commitAt(g, 'upstream: x.md v2', '2026-06-01T00:00:00');
  g('checkout', '-q', 'main');

  // Real merge — establishes the genuine merge-base.
  g('merge', '--no-ff', '-m', 'sync: merge upstream (like PR #25)', 'upstream');

  // Upstream keeps moving after the sync: pending drift main hasn't adopted.
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
//    beats a stale plain merge-base (the #2337-adjacent case this branch
//    was added for) ──
{
  const repo = makeRepo();
  const { dir, g, ctx } = repo;

  writeFileSync(join(dir, 'y.md'), 'v1\n');
  commitAt(g, 'root', '2026-01-01T00:00:00');
  g('branch', 'upstream');

  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'y.md'), 'v2\n');
  commitAt(g, 'upstream: y.md v2', '2026-02-01T00:00:00');
  g('checkout', '-q', 'main');

  // Plain checkout+commit, not a merge — mirrors update-system.mjs's
  // apply(), so it creates no ancestry with the upstream branch.
  g('checkout', 'upstream', '--', 'y.md');
  commitAt(g, 'chore: auto-update system files to v2.0.0', '2026-02-02T00:00:00');

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
