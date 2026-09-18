/**
 * updater-nested-checkout-guard.test.mjs — nested .git-less install guard (#3334).
 *
 * A career-ops install with no `.git` of its own that sits inside another
 * repository (a ZIP unpacked into an existing project) used to make every git
 * call in update-system.mjs resolve to that OUTER repo: check() reported a
 * phantom system-files-changed against a stranger's history, and apply()
 * created its backup branch and fetched upstream into a repository that has
 * nothing to do with career-ops, then failed on pathspecs prefixed by the
 * install's subpath — `git checkout FETCH_HEAD -- update-system.mjs` is the
 * failing path from the original report.
 *
 * The behavioral sections spawn the real CLI inside a throwaway outer repo.
 * That is possible without staging the whole tree because update-system.mjs is
 * self-loading by contract (#1706): copying just it and VERSION is a faithful
 * model of the ZIP install that triggers the bug.
 */

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, realpathSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, NODE, ROOT, rmSync, hermeticGitEnv } from './helpers.mjs';
import { gitIn, gitToplevelMismatch } from '../update-system.mjs';

console.log('\n🧪 Testing updater nested-checkout guard (#3334)...');

const canonicalize = realpathSync.native ?? realpathSync;

// An outer repo with a .git-less career-ops copy at tools/career-ops, committed
// as vendored content — the layout the ZIP install produces.
function makeNestedFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'co-nested-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  // Without these, a contributor's global gpg signer or hooksPath kills the
  // fixture commits below (#2754) — same two lines as the sibling fixtures.
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  // The vendored copy is added with LF content; without this, Windows git
  // prints a CRLF warning per file into every section's output.
  g('config', 'core.autocrlf', 'false');
  const nested = join(dir, 'tools', 'career-ops');
  mkdirSync(nested, { recursive: true });
  copyFileSync(join(ROOT, 'update-system.mjs'), join(nested, 'update-system.mjs'));
  copyFileSync(join(ROOT, 'VERSION'), join(nested, 'VERSION'));
  g('add', '-A');
  g('commit', '-qm', 'vendored');
  return { dir, g, nested };
}

function runUpdater(fixture, cmd) {
  return spawnSync(NODE, ['update-system.mjs', cmd], {
    cwd: fixture.nested,
    encoding: 'utf-8',
    timeout: 60000,
    env: hermeticGitEnv(join(fixture.dir, 'hermetic-gitconfig')),
  });
}

// ── 1. gitToplevelMismatch: the unit seam ──
{
  const fixture = makeNestedFixture();
  try {
    const foreign = gitToplevelMismatch(fixture.nested);
    if (foreign && canonicalize(foreign) === canonicalize(fixture.dir)) {
      pass('gitToplevelMismatch names the enclosing repo for a nested .git-less install');
    } else {
      fail(`gitToplevelMismatch returned ${JSON.stringify(foreign)} for a nested install (expected the outer repo)`);
    }
    if (gitToplevelMismatch(fixture.dir) === null) {
      pass('gitToplevelMismatch is null for a repo that is its own toplevel');
    } else {
      fail('gitToplevelMismatch reported a mismatch for a healthy toplevel checkout');
    }
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}

// ── 2. check: reports the layout as a status and touches nothing ──
{
  const fixture = makeNestedFixture();
  try {
    const res = runUpdater(fixture, 'check');
    let status;
    try { status = JSON.parse(res.stdout).status; } catch { status = undefined; }
    if (res.status === 0 && status === 'not-a-git-toplevel') {
      pass('check reports not-a-git-toplevel instead of diffing the outer repo');
    } else {
      fail(`check on a nested install exited ${res.status} with stdout ${JSON.stringify(res.stdout.slice(0, 200))}`);
    }
    if (!existsSync(join(fixture.dir, '.git', 'FETCH_HEAD'))) {
      pass('check leaves the outer repo\'s FETCH_HEAD alone');
    } else {
      fail('check fetched into the outer repository');
    }
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}

// ── 3. apply: refuses before the first side effect ──
{
  const fixture = makeNestedFixture();
  try {
    const res = runUpdater(fixture, 'apply');
    if (res.status !== 0 && res.stderr.includes('enclosing repository')) {
      pass('apply refuses a nested .git-less install with an actionable error');
    } else {
      fail(`apply on a nested install exited ${res.status} with stderr ${JSON.stringify(res.stderr.slice(0, 200))}`);
    }
    const branches = fixture.g('for-each-ref', '--format=%(refname:short)', 'refs/heads/backup-pre-update-*');
    if (branches === '') {
      pass('apply creates no backup branch in the outer repository');
    } else {
      fail(`apply left backup branches in the outer repository: ${branches}`);
    }
    if (!existsSync(join(fixture.dir, '.git', 'FETCH_HEAD'))) {
      pass('apply never fetches into the outer repository');
    } else {
      fail('apply fetched upstream into the outer repository\'s FETCH_HEAD');
    }
    if (!existsSync(join(fixture.nested, '.update-lock'))) {
      pass('apply refuses before taking the update lock');
    } else {
      fail('apply left .update-lock behind after refusing');
    }
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}

// ── 4. rollback: same precondition ──
{
  const fixture = makeNestedFixture();
  try {
    const res = runUpdater(fixture, 'rollback');
    if (res.status !== 0 && res.stderr.includes('enclosing repository')) {
      pass('rollback refuses a nested .git-less install instead of reading the outer repo\'s branches');
    } else {
      fail(`rollback on a nested install exited ${res.status} with stderr ${JSON.stringify(res.stderr.slice(0, 200))}`);
    }
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}
