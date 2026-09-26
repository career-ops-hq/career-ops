/**
 * updater-materialized-skill-drift.test.mjs — a core.symlinks=false install
 * must not report permanent system-files-changed drift over its materialized
 * CLI skill entrypoints (#3149, second cause).
 *
 * The regression: upstream ships `.claude/skills/career-ops/SKILL.md` and its
 * siblings (SKILL_ENTRYPOINTS) as symlinks (git mode 120000) pointing at
 * `.agents/skills/career-ops/SKILL.md`. On a filesystem without symlink
 * support — mostly Windows with core.symlinks=false — apply() cannot check
 * one out as a real symlink, so ensureSkillEntrypoints() writes a REAL copy
 * of the canonical file's content in its place and commits it ("Materialized
 * N skill entrypoint(s)..."). That commit necessarily differs from upstream's
 * symlink blob by BOTH mode (100644 vs 120000) and content (the full skill
 * document vs a 40-odd byte pointer string) — a difference the install
 * itself is required to create, not a sign of stale files.
 *
 * systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD') used to scope its diff over
 * the whole SYSTEM_PATHS list unfiltered, so it read this designed-in,
 * permanent difference as drift on every single check, forever — unlike
 * ordinary drift, which a re-`apply()` resolves. #2630 fixed the SHA-based
 * false positive; #3152 settled it on content; this is a second, independent
 * false-positive source living inside that content comparison itself.
 *
 * The fix: driftPathspecExcludingSkillEntrypoints() appends a git
 * `:(exclude)<path>` pathspec per SKILL_ENTRYPOINTS entry before the diff.
 * Safe because the materialized content is a byte-for-byte copy of
 * `.agents/skills/career-ops/SKILL.md`, which the `.agents/` SYSTEM_PATHS
 * entry already covers on its own — the exclusion only removes a redundant,
 * permanently-false signal, not real coverage.
 *
 * These tests drive systemTreeDiffers() + driftPathspecExcludingSkillEntrypoints()
 * against throwaway repos through the same git-plumbing seam
 * tests/skill-project-root.test.mjs uses to fake a symlink's git index mode
 * (`hash-object` + `update-index --cacheinfo 120000,...`) — deliberately not
 * a real OS symlink, so this reproduces identically on Linux, macOS and
 * Windows CI without needing symlink privilege. Pinning:
 *   - a materialized entrypoint (mode+content differ from upstream's
 *     symlink) is NOT drift once excluded                              (the fix)
 *   - the same fixture IS drift without the exclusion                  (the bug, reproduced)
 *   - a genuine upstream change to .agents/skills/career-ops/SKILL.md
 *     (the canonical file the entrypoints point at) is STILL drift      (nothing hidden)
 *   - a genuine upstream change under scaffolder/ (the entrypoint
 *     mechanism itself) is STILL drift                                 (nothing hidden)
 *   - an empty skillEntrypoints list is a no-op (pathspec unchanged)
 */

import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync, run, ROOT } from './helpers.mjs';
import { gitIn, systemTreeDiffers, driftPathspecExcludingSkillEntrypoints } from '../update-system.mjs';

const SYSTEM_PATHS = ['scan.mjs', '.agents/', '.claude/skills/', 'scaffolder/'];
const ENTRYPOINT_PATH = '.claude/skills/career-ops/SKILL.md';
const SKILL_ENTRYPOINTS = [{ path: ENTRYPOINT_PATH }];
const POINTER_TEXT = '../../../.agents/skills/career-ops/SKILL.md';

function makeOrigin() {
  const dir = mkdtempSync(join(tmpdir(), 'co-skill-drift-origin-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, '.agents/skills/career-ops'), { recursive: true });
  mkdirSync(join(dir, 'scaffolder/bin'), { recursive: true });
  writeFileSync(join(dir, 'scan.mjs'), '// scan v1\n');
  writeFileSync(join(dir, '.agents/skills/career-ops/SKILL.md'), 'canonical skill content v1\n');
  writeFileSync(join(dir, 'scaffolder/bin/skill-entrypoints.mjs'), '// entrypoints v1\n');
  g('add', '-A');
  // The entrypoint ships as a real symlink upstream: git mode 120000, blob
  // content is the pointer TEXT, not the target's content. gitIn() has no
  // stdin seam, so this one plumbing step goes through helpers.mjs's run().
  const pointerBlob = run('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: POINTER_TEXT });
  if (!pointerBlob) fail('fixture: git hash-object failed to write the pointer blob');
  g('update-index', '--add', '--cacheinfo', `120000,${pointerBlob},${ENTRYPOINT_PATH}`);
  g('commit', '-qm', 'base');
  return { dir, g };
}

// core.symlinks=false at clone time: the pointer entry checks out as a plain
// text file containing POINTER_TEXT, exactly like a real Windows install —
// never a real OS symlink, so this fixture is portable to every CI platform.
function cloneInstall(originDir) {
  const dir = mkdtempSync(join(tmpdir(), 'co-skill-drift-install-'));
  gitIn(dir, 'clone', '-q', '-c', 'core.symlinks=false', originDir, '.');
  const g = (...args) => gitIn(dir, ...args);
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  return { dir, g };
}

// Simulates ensureSkillEntrypoints() + prepareMaterializedSkillEntrypointsForStage():
// overwrite the pointer file with the canonical content, drop the 120000
// index entry so `add` re-adds it as an ordinary mode-100644 file, commit —
// exactly what apply() does and logs as "Materialized 1 skill entrypoint(s)".
function materializeAndCommit(install) {
  writeFileSync(join(install.dir, ENTRYPOINT_PATH), 'canonical skill content v1\n');
  install.g('rm', '--cached', '-f', '--', ENTRYPOINT_PATH);
  install.g('add', '-A');
  install.g('commit', '-qm', 'chore: auto-update system files to v2');
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

console.log('\n🧪 Testing updater drift detection over materialized skill entrypoints (#3149)...');

// ── 1. THE BUG, reproduced: unfiltered SYSTEM_PATHS reports permanent drift ─
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    materializeAndCommit(install);
    install.g('fetch', '-q', origin.dir, 'main');

    const modeOrigin = origin.g('ls-tree', 'HEAD', ENTRYPOINT_PATH).split(/\s+/, 1)[0];
    const modeInstall = install.g('ls-tree', 'HEAD', ENTRYPOINT_PATH).split(/\s+/, 1)[0];
    if (modeOrigin === '120000' && modeInstall === '100644') {
      pass('fixture: upstream ships the entrypoint as a symlink, the install committed a materialized regular file');
    } else {
      fail(`fixture did not reproduce the mode split (origin=${modeOrigin}, install=${modeInstall})`);
    }

    const runGit = (...a) => gitIn(install.dir, ...a);
    if (systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD', { git: runGit }) === true) {
      pass('unfiltered SYSTEM_PATHS reports the materialized entrypoint as drift — the bug, reproduced');
    } else {
      fail('fixture did not reproduce #3149 — unfiltered diff unexpectedly reported no drift');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 2. THE FIX: excluding the entrypoint clears the false positive ─────────
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    materializeAndCommit(install);
    install.g('fetch', '-q', origin.dir, 'main');

    const runGit = (...a) => gitIn(install.dir, ...a);
    const excludedPaths = driftPathspecExcludingSkillEntrypoints(SYSTEM_PATHS, SKILL_ENTRYPOINTS);
    if (systemTreeDiffers(excludedPaths, 'FETCH_HEAD', { git: runGit }) === false) {
      pass('excluding the materialized entrypoint clears the false-positive drift');
    } else {
      fail('materialized entrypoint still reads as drift after the exclusion — the fix did not take');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 3. Nothing hidden: a real change to the canonical skill file still drifts ─
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    materializeAndCommit(install);
    install.g('fetch', '-q', origin.dir, 'main');

    writeFileSync(join(origin.dir, '.agents/skills/career-ops/SKILL.md'), 'canonical skill content v2\n');
    origin.g('add', '-A');
    origin.g('commit', '-qm', 'genuine skill content update');
    install.g('fetch', '-q', origin.dir, 'main');

    const runGit = (...a) => gitIn(install.dir, ...a);
    const excludedPaths = driftPathspecExcludingSkillEntrypoints(SYSTEM_PATHS, SKILL_ENTRYPOINTS);
    if (systemTreeDiffers(excludedPaths, 'FETCH_HEAD', { git: runGit }) === true) {
      pass('a genuine upstream change to the canonical skill document is still detected as drift');
    } else {
      fail('REGRESSION: a real content change to .agents/skills/career-ops/SKILL.md was hidden by the exclusion');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 4. Nothing hidden: a real change to the entrypoint mechanism still drifts ─
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    materializeAndCommit(install);
    install.g('fetch', '-q', origin.dir, 'main');

    writeFileSync(join(origin.dir, 'scaffolder/bin/skill-entrypoints.mjs'), '// entrypoints v2 — new CLI added\n');
    origin.g('add', '-A');
    origin.g('commit', '-qm', 'genuine entrypoint mechanism update');
    install.g('fetch', '-q', origin.dir, 'main');

    const runGit = (...a) => gitIn(install.dir, ...a);
    const excludedPaths = driftPathspecExcludingSkillEntrypoints(SYSTEM_PATHS, SKILL_ENTRYPOINTS);
    if (systemTreeDiffers(excludedPaths, 'FETCH_HEAD', { git: runGit }) === true) {
      pass('a genuine upstream change to the entrypoint mechanism (scaffolder/) is still detected as drift');
    } else {
      fail('REGRESSION: a real change under scaffolder/ was hidden by the exclusion');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 5. An empty skillEntrypoints list is a no-op ───────────────────────────
{
  const base = ['scan.mjs', 'modes/'];
  const result = driftPathspecExcludingSkillEntrypoints(base, []);
  if (result.length === base.length && result.every((p, i) => p === base[i])) {
    pass('an empty skillEntrypoints list leaves the pathspec unchanged');
  } else {
    fail(`empty skillEntrypoints list changed the pathspec: ${JSON.stringify(result)}`);
  }
}

// ── 6. Multiple entrypoints each get their own exclude pathspec ───────────
{
  const base = ['scan.mjs'];
  const entrypoints = [{ path: 'a/SKILL.md' }, { path: 'b/SKILL.md' }];
  const result = driftPathspecExcludingSkillEntrypoints(base, entrypoints);
  if (result.length === 3 && result.includes(':(exclude)a/SKILL.md') && result.includes(':(exclude)b/SKILL.md')) {
    pass('each skill entrypoint contributes its own :(exclude) pathspec');
  } else {
    fail(`multi-entrypoint exclusion malformed: ${JSON.stringify(result)}`);
  }
}

// ── 7. check() itself is actually wired to the exclusion, not just the
//    standalone helper (santifer's review on #4216) ───────────────────────
//    Every case above drives driftPathspecExcludingSkillEntrypoints() and
//    systemTreeDiffers() directly against a throwaway repo — proving the
//    HELPER is correct, never that check()'s own call site actually routes
//    through it rather than the old unfiltered `systemTreeDiffers(SYSTEM_
//    PATHS, 'FETCH_HEAD')`. check() is not exported and drives a real
//    network fetch against CANONICAL_REPO, so it is not something this
//    throwaway-repo harness can call directly; a source-level assertion is
//    the narrowest thing that actually pins the wiring, matching this
//    repo's existing convention for call-site guards it cannot otherwise
//    exercise (see e.g. updater-migration-tests.mjs's source-pattern checks).
{
  const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  // Anchored on the exact call this file's own doc comment (top) and PR
  // description cite: systemTreeDiffers's first argument must be the
  // filtered pathspec, not the raw SYSTEM_PATHS list.
  const wired = /systemTreeDiffers\(\s*driftPathspecExcludingSkillEntrypoints\(\s*SYSTEM_PATHS\s*,\s*SKILL_ENTRYPOINTS\s*\)\s*,\s*['"]FETCH_HEAD['"]/.test(source);
  if (wired) {
    pass("check()'s systemTreeDiffers() call is wired through driftPathspecExcludingSkillEntrypoints(), not the raw SYSTEM_PATHS list");
  } else {
    fail("REGRESSION: check() no longer routes systemTreeDiffers() through driftPathspecExcludingSkillEntrypoints() — a materialized-entrypoint install would report permanent false drift again");
  }
}
