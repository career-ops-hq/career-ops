/**
 * updater-upgrade-safety.test.mjs — BEHAVIORAL upgrade-safety tests (#2337, #2007).
 *
 * #2337: `update-system.mjs apply()` overwrites every SYSTEM_PATHS file with a
 * raw `git checkout FETCH_HEAD -- <path>` in a loop — not a merge, no divergence
 * detection. A local, un-upstreamed fix to a system-layer file (the concrete case
 * was a fix to generate-cover-letter.mjs reverted across v1.22→1.24) is silently
 * discarded. `locallyModifiedSystemFiles()` is the pure ctx-seamed export that
 * flags those at-risk files so apply() can preserve them (and write a `.bak`)
 * before the checkout loop.
 *
 * These tests drive the real pure exports (`locallyModifiedSystemFiles` and
 * `revertPaths`) and reproduce apply()'s per-path `git checkout` loop locally
 * (apply() does not expose that loop as a callable export), against a throwaway
 * git repo via the git-runner seam — no network, no career-ops-v* tags, no
 * apply() call. They
 * run in-process on every PR (test-all.mjs auto-discovers tests/**\/*.test.mjs),
 * so the never-touch-user-data property and the #2337 detection are gated on
 * every change, matching the reference pattern in updater-rollback-behavior.test.mjs.
 */

import { createHash } from 'crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, locallyModifiedSystemFiles, revertPaths } from '../update-system.mjs';

// A throwaway git repo plus a ctx that binds the seam's git runner and
// filesystem root to it, so nothing touches the real working tree. autocrlf is
// pinned OFF so blob ids and SHA-256 byte-identity are stable on Windows.
function makeRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'core.autocrlf', 'false');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  return { dir, g, ctx: { git: g, root: dir } };
}

// Write a fixture file with EXPLICIT \n line endings (never the platform EOL),
// creating parent dirs as needed, so SHA-256 identity is deterministic.
function writeFixture(dir, rel, lines) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, lines.join('\n'), 'utf-8');
}

function sha256(dir, rel) {
  return createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex');
}

console.log('\n🧪 Testing updater upgrade safety (#2337, #2007)...');

// ── 1. #2337 regression: local un-upstreamed system edit about to be overwritten ──
// merge-base(HEAD, upstream) is the shared BASE commit. locallyModifiedSystemFiles
// must flag a system file that (a) diverged locally from that baseline AND (b) whose
// upstream blob differs from the local one — the exact silent-discard case — and
// must NOT raise a false positive on the two normal cases.
{
  const { dir, g, ctx } = makeRepo('co-upgrade-diverge-');

  // BASE commit: original blobs for three system files.
  writeFixture(dir, 'generate-cover-letter.mjs', ['// cover base']);   // will diverge locally
  writeFixture(dir, 'modes/_shared.md', ['shared base']);              // upstream-updated, local unchanged
  writeFixture(dir, 'modes/oferta.md', ['oferta base']);               // locally changed, upstream identical
  g('add', '-A');
  g('commit', '-qm', 'base');

  // Upstream branch (the FETCH_HEAD stand-in) diverges from BASE.
  g('checkout', '-q', '-b', 'upstream');
  writeFixture(dir, 'generate-cover-letter.mjs', ['// cover UPSTREAM edit']);
  writeFixture(dir, 'modes/_shared.md', ['shared UPSTREAM edit']);
  writeFixture(dir, 'modes/oferta.md', ['oferta CONVERGENT edit']);    // same text local will adopt
  writeFixture(dir, 'modes/upstream-only.md', ['upstream ships this file']); // only on upstream
  g('add', '-A');
  g('commit', '-qm', 'upstream changes');

  // Local HEAD diverges from BASE independently.
  g('checkout', '-q', 'main');
  writeFixture(dir, 'generate-cover-letter.mjs', ['// cover LOCAL un-upstreamed sentinel']);
  // modes/_shared.md left untouched → still equals BASE (normal upstream update).
  writeFixture(dir, 'modes/oferta.md', ['oferta CONVERGENT edit']);    // identical to upstream's blob
  g('add', '-A');
  g('commit', '-qm', 'local changes');

  const paths = ['generate-cover-letter.mjs', 'modes/_shared.md', 'modes/oferta.md', 'modes/pdf/'];
  const atRisk = locallyModifiedSystemFiles(paths, 'upstream', ctx);

  if (atRisk.includes('generate-cover-letter.mjs')) {
    pass('#2337: flags a locally-diverged system file about to be overwritten by a different upstream blob');
  } else {
    fail(`#2337 regression: locallyModifiedSystemFiles did NOT flag the overwritten local edit (got: ${JSON.stringify(atRisk)})`);
  }
  if (!atRisk.includes('modes/_shared.md')) {
    pass('no false positive: an unchanged-locally-but-updated-upstream file is not flagged');
  } else {
    fail('false positive: a normal upstream update (local == baseline) was flagged');
  }
  if (!atRisk.includes('modes/oferta.md')) {
    pass('no false positive: a locally-changed file whose upstream blob is identical is not flagged');
  } else {
    fail('false positive: a locally-changed file that upstream already carries identically was flagged');
  }
  // Directory-only entries and paths absent in a ref must never throw.
  const withMissing = locallyModifiedSystemFiles(['does-not-exist.mjs', 'modes/pdf/'], 'upstream', ctx);
  if (Array.isArray(withMissing) && !withMissing.includes('does-not-exist.mjs')) {
    pass('robust: dir-only entries and blobs absent in HEAD/ref are skipped without throwing');
  } else {
    fail(`robustness: a missing blob or dir entry was mishandled (got: ${JSON.stringify(withMissing)})`);
  }

  // Untracked-but-upstream-shipped: a file the user created locally at a path the
  // upstream ref also ships escapes `git diff` entirely, yet the checkout would
  // clobber it with no .bak. `modes/upstream-only.md` is committed on `upstream`
  // (below) and written here as an UNTRACKED local file after the local commit,
  // so only the untracked-detection branch can catch it.
  writeFixture(dir, 'modes/upstream-only.md', ['local untracked file at an upstream path']);
  const untracked = locallyModifiedSystemFiles(['modes/upstream-only.md'], 'upstream', ctx);
  if (untracked.includes('modes/upstream-only.md')) {
    pass('#2337: flags an untracked local file that the upstream ref would overwrite');
  } else {
    fail(`#2337 regression: an untracked file upstream ships was not flagged (got: ${JSON.stringify(untracked)})`);
  }

  rmSync(dir, { recursive: true, force: true });
}

// ── 1b. unrelated histories: no merge-base must degrade, not throw (#2337) ──
// When HEAD and the upstream ref share no history (a shallow clone, or a foreign
// root), `git merge-base` errors. locallyModifiedSystemFiles must swallow that,
// fall back to a HEAD baseline, and still return an array. A divergence warning
// we cannot compute must never abort the update. Kept separate from the
// missing-entry assertion so this early-return path is exercised on its own.
{
  const { dir, g, ctx } = makeRepo('co-upgrade-orphan-');
  writeFixture(dir, 'generate-cover-letter.mjs', ['// cover base']);
  g('add', '-A');
  g('commit', '-qm', 'base');
  // An orphan branch is a second, unrelated root commit: no merge-base with main.
  g('checkout', '-q', '--orphan', 'foreign');
  writeFixture(dir, 'generate-cover-letter.mjs', ['// cover FOREIGN root']);
  g('add', '-A');
  g('commit', '-qm', 'foreign root');
  g('checkout', '-q', 'main');   // clean tree, no shared history with `foreign`

  let result;
  let threw = false;
  try {
    result = locallyModifiedSystemFiles(['generate-cover-letter.mjs'], 'foreign', ctx);
  } catch {
    threw = true;
  }
  if (!threw && Array.isArray(result) && result.length === 0) {
    pass('#2337: no merge-base (unrelated histories) degrades to an empty result without throwing');
  } else {
    fail(`unrelated-histories path mishandled (threw=${threw}, got=${JSON.stringify(result)})`);
  }

  rmSync(dir, { recursive: true, force: true });
}

// ── 1c. a locally-deleted system file is omitted, not "preserved" (#2337) ──
// git diff lists a deletion, so a file the user removed lands in BOTH the
// locally-changed and differs-from-upstream sets and would otherwise be flagged.
// The existsSync filter drops it: a path not on disk cannot be overwritten, so
// apply() must not try to preserve or back up a file that is already gone.
{
  const { dir, g, ctx } = makeRepo('co-upgrade-deleted-');
  writeFixture(dir, 'modes/_shared.md', ['shared base']);
  writeFixture(dir, 'generate-cover-letter.mjs', ['// cover base']);
  g('add', '-A');
  g('commit', '-qm', 'base');

  // Upstream edits _shared.md, so without the delete it WOULD be at risk.
  g('checkout', '-q', '-b', 'upstream');
  writeFixture(dir, 'modes/_shared.md', ['shared UPSTREAM edit']);
  g('add', '-A');
  g('commit', '-qm', 'upstream changes');
  g('checkout', '-q', 'main');

  // Remove the tracked file locally after the branch point.
  g('rm', '-q', 'modes/_shared.md');

  let result;
  let threw = false;
  try {
    result = locallyModifiedSystemFiles(['modes/_shared.md'], 'upstream', ctx);
  } catch {
    threw = true;
  }
  if (!threw && Array.isArray(result) && !result.includes('modes/_shared.md')) {
    pass('#2337: a locally-deleted system file is omitted by the existsSync filter, never flagged for backup');
  } else {
    fail(`deleted-file path mishandled (threw=${threw}, got=${JSON.stringify(result)})`);
  }

  rmSync(dir, { recursive: true, force: true });
}

// ── 2. user-layer byte-identity: the per-path checkout never touches user data ──
// Reproduce apply()'s `git checkout <ref> -- <systemPath>` loop locally (it is not
// a callable export) for every SYSTEM_PATHS entry in the fixture; assert every
// user file stays SHA-256 byte-identical and none is deleted, while the
// system-layer sentinel DID change.
// ── 3. rollback round-trip continues in the same repo. ──
{
  const { dir, g, ctx } = makeRepo('co-upgrade-userlayer-');

  const userFiles = ['cv.md', 'data/applications.md', 'modes/_profile.md'];
  // The third entry exists ONLY on upstream: the checkout introduces it, and
  // rollback must delete it (it is not in HEAD), exercising revertPaths'
  // removeAdditionsNotInHead fallback rather than the plain restore branch.
  const fixtureSystemPaths = ['generate-cover-letter.mjs', 'modes/_shared.md', 'modes/upstream-only.mjs'];
  const upstreamOnly = 'modes/upstream-only.mjs';

  // BASE / HEAD: known user content (explicit \n) + system baselines.
  writeFixture(dir, 'cv.md', ['# CV', 'Jane Doe', 'local STAR story']);
  writeFixture(dir, 'data/applications.md', ['# Applications Tracker', '| # | Company |']);
  writeFixture(dir, 'modes/_profile.md', ['# Profile', 'archetype: local']);
  writeFixture(dir, 'generate-cover-letter.mjs', ['// cover SYS base']);
  writeFixture(dir, 'modes/_shared.md', ['shared SYS base']);
  g('add', '-A');
  g('commit', '-qm', 'base');

  const userShaBefore = Object.fromEntries(userFiles.map(f => [f, sha256(dir, f)]));
  const sysBlobBefore = g('rev-parse', 'HEAD:generate-cover-letter.mjs');

  // Upstream branch changes BOTH system and user files. Only system paths are
  // checked out below, so the divergent upstream user content must never appear.
  g('checkout', '-q', '-b', 'upstream');
  writeFixture(dir, 'generate-cover-letter.mjs', ['// cover SYS UPSTREAM']);
  writeFixture(dir, 'modes/_shared.md', ['shared SYS UPSTREAM']);
  writeFixture(dir, upstreamOnly, ['// new system file introduced by the update']); // absent from HEAD
  writeFixture(dir, 'cv.md', ['# CV', 'UPSTREAM CONTENT — MUST NOT APPEAR']);
  writeFixture(dir, 'data/applications.md', ['UPSTREAM TRACKER — MUST NOT APPEAR']);
  writeFixture(dir, 'modes/_profile.md', ['UPSTREAM PROFILE — MUST NOT APPEAR']);
  g('add', '-A');
  g('commit', '-qm', 'upstream changes');
  g('checkout', '-q', 'main');

  // Snapshot of pre-checkout staged paths — the `protectedPaths`/initialStatus
  // set apply() captures before mutating anything (empty here: clean tree).
  const initialStaged = new Set(
    g('diff', '--cached', '--name-only', 'HEAD').split('\n').filter(Boolean),
  );

  // apply()'s overwrite, reproduced locally: per SYSTEM_PATHS entry,
  // `git checkout <ref> -- p`.
  for (const p of fixtureSystemPaths) {
    g('checkout', 'upstream', '--', p);
  }

  let userIntact = true;
  for (const f of userFiles) {
    if (!existsSync(join(dir, f))) { userIntact = false; fail(`user file deleted by the checkout loop: ${f}`); continue; }
    if (sha256(dir, f) !== userShaBefore[f]) { userIntact = false; fail(`user file BYTE-CHANGED by the checkout loop: ${f}`); }
  }
  if (userIntact) {
    pass('user-layer byte-identity: cv.md, data/applications.md, modes/_profile.md are SHA-256 identical after the system-path checkout');
  }
  const sysBlobAfter = g('rev-parse', 'HEAD:generate-cover-letter.mjs'); // HEAD unchanged; worktree/index updated
  if (readFileSync(join(dir, 'generate-cover-letter.mjs'), 'utf-8').includes('UPSTREAM')) {
    pass('control: the system-layer sentinel DID change (proving the checkout actually ran)');
  } else {
    fail('the system file did not change — the checkout loop was a no-op, so byte-identity proves nothing');
  }
  void sysBlobAfter;
  if (existsSync(join(dir, upstreamOnly))) {
    pass('control: the checkout introduced the upstream-only system file (absent from HEAD)');
  } else {
    fail('the upstream-only file was not introduced by the checkout, so the rollback-delete assertion below proves nothing');
  }

  // ── 3. rollback round-trip: revertPaths restores system, users stay identical ──
  revertPaths([...fixtureSystemPaths], initialStaged, ctx);

  const sysWorktreeReverted = readFileSync(join(dir, 'generate-cover-letter.mjs'), 'utf-8');
  const sysBlobReverted = g('rev-parse', ':generate-cover-letter.mjs'); // index blob after revert
  if (sysBlobReverted === sysBlobBefore && sysWorktreeReverted.includes('SYS base')
      && !sysWorktreeReverted.includes('UPSTREAM')) {
    pass('rollback round-trip: revertPaths returns the system file to its prior blob');
  } else {
    fail(`rollback did not restore the system file (index blob before=${sysBlobBefore}, after revert=${sysBlobReverted})`);
  }
  let stillIntact = true;
  for (const f of userFiles) {
    if (!existsSync(join(dir, f)) || sha256(dir, f) !== userShaBefore[f]) { stillIntact = false; fail(`rollback disturbed user file: ${f}`); }
  }
  if (stillIntact) {
    pass('rollback round-trip: user files remain SHA-256 byte-identical after revert');
  }
  // The fallback branch: a path the update introduced is absent from HEAD, so
  // revertPaths cannot `git checkout HEAD -- <path>` it back; removeAdditionsNotInHead
  // must delete it instead, leaving the tree at its pre-update state.
  if (!existsSync(join(dir, upstreamOnly))) {
    pass('rollback removes a system path the update introduced that HEAD does not contain');
  } else {
    fail(`rollback retained an upstream-introduced path absent from HEAD: ${upstreamOnly}`);
  }

  rmSync(dir, { recursive: true, force: true });
}
