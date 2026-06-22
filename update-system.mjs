#!/usr/bin/env node

/**
 * update-system.mjs — Safe auto-updater for career-ops
 *
 * Updates ONLY system layer files (modes, scripts, dashboard, templates).
 * NEVER touches user data (cv.md, profile.yml, _profile.md, data/, reports/).
 *
 * Usage:
 *   node update-system.mjs check      # Check if update available
 *   node update-system.mjs apply      # Apply update (after user confirms)
 *   node update-system.mjs rollback   # Rollback last update
 *   node update-system.mjs dismiss    # Dismiss update check
 *
 * See DATA_CONTRACT.md for the full system/user layer definitions.
 */

import { execFile, execFileSync, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, rmSync, lstatSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const CANONICAL_REPO = 'https://github.com/santifer/career-ops.git';
const RAW_VERSION_URL = 'https://raw.githubusercontent.com/santifer/career-ops/main/VERSION';
const RELEASES_API = 'https://api.github.com/repos/santifer/career-ops/releases/latest';

// Matches a semver, with or without a leading `v` and an optional
// Release Please component prefix (e.g. `career-ops-v1.9.0` → `1.9.0`).
// Anchoring on `(?:^|-)` lets the releases-API fallback parse our tags,
// which Release Please always prefixes with the component name.
export const SEMVER_RE = /(?:^|-)v?(\d+\.\d+\.\d+)$/i;

// System layer paths — ONLY these files get updated
const SYSTEM_PATHS = [
  'modes/_shared.md',
  'modes/_profile.template.md',
  'modes/oferta.md',
  'modes/pdf.md',
  'modes/cover.md',
  'modes/scan.md',
  'modes/batch.md',
  'modes/apply.md',
  'modes/auto-pipeline.md',
  'modes/contacto.md',
  'modes/deep.md',
  'modes/ofertas.md',
  'modes/pipeline.md',
  'modes/project.md',
  'modes/tracker.md',
  'modes/training.md',
  'modes/interview.md',
  'modes/latex.md',
  'modes/followup.md',
  'modes/interview-prep.md',
  'modes/patterns.md',
  'modes/update.md',
  'modes/ar/',
  'modes/de/',
  'modes/fr/',
  'modes/ja/',
  'modes/pt/',
  'modes/ru/',
  'modes/tr/',
  'modes/ua/',
  'CLAUDE.md',
  'OPENCODE.md',
  'AGENTS.md',
  'GEMINI.md',
  'generate-pdf.mjs',
  'generate-latex.mjs',
  'generate-cover-letter.mjs',
  'merge-tracker.mjs',
  'tracker-links.mjs',
  'tracker.mjs',
  'verify-pipeline.mjs',
  'reconcile-pipeline.mjs',
  'dedup-tracker.mjs',
  'role-matcher.mjs',
  'normalize-statuses.mjs',
  'cv-sync-check.mjs',
  'update-system.mjs',
  'reserve-report-num.mjs',
  'scan.mjs',
  'scan-ats-full.mjs',
  'providers/',
  'doctor.mjs',
  'check-liveness.mjs',
  'liveness-core.mjs',
  'liveness-browser.mjs',
  'analyze-patterns.mjs',
  'followup-cadence.mjs',
  'gemini-eval.mjs',
  'test-all.mjs',
  'test-salary-filter.mjs',
  'tracker-columns-tests.mjs',
  'validate-portals.mjs',
  'verify-portals.mjs',
  'updater-migration-tests.mjs',
  'batch/batch-prompt.md',
  'batch/batch-runner.sh',
  'batch/README.md',
  'dashboard/',
  'templates/',
  'fonts/',
  'examples/',
  'config/profile.example.yml',
  '.env.example',
  '.agents/',
  '.claude/skills/',
  '.opencode/skills/',
  '.claude-plugin/',
  '.qwen/',
  '.antigravitycli/skills/',
  'docs/',
  'writing-samples/README.md',
  'VERSION',
  'DATA_CONTRACT.md',
  'CONTRIBUTING.md',
  'README.md',
  'README.ar.md',
  'README.cn.md',
  'README.es.md',
  'README.fr.md',
  'README.ja.md',
  'README.ko-KR.md',
  'README.pl.md',
  'README.pt-BR.md',
  'README.ru.md',
  'README.ua.md',
  'README.zh-TW.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTORS.md',
  'GOVERNANCE.md',
  'LEGAL_DISCLAIMER.md',
  'SECURITY.md',
  'SUPPORT.md',
  'TRADEMARK.md',
  'LICENSE',
  'CITATION.cff',
  '.github/',
  'package.json',
  'build-cv-latex.mjs',
  'scaffolder/',
  'Dockerfile',
  'docker-compose.yml',
  '.dockerignore',
  'cops',
  'DOCKER.md',
];

const CANONICAL_SKILL_PATH = '.agents/skills/career-ops/SKILL.md';
const SKILL_ENTRYPOINTS = [
  {
    path: '.claude/skills/career-ops/SKILL.md',
    pointer: '../../../.agents/skills/career-ops/SKILL.md',
  },
  {
    path: '.opencode/skills/career-ops/SKILL.md',
    pointer: '../../../.agents/skills/career-ops/SKILL.md',
  },
];

// User layer paths — NEVER touch these (safety check)
const USER_PATHS = [
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'voice-dna.md',
  'portals.yml',
  'article-digest.md',
  'interview-prep/',
  'data/',
  'reports/',
  'output/',
  'jds/',
  'writing-samples/',
];

function parseVersionFile(raw) {
  // VERSION may carry a release-please marker, e.g. "1.6.0 # x-release-please-version".
  // Take the first whitespace-delimited token so the marker doesn't break semver parsing.
  return raw.trim().split(/\s+/)[0] || '';
}

function localVersion() {
  const vPath = join(ROOT, 'VERSION');
  return existsSync(vPath) ? parseVersionFile(readFileSync(vPath, 'utf-8')) : '0.0.0';
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

function updateBackupBranchName(version, date = new Date()) {
  const stamp = date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `backup-pre-update-${version}-${stamp}`;
}

function backupTimestamp(branchName) {
  const match = branchName.match(/-(\d{8}T\d{6}Z)$/);
  if (!match) return 0;
  const [date, time] = match[1].split('T');
  return Date.parse(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`,
  ) || 0;
}

function newestBackupBranch(branches) {
  const branchList = branches.split('\n').map(b => b.trim()).filter(Boolean);
  if (branchList.length === 0) return null;

  // Prefer timestamped backup branches created by current versions. Older
  // backups are still accepted below for rollback compatibility.
  const timestamped = branchList
    .map(branch => ({ branch, timestamp: backupTimestamp(branch) }))
    .filter(entry => entry.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp);

  return timestamped[0]?.branch || branchList[0];
}

function gitIn(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 30000 }).trim();
}

function git(...args) {
  return gitIn(ROOT, ...args);
}

function gitStatusEntries() {
  const status = git('status', '--porcelain');
  if (!status) return [];

  return status.split('\n')
    .filter(Boolean)
    .map(line => ({
      code: line.slice(0, 2),
      path: line.slice(3),
    }));
}

function extractArrayFromSource(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) return [];
  return Array.from(match[1].matchAll(/['"]([^'"]+)['"]/g), (entry) => entry[1]);
}

function mergePathLists(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const path of list) {
      if (seen.has(path)) continue;
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}

function repoPath(root, path) {
  return join(root, ...path.split('/'));
}

export function materializeSkillEntrypoints(root = ROOT) {
  const canonicalPath = repoPath(root, CANONICAL_SKILL_PATH);
  if (!existsSync(canonicalPath)) return [];

  let canonicalContent = '';
  try {
    canonicalContent = readFileSync(canonicalPath, 'utf-8');
  } catch {
    return [];
  }
  const materialized = [];

  for (const entry of SKILL_ENTRYPOINTS) {
    const entryPath = repoPath(root, entry.path);
    if (!existsSync(entryPath)) continue;

    let stat = null;
    try {
      stat = lstatSync(entryPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (!stat.isFile()) continue;

    try {
      const content = readFileSync(entryPath, 'utf-8').trim();
      if (content !== entry.pointer) continue;
      writeFileSync(entryPath, canonicalContent);
    } catch {
      continue;
    }
    materialized.push(entry.path);
  }

  return materialized;
}

export function prepareMaterializedSkillEntrypointsForStage(paths, root = ROOT) {
  const prepared = [];
  for (const path of paths) {
    const entry = gitIn(root, 'ls-files', '-s', '--', path);
    if (!entry) continue;

    const mode = entry.split(/\s+/, 1)[0];
    if (mode === '120000') {
      gitIn(root, 'rm', '--cached', '-f', '--', path);
    }
    prepared.push(path);
  }
  return prepared;
}

function revertPaths(paths) {
  if (paths.length === 0) return;
  // Must restore from HEAD, not from the index (#915 bug 1). After
  // `git checkout FETCH_HEAD -- <path>` the index already holds the new
  // content, so `git checkout -- <path>` (index→worktree) is a no-op.
  // `git checkout HEAD -- <path>` resets both the index and the worktree
  // to the pre-update commit, which is the correct rollback target.
  for (const p of paths) {
    try {
      git('checkout', 'HEAD', '--', p);
    } catch (err) {
      const pathspec = p.endsWith('/') ? p.slice(0, -1) : p;
      // Only remove if the path genuinely doesn't exist in HEAD.
      // Other errors (permissions, corrupt refs) should re-throw.
      let existsInHead = true;
      try { git('cat-file', '-e', `HEAD:${pathspec}`); } catch { existsInHead = false; }
      if (existsInHead) throw err;
      // Path was newly introduced by the update — remove it so the
      // working tree is consistent with HEAD.
      try { git('rm', '-r', '-f', '--ignore-unmatch', '--', pathspec); } catch { /* ignore */ }
      try { rmSync(join(ROOT, pathspec), { recursive: true, force: true }); } catch { /* already gone */ }
    }
  }
}

function addPaths(paths) {
  if (paths.length === 0) return;
  git('add', '--', ...paths);
}

function dashboardGoSourcesChanged() {
  try {
    const changed = git('diff', '--name-only', 'HEAD', '--', 'dashboard');
    return changed
      .split('\n')
      .some(path => path.startsWith('dashboard/') && path.endsWith('.go'));
  } catch {
    return false;
  }
}

function rebuildDashboardBinaryIfNeeded() {
  if (!dashboardGoSourcesChanged()) return;

  try {
    execFileSync('go', ['build', '-o', 'career-dashboard', '.'], {
      cwd: join(ROOT, 'dashboard'),
      timeout: 60000,
      stdio: 'pipe',
    });
    console.log('dashboard binary rebuilt');
  } catch {
    console.log('dashboard binary rebuild skipped -- run: cd dashboard && go build -o career-dashboard . manually');
  }
}

// ── CHECK ───────────────────────────────────────────────────────

// curl helper used by check() — curl works inside the Claude Code sandbox
// where Node's built-in fetch() fails (ENOTFOUND) because the sandbox
// routes network traffic through an HTTP/HTTPS proxy that fetch() does
// not respect but curl handles transparently.  The --silent / --fail flags
// match the failure-handling already used throughout apply().
function curlGet(url, extraArgs = []) {
  return new Promise((resolve) => {
    execFile(
      'curl',
      ['--silent', '--fail', '--max-time', '10', ...extraArgs, url],
      { encoding: 'utf-8', timeout: 12000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

async function check() {
  // Respect dismiss flag
  if (existsSync(join(ROOT, '.update-dismissed'))) {
    console.log(JSON.stringify({ status: 'dismissed' }));
    return;
  }

  const local = localVersion();
  let remote = '';
  let releaseVersion = '';
  let changelog = '';

  // Use curl instead of fetch() so the check works inside the Claude Code
  // sandbox (see curlGet() above for rationale).  Two sources are tried;
  // both failing is the only true-offline signal.
  const [rawVersion, releaseRaw] = await Promise.all([
    curlGet(RAW_VERSION_URL),
    curlGet(RELEASES_API, [
      '--header', 'Accept: application/vnd.github.v3+json',
      '--header', 'User-Agent: career-ops-update-checker',
    ]),
  ]);

  if (rawVersion !== null) {
    try {
      const raw = parseVersionFile(rawVersion);
      const match = raw.match(SEMVER_RE);
      remote = match ? match[1] : '';
    } catch {
      // Unparseable body; treat as no VERSION source
    }
  }

  if (releaseRaw !== null) {
    try {
      const release = JSON.parse(releaseRaw);
      changelog = release.body || '';
      const rawTag = String(release.tag_name || '').trim();
      const match = rawTag.match(SEMVER_RE);
      releaseVersion = match ? match[1] : '';
    } catch {
      // Unparseable body; treat as no release source
    }
  }

  if (!remote && !releaseVersion) {
    // Both curl calls returned null → genuine network failure.
    // If one returned non-null but unparseable, remote/releaseVersion are
    // empty strings, which still reaches the offline branch — that's the
    // right conservative behaviour (no version = can't determine status).
    const bothNetworkFailed = rawVersion === null && releaseRaw === null;
    const status = bothNetworkFailed ? 'offline' : 'no-remote-version';
    console.log(JSON.stringify({ status, local }));
    return;
  }

  // Use the higher version between VERSION file and GitHub Release
  // (handles cases where VERSION file is not bumped after a release,
  // or the raw host is unreachable but the API is).
  if (!remote) {
    remote = releaseVersion;
  } else if (releaseVersion && compareVersions(releaseVersion, remote) > 0) {
    remote = releaseVersion;
  }

  if (compareVersions(local, remote) >= 0) {
    console.log(JSON.stringify({ status: 'up-to-date', local, remote }));
    return;
  }

  console.log(JSON.stringify({
    status: 'update-available',
    local,
    remote,
    changelog: changelog.slice(0, 500),
  }));
}

// ── APPLY ───────────────────────────────────────────────────────

async function apply() {
  const local = localVersion();
  const initialStatusPaths = new Set(gitStatusEntries().map(entry => entry.path));
  const isReexec = process.env.CAREER_OPS_UPDATE_REEXEC === '1';

  // Check for lock
  const lockFile = join(ROOT, '.update-lock');
  if (existsSync(lockFile) && !isReexec) {
    console.error('Update already in progress (.update-lock exists). If stuck, delete it manually.');
    process.exit(1);
  }

  // Create lock
  if (!isReexec) {
    writeFileSync(lockFile, new Date().toISOString());
  }

  try {
    // 1. Backup: create branch + stash uncommitted work (#915 bug 3).
    // The branch only captures committed state; any uncommitted edits are
    // invisible to `git branch` and can be lost if the update aborts.
    // `git stash create` builds a stash object without touching the stash
    // stack, giving a recoverable ref for WIP even if the update fails.
    const backupBranch = process.env.CAREER_OPS_UPDATE_BACKUP_BRANCH || updateBackupBranchName(local);
    if (!isReexec) {
      try {
        const wip = git('stash', 'create');
        if (wip) {
          git('update-ref', `refs/backup-pre-update-wip/${local}`, wip);
          console.log(`WIP stash ref saved: refs/backup-pre-update-wip/${local} (recover with: git stash apply refs/backup-pre-update-wip/${local})`);
        }
      } catch {
        // Non-fatal: stash creation can fail in bare repos or empty trees.
      }
      git('branch', backupBranch);
      console.log(`Backup branch created: ${backupBranch}`);
    }

    // 2. Fetch from canonical repo
    console.log('Fetching latest from upstream...');
    git('fetch', CANONICAL_REPO, 'main');

    if (!isReexec) {
      try {
        git('checkout', 'FETCH_HEAD', '--', 'update-system.mjs');
        execFileSync(process.execPath, ['update-system.mjs', 'apply'], {
          cwd: ROOT,
          stdio: 'inherit',
          timeout: 120000,
          env: {
            ...process.env,
            CAREER_OPS_UPDATE_REEXEC: '1',
            CAREER_OPS_UPDATE_BACKUP_BRANCH: backupBranch,
          },
        });
        return;
      } catch (err) {
        console.error(`Updater self-reexec failed: ${err.message}`);
        throw err;
      }
    }

    // 3. Checkout system files only
    console.log('Updating system files...');
    const updated = [];
    let remoteSystemPaths = [];
    try {
      const remoteUpdaterSource = git('show', 'FETCH_HEAD:update-system.mjs');
      remoteSystemPaths = extractArrayFromSource(remoteUpdaterSource, 'SYSTEM_PATHS');
    } catch {
      // Older targets may not have update-system.mjs. Fall back to the
      // local manifest plus bootstrap paths below.
    }

    // 3a. Keep bootstrap paths as a fallback for very old targets, but the
    // target updater's SYSTEM_PATHS is now the source of truth for new files.
    const BOOTSTRAP_PATHS = ['.agents/', '.opencode/skills/', '.antigravitycli/skills/', 'providers/', 'liveness-browser.mjs', 'tracker-links.mjs', 'role-matcher.mjs', 'scaffolder/', 'reserve-report-num.mjs', 'updater-migration-tests.mjs', 'validate-portals.mjs', 'tracker-columns-tests.mjs'];
    const updatePaths = mergePathLists(SYSTEM_PATHS, remoteSystemPaths, BOOTSTRAP_PATHS);

    for (const path of updatePaths) {
      try {
        git('checkout', 'FETCH_HEAD', '--', path);
        updated.push(path);
      } catch {
        // File may not exist in remote (new additions), skip
      }
    }

    const materializedSkillEntrypoints = materializeSkillEntrypoints();
    if (materializedSkillEntrypoints.length > 0) {
      for (const path of materializedSkillEntrypoints) {
        if (!updated.includes(path)) updated.push(path);
      }
      console.log(`Materialized ${materializedSkillEntrypoints.length} skill entrypoint(s) for filesystems without symlink support`);
    }

    // 4. Validate: check NO user files were touched.
    //
    // Track which user paths the update unexpectedly touched so we
    // can exclude them from the revert and log what was preserved.
    const violatedUserPaths = new Set();
    try {
      for (const entry of gitStatusEntries()) {
        const file = entry.path;
        if (initialStatusPaths.has(file)) continue;
        // Explicit SYSTEM_PATHS entries override USER_PATHS prefix matches.
        // (e.g. writing-samples/README.md is system-owned doc inside a user dir.)
        if (updatePaths.includes(file)) continue;
        for (const userPath of USER_PATHS) {
          if (file.startsWith(userPath)) {
            console.error(`SAFETY VIOLATION: User file was modified: ${file}`);
            violatedUserPaths.add(file);
          }
        }
      }
    } catch (err) {
      // Fail closed: if we can't validate the safety invariant we must
      // not silently proceed — that would let a real violation slip
      // through. Revert what we already applied and abort.
      console.error(`Aborting: could not validate user-layer safety (${err.message}).`);
      try {
        revertPaths(updated);
      } catch (revertErr) {
        // If the revert itself fails (likely whatever broke `git
        // status` also broke `git checkout --`), don't lose the
        // original validation error — chain it via `cause`.
        throw new Error(
          `Validation failed (${err.message}) and revert also failed (${revertErr.message})`,
          { cause: err },
        );
      }
      throw err;
    }

    if (violatedUserPaths.size > 0) {
      console.error('Aborting: user files were touched. Rolling back system files...');
      // Revert ONLY the system-layer updates — never `git checkout` the
      // violated user paths back to HEAD. Doing so would overwrite the
      // user's working-tree content (accumulated STAR+R stories, local
      // edits) with whatever is committed upstream, causing data loss.
      // The user files were flagged as touched by the update, not by the
      // user; leaving them as-is is the safe choice — the user decides
      // what to do with them.
      const violation = new Error('Update aborted: user files were touched.');
      try {
        revertPaths([...updated]);
      } catch (revertErr) {
        // If the revert itself fails, don't lose the safety-violation
        // diagnostic — chain it via `cause` so the user sees both.
        throw new Error(
          `Safety violation (${violation.message}) and revert also failed (${revertErr.message})`,
          { cause: violation },
        );
      }
      console.error(`User file(s) left as-is (your content was NOT overwritten):`);
      for (const f of violatedUserPaths) console.error(`  ${f}`);
      // `throw` (not `process.exit`) so the outer `finally` runs and
      // .update-lock is removed. Exiting here would leak the lock and
      // permanently block subsequent updates until the user deletes
      // it manually.
      throw violation;
    }

    // 5. Install any new dependencies
    try {
      execSync('npm install --silent', { cwd: ROOT, timeout: 60000 });
    } catch {
      console.log('npm install skipped (may need manual run)');
    }

    // 5b. Ensure Playwright browser binary is up to date after npm install
    try {
      execSync('npx playwright install chromium', { cwd: ROOT, timeout: 120000, stdio: 'ignore' });
    } catch {
      console.log('playwright install skipped (run manually: npx playwright install chromium)');
    }

    // 6. Rebuild compiled dashboard if Go sources changed
    rebuildDashboardBinaryIfNeeded();

    // 7. Commit the update
    const remote = localVersion(); // Re-read after checkout updated VERSION
    try {
      const pathsToStage = [...updated];
      const dismissFile = join(ROOT, '.update-dismissed');
      if (existsSync(dismissFile)) {
        unlinkSync(dismissFile);
        pathsToStage.push('.update-dismissed');
      }
      prepareMaterializedSkillEntrypointsForStage(materializedSkillEntrypoints);
      addPaths(pathsToStage);
      // Scope the commit to only the staged update paths (#915 bug 2).
      // A bare `git commit` would sweep any unrelated pre-staged files into
      // the update commit. Passing the explicit pathspec list constrains the
      // commit to exactly the files this update touched.
      git('commit', '-m', `chore: auto-update system files to v${remote}`, '--', ...pathsToStage);
    } catch {
      // Nothing to commit (already up to date)
    }

    console.log(`\nUpdate complete: v${local} → v${remote}`);
    console.log(`Updated ${updated.length} system paths.`);
    console.log(`Rollback available: node update-system.mjs rollback`);

  } finally {
    // Remove lock
    if (!isReexec && existsSync(lockFile)) unlinkSync(lockFile);
  }
}

// ── ROLLBACK ────────────────────────────────────────────────────

function rollback() {
  // Find most recent backup branch
  try {
    const branches = git('for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads/backup-pre-update-*');
    const latest = newestBackupBranch(branches);

    if (!latest) {
      console.error('No backup branches found. Nothing to rollback.');
      process.exit(1);
    }

    console.log(`Rolling back to: ${latest}`);

    // Checkout system files from backup branch.
    //
    // Two failure modes for `git checkout` here:
    //   (a) the path didn't exist in the backup branch — the apply()
    //       that produced this backup was on an older version that
    //       didn't track this path yet. Rollback must DELETE the path
    //       so the working tree mirrors the backup state.
    //   (b) anything else — propagate so we don't silently leave the
    //       working tree in a partially-restored state.
    //
    // Limitation: `git checkout <ref> -- <dir>` restores blobs from
    // the backup tree but doesn't remove files that were added INSIDE
    // an already-tracked directory between backup and rollback. Rolling
    // back per-file via `git diff --name-status <backup>` would catch
    // that but is a larger change; tracked separately if it ever bites.
    const restored = [];
    const removed = [];
    for (const path of SYSTEM_PATHS) {
      try {
        git('checkout', latest, '--', path);
        restored.push(path);
      } catch (err) {
        const pathspec = path.endsWith('/') ? path.slice(0, -1) : path;
        let existedInBackup = true;
        try {
          git('cat-file', '-e', `${latest}:${pathspec}`);
        } catch {
          existedInBackup = false;
        }
        if (existedInBackup) {
          throw err;
        }
        // Path was introduced by a later apply() — remove it so the
        // tree truly matches the backup. `git rm` stages the deletion
        // for tracked files; `rmSync` cleans up the untracked-but-
        // on-disk case (e.g. an apply() that crashed between checkout
        // and commit, leaving the path untracked locally).
        git('rm', '-r', '-f', '--ignore-unmatch', '--', pathspec);
        try {
          rmSync(join(ROOT, pathspec), { recursive: true, force: true });
        } catch {
          // Already gone, or not present on disk — fine.
        }
        removed.push(pathspec);
      }
    }

    if (restored.length > 0) addPaths(restored);
    const rollbackPaths = [...restored, ...removed];
    try {
      // Scope the commit to the rollback paths (#915 bug 2). A bare
      // `git commit` would sweep unrelated staged files into the rollback.
      if (rollbackPaths.length > 0) {
        git('commit', '-m', `chore: rollback system files from ${latest}`, '--', ...rollbackPaths);
      }
    } catch {
      // Tolerate any commit failure here — the common case is the
      // "nothing to commit" no-op when the working tree already
      // matched the backup (e.g. user ran rollback twice). This
      // mirrors apply()'s broad-catch in the commit step; narrowing
      // to a specific git-error string is fragile and would diverge
      // from that pattern. Genuine setup problems (hooks, signing,
      // disk full) will resurface on the next normal git operation.
    }

    console.log(`Rollback complete. Restored ${restored.length} path(s) from ${latest}, removed ${removed.length} path(s) added after the backup.`);
    console.log('Your data (CV, profile, tracker, reports) was not affected.');
  } catch (err) {
    console.error('Rollback failed:', err.message);
    process.exit(1);
  }
}

// ── DISMISS ─────────────────────────────────────────────────────

function dismiss() {
  writeFileSync(join(ROOT, '.update-dismissed'), new Date().toISOString());
  console.log('Update check dismissed. Run "node update-system.mjs check" or say "check for updates" to re-enable.');
}

// ── MAIN ────────────────────────────────────────────────────────

// Only run the CLI when executed directly, so importing this module
// (e.g. from test-all.mjs to exercise SEMVER_RE) does not trigger a
// live update check.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2] || 'check';

  try {
    switch (cmd) {
      case 'check': await check(); break;
      case 'apply': await apply(); break;
      case 'rollback': rollback(); break;
      case 'dismiss': dismiss(); break;
      default:
        console.log('Usage: node update-system.mjs [check|apply|rollback|dismiss]');
        process.exit(1);
    }
  } catch (err) {
    // Subcommands now `throw` on aborts so their outer `finally` blocks
    // run (e.g. apply() must release `.update-lock`). Print a clean
    // message here instead of letting Node spit out a stack trace.
    console.error(err.message || err);
    process.exit(1);
  }
}
