/**
 * updater-no-checkout-guard.test.mjs — an install that is not a git checkout.
 *
 * The nested-install guard (#3334, tests/updater-nested-checkout-guard.test.mjs)
 * covers a .git-less copy that sits inside ANOTHER repository. A .git-less copy
 * that sits inside no repository at all — a ZIP download unpacked on its own, a
 * copy made without its .git — fell through it: gitToplevelMismatch() returns
 * null there, so apply() went on to its first git call and died with git's raw
 * "fatal: not a git repository", and check still reported up-to-date or
 * update-available, offering an update apply could never install.
 *
 * Same fixture model as the nested test: update-system.mjs is self-loading by
 * contract (#1706), so it and VERSION are a faithful copy of that install.
 * GIT_CEILING_DIRECTORIES stops git from walking above the fixture, so the
 * test holds even when the temp directory sits inside some repository.
 */

import { mkdtempSync, copyFileSync, existsSync, realpathSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { pass, fail, NODE, ROOT, rmSync, hermeticGitEnv } from './helpers.mjs';

console.log('\n🧪 Testing updater on an install that is not a git checkout...');

function makeFixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'co-nogit-')));
  copyFileSync(join(ROOT, 'update-system.mjs'), join(dir, 'update-system.mjs'));
  copyFileSync(join(ROOT, 'VERSION'), join(dir, 'VERSION'));
  return dir;
}

function runUpdater(dir, ...args) {
  return spawnSync(NODE, ['update-system.mjs', ...args], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 60000,
    env: {
      ...hermeticGitEnv(join(dir, 'hermetic-gitconfig')),
      GIT_CEILING_DIRECTORIES: dirname(dir),
    },
  });
}

// ── 1. check: reports the layout instead of a version verdict ──
{
  const dir = makeFixture();
  try {
    const res = runUpdater(dir, 'check');
    let out;
    try { out = JSON.parse(res.stdout); } catch { out = undefined; }
    if (res.status === 0 && out?.status === 'not-a-git-checkout' && out.local) {
      pass('check reports not-a-git-checkout with the local version');
    } else {
      fail(`check on a non-checkout exited ${res.status} with stdout ${JSON.stringify(res.stdout.slice(0, 200))}`);
    }
    if (res.stderr.trim() === '') {
      pass('check prints nothing on stderr');
    } else {
      fail(`check leaked onto stderr: ${JSON.stringify(res.stderr.slice(0, 200))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2. apply: refuses with the reclone advice, not git's raw error ──
{
  const dir = makeFixture();
  try {
    const res = runUpdater(dir, 'apply', '--confirm');
    if (res.status !== 0 && res.stderr.includes('is not a git checkout') && res.stderr.includes('git clone')) {
      pass('apply refuses a non-checkout with an actionable error');
    } else {
      fail(`apply on a non-checkout exited ${res.status} with stderr ${JSON.stringify(res.stderr.slice(0, 200))}`);
    }
    if (!/fatal: not a git repository|Command failed/.test(res.stderr)) {
      pass('apply does not surface a raw git failure');
    } else {
      fail(`apply still surfaced git's raw error: ${JSON.stringify(res.stderr.slice(0, 200))}`);
    }
    if (!existsSync(join(dir, '.update-lock'))) {
      pass('apply refuses before taking the update lock');
    } else {
      fail('apply left .update-lock behind after refusing');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 3. rollback: same precondition ──
{
  const dir = makeFixture();
  try {
    const res = runUpdater(dir, 'rollback');
    if (res.status !== 0 && res.stderr.includes('is not a git checkout')) {
      pass('rollback refuses a non-checkout with the same error');
    } else {
      fail(`rollback on a non-checkout exited ${res.status} with stderr ${JSON.stringify(res.stderr.slice(0, 200))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
