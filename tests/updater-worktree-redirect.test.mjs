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

import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, existsSync, realpathSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, NODE, ROOT, rmSync, hermeticGitEnv } from './helpers.mjs';
import { parseWorktreeList, worktreeUpdateTarget, resolveTargetRef } from '../update-system.mjs';

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

// ── 5. CLI: a dirty main checkout is refused, untracked files are not ──
{
  const fx = makeFixture();
  try {
    // An untracked user-layer file sits beside the tracked edit throughout;
    // the last case below pins that it is not what trips the refusal.
    writeFileSync(join(fx.main, 'cv.md'), '# CV\n');
    const before = 'edited locally\n';
    writeFileSync(join(fx.main, 'VERSION'), before);

    for (const cmd of [['apply', '--confirm'], ['rollback']]) {
      const res = runUpdater(fx.wt, cmd, fx.env);
      const branches = fx.g(fx.main, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/backup-pre-update-*');
      const version = readFileSync(join(fx.main, 'VERSION'), 'utf-8');
      if (res.status !== 0 && res.stderr.includes('uncommitted changes to tracked files') && branches === '' && version === before) {
        pass(`${cmd[0]} from a worktree refuses a main checkout with tracked edits and touches nothing`);
      } else {
        fail(`${cmd[0]} with a dirty main checkout exited ${res.status}, backups ${JSON.stringify(branches)}, stderr ${JSON.stringify(res.stderr.slice(0, 300))}`);
      }
    }

    // Only the tracked edit is the trigger: restore it, keep the untracked
    // file, and the guard lets apply through to its own confirmation gate.
    fx.g(fx.main, 'checkout', '--', 'VERSION');
    const res = runUpdater(fx.wt, ['apply'], fx.env);
    if (res.status !== 0 && res.stderr.includes('explicit confirmation') && !res.stderr.includes('uncommitted changes')) {
      pass('untracked files in the main checkout do not trip the dirty-checkout refusal');
    } else {
      fail(`apply with only untracked files exited ${res.status}, stderr ${JSON.stringify(res.stderr.slice(0, 300))}`);
    }
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
}

// ── 6. Interactive update mode instructions contract (#7092) ──
{
  const updateMd = readFileSync(join(ROOT, 'modes', 'update.md'), 'utf-8');

  // Step 1 handles worktree-without-main status
  if (updateMd.includes('worktree-without-main')) {
    pass('Step 1 handles worktree-without-main status');
  } else {
    fail('Step 1 does not handle worktree-without-main status');
  }

  // Target checkout resolution described for worktree, normal checkout, and opt-out
  if (updateMd.includes('TARGET_DIR') && updateMd.includes('worktree list') && updateMd.includes('CAREER_OPS_UPDATE_IN_WORKTREE')) {
    pass('modes/update.md describes TARGET_DIR resolution from git worktree list');
  } else {
    fail('modes/update.md does not describe TARGET_DIR resolution from git worktree list');
  }

  // Step 2 diff and fetch use TARGET_DIR
  if (updateMd.includes('git -C "$TARGET_DIR" fetch') && updateMd.includes('git -C "$TARGET_DIR" diff HEAD..FETCH_HEAD')) {
    pass('Step 2 fetch and diff use TARGET_DIR');
  } else {
    fail('Step 2 fetch and diff do not use TARGET_DIR');
  }

  // Step 4.1 captures PRE_UPDATE_REF in TARGET_DIR
  if (/PRE_UPDATE_REF=\$\(git -C ["']?\$TARGET_DIR["']? rev-parse HEAD\)/.test(updateMd)) {
    pass('Step 4.1 captures PRE_UPDATE_REF in TARGET_DIR');
  } else {
    fail('Step 4.1 does not capture PRE_UPDATE_REF in TARGET_DIR');
  }

  // Step 4.6 runs doctor and verify-pipeline in TARGET_DIR
  if (updateMd.includes('in `TARGET_DIR`') && updateMd.includes('node doctor.mjs') && updateMd.includes('node verify-pipeline.mjs')) {
    pass('Step 4.6 runs doctor and verify-pipeline in TARGET_DIR');
  } else {
    fail('Step 4.6 does not run doctor and verify-pipeline in TARGET_DIR');
  }

  // Doctor is a gate; verify-pipeline is informational
  if (updateMd.includes('treat validation as failed') && updateMd.includes('treat it as informational only')) {
    pass('Step 4.6 keeps doctor as gate and verify-pipeline as informational');
  } else {
    fail('Step 4.6 does not keep doctor as gate and verify-pipeline as informational');
  }
}

// ── 7. Target checkout preview and baseline in linked worktree layout (#7092) ──
{
  const fx = makeFixture();
  try {
    const mainHead = fx.g(fx.main, 'rev-parse', 'HEAD');

    // Make a commit in the linked worktree so wt HEAD differs from main HEAD
    writeFileSync(join(fx.wt, 'local-branch-file.txt'), 'feature work\n');
    fx.g(fx.wt, 'add', 'local-branch-file.txt');
    fx.g(fx.wt, 'commit', '-qm', 'branch work');
    const wtHead = fx.g(fx.wt, 'rev-parse', 'HEAD');

    if (mainHead === wtHead) {
      fail('fixture setup failed: main HEAD and wt HEAD should differ');
    }

    // Resolving target checkout from wt points to main
    const target = worktreeUpdateTarget(fx.wt);
    if (target && same(target.path, fx.main)) {
      pass('worktreeUpdateTarget from linked worktree resolves to main checkout');
    } else {
      fail(`expected target.path to be ${fx.main}, got ${JSON.stringify(target)}`);
    }

    // Capturing PRE_UPDATE_REF using target checkout vs calling worktree
    const targetBaseline = fx.g(target.path, 'rev-parse', 'HEAD');
    const callerBaseline = fx.g(fx.wt, 'rev-parse', 'HEAD');
    if (targetBaseline === mainHead && targetBaseline !== callerBaseline) {
      pass('PRE_UPDATE_REF in target checkout captures main HEAD, not caller worktree HEAD');
    } else {
      fail(`targetBaseline (${targetBaseline}) should match mainHead (${mainHead}) and differ from callerBaseline (${callerBaseline})`);
    }

    // Normal checkout targets itself
    const normalTarget = worktreeUpdateTarget(fx.main);
    if (normalTarget === null) {
      pass('normal checkout has no redirection (targets itself)');
    } else {
      fail(`expected normalTarget to be null, got ${JSON.stringify(normalTarget)}`);
    }

    // Missing target checkout reports worktree-without-main
    fx.g(fx.main, 'checkout', '-q', '-b', 'other');
    const check = runUpdater(fx.wt, ['check'], fx.env);
    let checkJson;
    try { checkJson = JSON.parse(check.stdout); } catch { checkJson = {}; }
    if (check.status === 0 && checkJson.status === 'worktree-without-main' && checkJson.detail?.includes('no checkout has \'main\'')) {
      pass('check in linked worktree without main returns worktree-without-main with actionable detail');
    } else {
      fail(`check without main failed: ${check.stdout}`);
    }
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
}

// ── 8. Preview and install must describe the same update ──
{
  const updateMd = readFileSync(join(ROOT, 'modes', 'update.md'), 'utf-8');
  const checkCommand = updateMd.match(/Run `(node update-system\.mjs check[^`]+)`/)?.[1] || '';
  const applyCommand = updateMd.match(/Run `(node update-system\.mjs apply[^`]+)`/)?.[1] || '';
  if (checkCommand.includes('--channel "$UPDATE_CHANNEL"') &&
      applyCommand.includes('--channel "$UPDATE_CHANNEL"') &&
      updateMd.includes('`--channel VALUE` or `--channel=VALUE` wins over `CAREER_OPS_UPDATE_CHANNEL`') &&
      updateMd.includes('if neither is set, use `release`') &&
      updateMd.includes('Do not silently substitute `release`') &&
      updateMd.includes('`main` when `UPDATE_CHANNEL=main`') &&
      updateMd.includes('`career-ops-v{remote}` when `UPDATE_CHANNEL=release`')) {
    pass('check, preview and apply share the explicit channel, defaulting to release');
  } else {
    fail('check, preview and apply must share the explicit channel, defaulting to release');
  }

  // Resolve the actual documented command arguments without a shell or network.
  // This catches a main preview paired with a default-release check/apply.
  for (const channel of ['release', 'main']) {
    const argvFor = command => (command.match(/"[^"]*"|\S+/g) || [])
      .map(arg => arg.replace(/^"|"$/g, '').replace('$UPDATE_CHANNEL', channel));
    const ctx = { curlGet: async () => JSON.stringify({ tag_name: 'career-ops-v1.40.0' }) };
    const checkRef = await resolveTargetRef(argvFor(checkCommand), {}, ctx);
    const applyRef = await resolveTargetRef(argvFor(applyCommand), {}, ctx);
    const previewRef = channel === 'main' ? 'main' : 'career-ops-v1.40.0';
    if (checkRef === previewRef && applyRef === previewRef) {
      pass(`${channel} documented commands resolve the same ref as the preview`);
    } else {
      fail(`${channel} preview ${previewRef} differs from check ${checkRef} or apply ${applyRef}`);
    }
  }

  // Both flag forms and the environment handoff are supported by the updater.
  // Keep these controls beside the documentation contract so it cannot narrow
  // channel selection to only one spelling or silently mask a bad request.
  for (const [args, env, expected] of [
    [[], {}, 'career-ops-v1.40.0'],
    [['--channel', 'main'], {}, 'main'],
    [['--channel=main'], {}, 'main'],
    [[], { CAREER_OPS_UPDATE_CHANNEL: 'main' }, 'main'],
    [['--channel=release'], { CAREER_OPS_UPDATE_CHANNEL: 'main' }, 'career-ops-v1.40.0'],
  ]) {
    const ctx = { curlGet: async () => JSON.stringify({ tag_name: 'career-ops-v1.40.0' }) };
    const actual = await resolveTargetRef(['node', 'update-system.mjs', 'check', ...args], env, ctx);
    if (actual === expected) pass(`channel selection ${JSON.stringify(args)} with ${JSON.stringify(env)} resolves ${expected}`);
    else fail(`channel selection resolved ${actual}, expected ${expected}`);
  }
  let fetchedInvalidChannel = false;
  try {
    await resolveTargetRef(['node', 'update-system.mjs', 'check', '--channel=mian'], {}, {
      curlGet: async () => { fetchedInvalidChannel = true; return null; },
    });
    fail('invalid explicit channel must stop instead of defaulting to release');
  } catch (err) {
    if (!fetchedInvalidChannel && err.message.includes('Unknown --channel')) pass('invalid explicit channel stops before network access');
    else fail(`unexpected invalid-channel behavior: ${err.message}`);
  }

  const previewCommand = updateMd.split('\n').find(line => line.startsWith('git -C "$TARGET_DIR" diff HEAD..FETCH_HEAD --stat')) || '';
  if (previewCommand.includes("'*.mjs'")) {
    pass('preview keeps the script wildcard literal for Git, not the calling shell');
  } else {
    fail('preview must quote the script wildcard so the caller cannot expand it');
  }

  // The target can contain a root script absent from the calling worktree.
  // A literal Git pathspec includes it even though caller-side expansion cannot.
  const fx = makeFixture();
  try {
    const before = fx.g(fx.main, 'rev-parse', 'HEAD');
    writeFileSync(join(fx.main, 'target-only.mjs'), '// target script\n');
    fx.g(fx.main, 'add', 'target-only.mjs');
    fx.g(fx.main, 'commit', '-qm', 'target-only script');
    const changed = fx.g(fx.wt, '-C', fx.main, 'diff', `${before}..HEAD`, '--name-only', '--', '*.mjs');
    if (!existsSync(join(fx.wt, 'target-only.mjs')) && changed.split(/\r?\n/).includes('target-only.mjs')) {
      pass('literal preview pathspec includes a target script missing from the caller');
    } else {
      fail('literal preview pathspec omitted a target-only script');
    }
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
}
