/**
 * updater-drift-detection.test.mjs — check() must not report
 * system-files-changed for a healthy post-apply install.
 *
 * The regression: apply() never fast-forwards HEAD to upstream main. It
 * checks out upstream content and commits it as a NEW local commit on the
 * install's own history, so after ANY successful update HEAD's SHA can never
 * equal upstream main's SHA again. check() used to read that SHA inequality
 * directly as `system-files-changed` drift (#2630), which made every session's
 * check report "update available" forever on installs that were fully current
 * — re-running apply could never clear it.
 *
 * The fix settles same-version SHA mismatches on CONTENT:
 * systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD') diffs the committed system
 * tree against the fetched upstream ref. Only real content drift reports.
 *
 * These tests drive systemTreeDiffers() against throwaway repos through the
 * same seam production uses (ctx.git → gitIn under a root), pinning:
 *   - the apply-shaped divergence (content equal, SHAs differ) → NOT drift
 *   - genuine upstream changes to a system file                        → drift
 *   - user-layer-only differences (outside the pathspec)               → NOT drift
 *   - uncommitted working-tree edits to system files                   → NOT drift
 *     (committed-state comparison; apply()'s .bak flow owns those, #2337)
 *   - CRLF/LF-only blob differences                                    → NOT drift
 *     (pre-.gitattributes installs, #2817 rationale)
 *   - an unreadable upstream ref                                       → drift
 *     (conservative: unverifiable content keeps the old behavior)
 *   - an empty pathspec                                                → NOT drift,
 *     without invoking git at all
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { pass, fail, rmSync } from './helpers.mjs';
import { gitIn, systemTreeDiffers } from '../update-system.mjs';

// System paths the fixtures pretend this install manages. Small and stable:
// one root-level script, one modes/ file (exercises a directory-style
// pathspec component), mirroring SYSTEM_PATHS' shape without coupling the
// test to the real manifest's contents.
const SYSTEM_PATHS = ['scan.mjs', 'modes/_shared.md'];
const USER_PATH = 'data/applications.md';

function makeOrigin() {
  const dir = mkdtempSync(join(tmpdir(), 'co-drift-origin-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'core.autocrlf', 'false');
  g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'scan.mjs'), '// scan v1\n');
  writeFileSync(join(dir, 'modes', '_shared.md'), '# shared v1\n');
  writeFileSync(join(dir, USER_PATH), '| base | Acme | Intern | 4.0/5 |\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  return { dir, g };
}

function cloneInstall(originDir) {
  const dir = mkdtempSync(join(tmpdir(), 'co-drift-install-'));
  gitIn(dir, 'clone', '-q', originDir, '.');
  const g = (...args) => gitIn(dir, ...args);
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'core.autocrlf', 'false');
  g('config', 'commit.gpgsign', 'false');
  return { dir, g };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

console.log('\n🧪 Testing updater system-tree drift detection...');

// ── 1. THE REGRESSION ────────────────────────────────────────────────────────
// apply()-shaped state: install history diverged from upstream (a user-layer
// commit upstream will never have), then system content synced from
// FETCH_HEAD and committed locally. SHAs differ; committed system content is
// identical. This is every healthy install the day after an update — it must
// read as NOT drift.
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    // Install diverges: a user-layer commit upstream does not have.
    writeFileSync(join(install.dir, USER_PATH), '| 60 | 2026-08-21 | Acme | Intern | 4.0/5 |\n');
    install.g('add', '-A');
    install.g('commit', '-qm', 'track application');

    // Upstream moves ahead with a system-file change…
    writeFileSync(join(origin.dir, 'scan.mjs'), '// scan v2\n');
    origin.g('add', '-A');
    origin.g('commit', '-qm', 'fix scanner');

    // …and apply() syncs it as a NEW local commit (never a fast-forward).
    install.g('fetch', '-q', origin.dir, 'main');
    install.g('checkout', 'FETCH_HEAD', '--', ...SYSTEM_PATHS);
    install.g('commit', '-qm', 'chore: auto-update system files');

    const shaLocal = install.g('rev-parse', 'HEAD');
    const shaRemote = install.g('rev-parse', 'FETCH_HEAD');
    if (shaLocal !== shaRemote) {
      pass('fixture: post-apply HEAD differs from upstream SHA');
    } else {
      fail('fixture: expected post-apply HEAD SHA to differ from upstream');
    }

    if (systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD', { git: (...a) => gitIn(install.dir, ...a) }) === false) {
      pass('post-apply install (equal content, diverged SHA) is NOT drift');
    } else {
      fail('post-apply install (equal content, diverged SHA) reported as drift — the false positive is back');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 2. Real drift: upstream changed a system file, install has not ─────────
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    writeFileSync(join(origin.dir, 'scan.mjs'), '// scan v2\n');
    origin.g('add', '-A');
    origin.g('commit', '-qm', 'fix scanner');
    install.g('fetch', '-q', origin.dir, 'main');

    if (systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD', { git: (...a) => gitIn(install.dir, ...a) }) === true) {
      pass('genuine upstream system-file change IS drift');
    } else {
      fail('genuine upstream system-file change NOT reported as drift');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 3. User-layer-only differences are outside the pathspec ────────────────
// A file that exists BOTH sides but differs only in the user layer must not
// flip the verdict — scoping to SYSTEM_PATHS is the whole point.
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    writeFileSync(join(install.dir, USER_PATH), '| 61 | 2026-08-22 | Beta | Intern | 4.2/5 |\n');
    install.g('add', '-A');
    install.g('commit', '-qm', 'track another application');
    install.g('fetch', '-q', origin.dir, 'main');

    if (systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD', { git: (...a) => gitIn(install.dir, ...a) }) === false) {
      pass('user-layer-only difference is NOT drift');
    } else {
      fail('user-layer-only difference reported as drift');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 4. Uncommitted working-tree edits to system files are NOT drift ────────
// Deliberate: preserved local edits are apply()'s .bak + messaging concern
// (#2337). Comparing committed state keeps them out of the update nag.
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    writeFileSync(join(install.dir, 'scan.mjs'), '// local uncommitted tweak\n');
    install.g('fetch', '-q', origin.dir, 'main');

    if (systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD', { git: (...a) => gitIn(install.dir, ...a) }) === false) {
      pass('uncommitted system-file edit is NOT drift (committed-state comparison)');
    } else {
      fail('uncommitted system-file edit reported as drift');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 5. CRLF/LF-only blob differences are NOT drift (#2817 rationale) ───────
// Installs that last synced before .gitattributes carry pre-renormalization
// blobs differing from upstream by line endings alone. The fixture first
// proves the CRLF difference is REAL without the flag, so the assertion
// below cannot pass vacuously.
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    writeFileSync(join(install.dir, 'modes', '_shared.md'), '# shared v1\r\n');
    install.g('add', '-A');
    install.g('commit', '-qm', 'crlf rewrite');
    install.g('fetch', '-q', origin.dir, 'main');

    let crlfDiffIsReal = false;
    try {
      gitIn(install.dir, 'diff', '--quiet', 'FETCH_HEAD', 'HEAD', '--', 'modes/_shared.md');
    } catch {
      crlfDiffIsReal = true; // exit 1 = blobs genuinely differ
    }
    if (!crlfDiffIsReal) {
      fail('fixture: expected a real CRLF blob difference before the flag-scoped check');
    }

    if (systemTreeDiffers(SYSTEM_PATHS, 'FETCH_HEAD', { git: (...a) => gitIn(install.dir, ...a) }) === false) {
      pass('CRLF/LF-only difference is NOT drift (--ignore-cr-at-eol)');
    } else {
      fail('CRLF/LF-only difference reported as drift');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 6. Unreadable upstream ref degrades conservatively to drift ────────────
// If content cannot be verified, keep the pre-fix answer (drift reported)
// rather than silently declaring a possibly-stale install up-to-date.
{
  const origin = makeOrigin();
  const install = cloneInstall(origin.dir);
  try {
    // Same seam as production gitIn, but with stderr explicitly piped:
    // execFileSync's DEFAULT stdio lets git's expected "fatal: bad revision"
    // leak onto the suite's fd2, and this scenario fails on purpose.
    const quietGit = (...args) =>
      execFileSync('git', args, {
        cwd: install.dir, encoding: 'utf-8', timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

    if (systemTreeDiffers(SYSTEM_PATHS, 'refs/heads/does-not-exist', { git: quietGit }) === true) {
      pass('unreadable upstream ref reads as drift (conservative)');
    } else {
      fail('unreadable upstream ref read as no-drift — verification failed open');
    }
  } finally {
    cleanup(origin.dir, install.dir);
  }
}

// ── 7. Empty pathspec short-circuits without invoking git ──────────────────
{
  let calls = 0;
  const countingGit = (...a) => { calls++; return gitIn(process.cwd(), ...a); };
  if (systemTreeDiffers([], 'FETCH_HEAD', { git: countingGit }) === false && calls === 0) {
    pass('empty pathspec returns false without invoking git');
  } else {
    fail(`empty pathspec misbehaved (result drift=${calls > 0 ? 'n/a' : '?'}, git calls=${calls})`);
  }
}
