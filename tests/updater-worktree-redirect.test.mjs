/**
 * updater-worktree-redirect.test.mjs — updates from a linked worktree land on main.
 *
 * Agents such as Claude Code run each session in a linked git worktree on a
 * throwaway branch. update-system.mjs runs every git call from its own
 * directory, so an update started there used to commit to that branch and
 * leave the user's main checkout on the old release. From a linked worktree
 * the CLI now re-runs itself in the checkout that has `main` checked out.
 *
 * The behavioral sections drive `dismiss --version` because it is the one
 * subcommand that writes checkout-local state with no network: where the
 * `.update-dismissed` marker lands is where the command ran. update-system.mjs
 * is self-loading by contract (#1706), so copying just it and VERSION is a
 * faithful install.
 */

import { mkdtempSync, writeFileSync, copyFileSync, existsSync, realpathSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, NODE, ROOT, rmSync, hermeticGitEnv } from './helpers.mjs';
import { parseWorktreeList, worktreeUpdateTarget } from '../update-system.mjs';

console.log('\n🧪 Testing updater worktree redirect...');

const canonicalize = realpathSync.native ?? realpathSync;
const same = (a, b) => Boolean(a && b) && canonicalize(a) === canonicalize(b);

// A main checkout with update-system.mjs committed, plus a linked worktree on
// a feature branch beside it — the layout an agent session produces.
function makeFixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'co-worktree-')));
  const main = join(base, 'main');
  const wt = join(base, 'wt');
  const gitConfig = join(base, 'hermetic-gitconfig');
  writeFileSync(gitConfig, '');
  const env = hermeticGitEnv(gitConfig);
  const g = (cwd, ...args) => {
    const res = spawnSync('git', args, { cwd, env, encoding: 'utf-8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
    return res.stdout.trim();
  };
  g(base, 'init', '-q', '-b', 'main', main);
  g(main, 'config', 'user.email', 'test@example.com');
  g(main, 'config', 'user.name', 'Test');
  g(main, 'config', 'commit.gpgsign', 'false');
  g(main, 'config', 'core.hooksPath', join(base, 'no-such-hooks'));
  g(main, 'config', 'core.autocrlf', 'false');
  copyFileSync(join(ROOT, 'update-system.mjs'), join(main, 'update-system.mjs'));
  copyFileSync(join(ROOT, 'VERSION'), join(main, 'VERSION'));
  writeFileSync(join(main, '.gitignore'), '.update-dismissed\n');
  g(main, 'add', '-A');
  g(main, 'commit', '-qm', 'install');
  g(main, 'worktree', 'add', '-q', '-b', 'feature', wt);
  return { base, main, wt, env, g };
}

function runUpdater(cwd, args, env) {
  return spawnSync(NODE, ['update-system.mjs', ...args], { cwd, env, encoding: 'utf-8', timeout: 60000 });
}

// ── 1. parseWorktreeList ──
{
  const parsed = parseWorktreeList([
    'worktree /repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /repo/.claude/worktrees/x',
    'HEAD 2222222222222222222222222222222222222222',
    'detached',
    '',
    'worktree /gone',
    'HEAD 3333333333333333333333333333333333333333',
    'branch refs/heads/old',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\n'));
  const ok = parsed.length === 3 &&
    parsed[0].path === '/repo' && parsed[0].branch === 'refs/heads/main' &&
    parsed[1].branch === null && !parsed[1].prunable &&
    parsed[2].branch === 'refs/heads/old' && parsed[2].prunable;
  if (ok) pass('parseWorktreeList reads path, branch, detached and prunable entries');
  else fail(`parseWorktreeList returned ${JSON.stringify(parsed)}`);
}

// ── 2. worktreeUpdateTarget: the unit seam ──
{
  const fx = makeFixture();
  try {
    if (worktreeUpdateTarget(fx.main) === null) {
      pass('worktreeUpdateTarget is null in the main checkout');
    } else {
      fail('worktreeUpdateTarget redirected from the main checkout itself');
    }
    const target = worktreeUpdateTarget(fx.wt);
    if (target && same(target.path, fx.main) && target.branch === 'feature') {
      pass('worktreeUpdateTarget points a linked worktree at the checkout with main');
    } else {
      fail(`worktreeUpdateTarget(wt) returned ${JSON.stringify(target)}`);
    }

    // main moves into the linked worktree: that worktree is now the target,
    // and the main checkout on another branch is left as the user's choice.
    fx.g(fx.main, 'checkout', '-q', '-b', 'other');
    fx.g(fx.wt, 'checkout', '-q', 'main');
    if (worktreeUpdateTarget(fx.wt) === null && worktreeUpdateTarget(fx.main) === null) {
      pass('a linked worktree that has main checked out updates in place');
    } else {
      fail('worktreeUpdateTarget redirected although the worktree itself has main');
    }

    // Nobody has main.
    fx.g(fx.wt, 'checkout', '-q', 'feature');
    const orphan = worktreeUpdateTarget(fx.wt);
    if (orphan?.error && orphan.error.includes('no checkout has \'main\'') && orphan.error.includes('CAREER_OPS_UPDATE_IN_WORKTREE')) {
      pass('worktreeUpdateTarget refuses with an actionable error when main is checked out nowhere');
    } else {
      fail(`worktreeUpdateTarget with main checked out nowhere returned ${JSON.stringify(orphan)}`);
    }
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
}

// ── 3. CLI: state from a linked worktree lands in the main checkout ──
{
  const fx = makeFixture();
  try {
    const res = runUpdater(fx.wt, ['dismiss', '--version', '9.9.9'], fx.env);
    if (res.status === 0 && existsSync(join(fx.main, '.update-dismissed')) && !existsSync(join(fx.wt, '.update-dismissed'))) {
      pass('dismiss from a linked worktree runs in the main checkout');
    } else {
      fail(`dismiss from a worktree exited ${res.status}; main marker ${existsSync(join(fx.main, '.update-dismissed'))}, worktree marker ${existsSync(join(fx.wt, '.update-dismissed'))}; stderr ${JSON.stringify(res.stderr.slice(0, 300))}`);
    }

    rmSync(join(fx.main, '.update-dismissed'), { force: true });
    const here = runUpdater(fx.wt, ['dismiss', '--version', '9.9.9'], { ...fx.env, CAREER_OPS_UPDATE_IN_WORKTREE: '1' });
    if (here.status === 0 && existsSync(join(fx.wt, '.update-dismissed')) && !existsSync(join(fx.main, '.update-dismissed'))) {
      pass('CAREER_OPS_UPDATE_IN_WORKTREE=1 keeps the command in the worktree');
    } else {
      fail(`opt-out dismiss exited ${here.status}; stderr ${JSON.stringify(here.stderr.slice(0, 300))}`);
    }
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
}

// ── 4. CLI: no checkout has main ──
{
  const fx = makeFixture();
  try {
    fx.g(fx.main, 'checkout', '-q', '-b', 'other');

    const check = runUpdater(fx.wt, ['check'], fx.env);
    let status;
    try { status = JSON.parse(check.stdout).status; } catch { status = undefined; }
    if (check.status === 0 && status === 'worktree-without-main') {
      pass('check reports worktree-without-main instead of checking the worktree branch');
    } else {
      fail(`check exited ${check.status} with stdout ${JSON.stringify(check.stdout.slice(0, 200))}`);
    }

    const apply = runUpdater(fx.wt, ['apply', '--confirm'], fx.env);
    const branches = fx.g(fx.main, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/backup-pre-update-*');
    if (apply.status !== 0 && apply.stderr.includes('no checkout has') && branches === '') {
      pass('apply refuses before any side effect when main is checked out nowhere');
    } else {
      fail(`apply exited ${apply.status}, backups ${JSON.stringify(branches)}, stderr ${JSON.stringify(apply.stderr.slice(0, 300))}`);
    }
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
}

