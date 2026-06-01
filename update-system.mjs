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

import { execFileSync, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const CANONICAL_REPO = 'https://github.com/santifer/career-ops.git';
const RAW_VERSION_URL = 'https://raw.githubusercontent.com/santifer/career-ops/main/VERSION';
const RELEASES_API = 'https://api.github.com/repos/santifer/career-ops/releases/latest';

// System layer paths — ONLY these files get updated
const SYSTEM_PATHS = [
  'modes/_shared.md',
  'modes/_profile.template.md',
  'modes/oferta.md',
  'modes/pdf.md',
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
  'modes/latex.md',
  'modes/de/',
  'modes/fr/',
  'modes/ja/',
  'modes/pt/',
  'modes/ru/',
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  'generate-pdf.mjs',
  'generate-latex.mjs',
  'merge-tracker.mjs',
  'verify-pipeline.mjs',
  'dedup-tracker.mjs',
  'normalize-statuses.mjs',
  'cv-sync-check.mjs',
  'update-system.mjs',
  'scan.mjs',
  'providers/',
  'doctor.mjs',
  'check-liveness.mjs',
  'liveness-core.mjs',
  'liveness-browser.mjs',
  'analyze-patterns.mjs',
  'followup-cadence.mjs',
  'gemini-eval.mjs',
  'test-all.mjs',
  'batch/batch-prompt.md',
  'batch/batch-runner.sh',
  'dashboard/',
  'templates/',
  'fonts/',
  '.agents/',
  '.claude/skills/',
  '.gemini/commands/',
  'docs/',
  'writing-samples/README.md',
  'VERSION',
  'DATA_CONTRACT.md',
  'CONTRIBUTING.md',
  'README.md',
  'LICENSE',
  'CITATION.cff',
  '.github/',
  'package.json',
];

// User layer paths — NEVER touch these (safety check)
const USER_PATHS = [
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'portals.yml',
  'article-digest.md',
  'interview-prep/story-bank.md',
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

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000 }).trim();
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

function revertPaths(paths) {
  if (paths.length === 0) return;
  git('checkout', '--', ...paths);
}

function addPaths(paths) {
  if (paths.length === 0) return;
  git('add', '--', ...paths);
}

// ── CHECK ───────────────────────────────────────────────────────

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

  // Fetch both sources in parallel — only fail offline if BOTH are unreachable.
  // Use AbortSignal so a hung TCP connection can't stall the session-start check.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  let versionResult, releaseResult;
  try {
    [versionResult, releaseResult] = await Promise.allSettled([
      fetch(RAW_VERSION_URL, { signal: controller.signal }),
      fetch(RELEASES_API, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'career-ops-update-checker',
        },
        signal: controller.signal,
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }

  const SEMVER_RE = /^v?(\d+\.\d+\.\d+)$/i;

  if (versionResult.status === 'fulfilled' && versionResult.value.ok) {
    try {
      const raw = parseVersionFile(await versionResult.value.text());
      const match = raw.match(SEMVER_RE);
      remote = match ? match[1] : '';
    } catch {
      // Body read failed; treat as no VERSION source
    }
  }

  if (releaseResult.status === 'fulfilled' && releaseResult.value.ok) {
    try {
      const release = await releaseResult.value.json();
      changelog = release.body || '';
      const rawTag = String(release.tag_name || '').trim();
      const match = rawTag.match(SEMVER_RE);
      releaseVersion = match ? match[1] : '';
    } catch {
      // Body parse failed; treat as no release source
    }
  }

  if (!remote && !releaseVersion) {
    // Distinguish true network failures from "fetched OK but response was
    // unparseable" — the latter shouldn't be silenced as offline since the
    // network is actually fine.
    const bothNetworkFailed =
      versionResult.status !== 'fulfilled' &&
      releaseResult.status !== 'fulfilled';
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

  // Check for lock
  const lockFile = join(ROOT, '.update-lock');
  if (existsSync(lockFile)) {
    console.error('Update already in progress (.update-lock exists). If stuck, delete it manually.');
    process.exit(1);
  }

  // Create lock
  writeFileSync(lockFile, new Date().toISOString());

  try {
    // 1. Backup: create branch
    const backupBranch = `backup-pre-update-${local}`;
    try {
      git('branch', backupBranch);
      console.log(`Backup branch created: ${backupBranch}`);
    } catch {
      console.log(`Backup branch already exists (${backupBranch}), continuing...`);
    }

    // 2. Fetch from canonical repo
    console.log('Fetching latest from upstream...');
    git('fetch', CANONICAL_REPO, 'main');

    // 3. Checkout system files only
    console.log('Updating system files...');
    const updated = [];

    // 3a. Bootstrap newly-introduced paths that the local update-system.mjs
    // doesn't yet know about. Without this, cross-version migrations where
    // a path is added to SYSTEM_PATHS by the new version can leave dangling
    // symlinks — e.g. v1.6.x → v1.7.x where .agents/ was introduced but the
    // local v1.6.x SYSTEM_PATHS didn't include it, so `.agents/` was never
    // checked out while `.claude/skills/` was updated to symlink into it.
    // See: https://github.com/santifer/career-ops/issues/649
    const BOOTSTRAP_PATHS = ['.agents/', 'providers/', 'liveness-browser.mjs'];
    for (const path of BOOTSTRAP_PATHS) {
      if (SYSTEM_PATHS.includes(path)) continue; // already in main loop
      try {
        git('checkout', 'FETCH_HEAD', '--', path);
        updated.push(path);
      } catch {
        // Path may not exist in FETCH_HEAD yet
      }
    }

    for (const path of SYSTEM_PATHS) {
      try {
        git('checkout', 'FETCH_HEAD', '--', path);
        updated.push(path);
      } catch {
        // File may not exist in remote (new additions), skip
      }
    }

    // 4. Validate: check NO user files were touched.
    //
    // Track which user paths the update unexpectedly touched so we
    // can revert them too — reverting only `updated` would leave the
    // repo in a half-applied state with the user-layer changes still
    // staged.
    const violatedUserPaths = new Set();
    try {
      for (const entry of gitStatusEntries()) {
        const file = entry.path;
        if (initialStatusPaths.has(file)) continue;
        // Explicit SYSTEM_PATHS entries override USER_PATHS prefix matches.
        // (e.g. writing-samples/README.md is system-owned doc inside a user dir.)
        if (SYSTEM_PATHS.includes(file)) continue;
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
      console.error('Aborting: user files were touched. Rolling back...');
      // Revert BOTH the system-layer updates and the user-layer paths
      // the update unexpectedly modified — otherwise the repo is left
      // in a half-applied state.
      const violation = new Error('Update aborted: user files were touched.');
      try {
        revertPaths([...updated, ...violatedUserPaths]);
      } catch (revertErr) {
        // If the revert itself fails, don't lose the safety-violation
        // diagnostic — chain it via `cause` so the user sees both.
        throw new Error(
          `Safety violation (${violation.message}) and revert also failed (${revertErr.message})`,
          { cause: violation },
        );
      }
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

    // 6. Commit the update
    const remote = localVersion(); // Re-read after checkout updated VERSION
    try {
      const pathsToStage = [...updated];
      const dismissFile = join(ROOT, '.update-dismissed');
      if (existsSync(dismissFile)) {
        unlinkSync(dismissFile);
        pathsToStage.push('.update-dismissed');
      }
      addPaths(pathsToStage);
      git('commit', '-m', `chore: auto-update system files to v${remote}`);
    } catch {
      // Nothing to commit (already up to date)
    }

    console.log(`\nUpdate complete: v${local} → v${remote}`);
    console.log(`Updated ${updated.length} system paths.`);
    console.log(`Rollback available: node update-system.mjs rollback`);

  } finally {
    // Remove lock
    if (existsSync(lockFile)) unlinkSync(lockFile);
  }
}

// ── ROLLBACK ────────────────────────────────────────────────────

function rollback() {
  // Find most recent backup branch
  try {
    const branches = git('for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads/backup-pre-update-*');
    const branchList = branches.split('\n').map(b => b.trim()).filter(Boolean);

    if (branchList.length === 0) {
      console.error('No backup branches found. Nothing to rollback.');
      process.exit(1);
    }

    const latest = branchList[0];
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
    try {
      git('commit', '-m', `chore: rollback system files from ${latest}`);
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
