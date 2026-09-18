/**
 * updater-is-tracked.test.mjs — BEHAVIORAL tests for isTracked().
 *
 * apply() deletes the .update-dismissed marker and then stages it so the
 * deletion lands in the update commit. The marker is gitignored by default, so
 * on a stock checkout it is not in the index — and staging a path git has never
 * heard of is a fatal "pathspec did not match any files" that takes the whole
 * batch down, leaving the update uncommitted. Reproduces with no local
 * customization: dismiss an update, then apply one.
 *
 * isTracked() is what separates the cases, so each of its outcomes needs its
 * own oracle:
 *
 *   - false (not tracked) is the common path. The upgrade-tests.mjs PR gate
 *     covers it end to end by seeding a marker into the fixture install.
 *   - true (force-tracked) is rare. The PR gate reaches it as of the two-leg
 *     gate folded in from #2591 (`dismiss=tracked`), but only end to end, and
 *     only for a marker force-added before the upgrade. The assertion below is
 *     the direct one: without it, a hardcoded `return false` would still have
 *     to be caught downstream by whether a deletion reached the commit, which
 *     names the symptom rather than the probe that produced it.
 *   - a throwing probe must PROPAGATE, not report "untracked". `ls-files` exits
 *     0 with empty output when nothing matches, so a throw is an abnormal git
 *     failure and answering "untracked" for a tracked marker would drop its
 *     deletion while the update still printed success.
 *
 * Drives the real export against a throwaway repo through the gitIn seam,
 * following updater-rollback-behavior.test.mjs, so the property is verified
 * rather than the source merely pattern-matched.
 */

import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo } from './helpers.mjs';
import { gitIn, isTracked } from '../update-system.mjs';

// Shared with updater-add-paths.test.mjs so the git-isolation pins live in one
// body: dropping one has to redden both suites, not leave this one quietly
// unprotected. `root` is omitted because isTracked never reads it.
const makeRepo = () => makeUpdaterRepo(gitIn, { prefix: 'co-istracked-' });

console.log('\n🧪 Testing isTracked (ignored-but-tracked vs never-tracked)...');

{
  const { dir, g, ctx } = makeRepo();
  writeFileSync(join(dir, 'seed.txt'), 'x');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(join(dir, '.gitignore'), '.update-dismissed\nkept.txt\n');
  g('add', '.gitignore');
  g('commit', '-qm', 'ignores');

  // Ignored AND tracked (force-added at some point) — its deletion has to be
  // staged, or an otherwise successful update leaves the worktree dirty.
  writeFileSync(join(dir, 'kept.txt'), 'k');
  g('add', '-f', 'kept.txt');
  g('commit', '-qm', 'track an ignored file');

  // Ignored and never tracked — the .update-dismissed shape.
  writeFileSync(join(dir, '.update-dismissed'), new Date(0).toISOString());

  if (isTracked('kept.txt', ctx)) {
    pass('isTracked: true for an ignored-but-tracked path');
  } else {
    fail('isTracked said false for a tracked path — apply() would skip a deletion it must stage');
  }

  if (!isTracked('.update-dismissed', ctx)) {
    pass('isTracked: false for an ignored, never-tracked path');
  } else {
    fail('isTracked said true for a never-tracked path — apply() would stage an unmatched pathspec');
  }

  // A failing probe must not be reported as "untracked". `ls-files` returns
  // successfully with empty output when nothing matches, so a throw means git
  // itself failed (a timeout, an unreadable index, git failing to launch) —
  // and answering false there would drop a tracked marker's deletion while
  // apply() still printed success.
  let propagated = false;
  try {
    isTracked('.update-dismissed', { git: () => { throw new Error('git probe failed'); } });
  } catch {
    propagated = true;
  }
  if (propagated) {
    pass('isTracked: an abnormal git failure propagates instead of reporting untracked');
  } else {
    fail('isTracked swallowed a git failure — a tracked deletion would be silently dropped');
  }

  rmSync(dir, { recursive: true, force: true });
}
