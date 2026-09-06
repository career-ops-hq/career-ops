/**
 * updater-branch-guard.test.mjs — the update commit must not land on a
 * contributor's feature branch (#3846).
 *
 * `apply()` committed to whatever HEAD pointed at. For someone who contributes
 * from the same checkout they use, that dropped a full system snapshot onto
 * their branch: PR #3648 arrived as +173,092/-13,920 over a 39-line change.
 *
 * The guard's failure mode in the other direction is worse than the bug — an
 * updater that withholds too eagerly leaves users on stale system files, and
 * staleness is invisible until something breaks. So the tests below pin BOTH
 * halves: the skip on a real feature branch, and every uncertain case
 * (detached HEAD, no discoverable default branch, opt-in) still committing.
 *
 * Behavioural, driven against throwaway repos through the git-runner seam —
 * same approach as tests/updater-commit-file-modes.test.mjs. The repo-facing
 * tests call resolveUpdateCommitBranch(), which is the exact composition
 * apply() runs, so a caller wired up wrong cannot pass here.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import {
  COMMIT_ON_BRANCH_FLAG,
  commitOnBranchOptIn,
  currentBranchIn,
  defaultBranchIn,
  STAGED_UPDATE_REF,
  locallyModifiedSystemFiles,
  resolveUpdateCommitBranch,
  skippedBranchCommitNotice,
  updateCommitBranchDecision,
  updateCommitCommand,
  gitIn,
} from '../update-system.mjs';

// A throwaway repo with one commit on `main`, no remote. Remotes are added per
// test, because whether `origin/HEAD` exists is exactly what the fallback in
// defaultBranchIn() is for.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'co-branchguard-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'VERSION'), '1.0.0\n');
  g('add', 'VERSION');
  g('commit', '-qm', 'base');
  return { dir, g };
}

// Point refs/remotes/origin/HEAD at a branch the way `git clone` records it,
// without needing a second repo to clone from.
function setOriginHead(g, branch) {
  g('update-ref', `refs/remotes/origin/${branch}`, 'HEAD');
  g('symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`);
}

const cleanups = [];
const repo = () => {
  const r = makeRepo();
  cleanups.push(r.dir);
  return r;
};

console.log('\n🧪 Testing updater branch guard (#3846)...');

// ── 1. The bug: a feature branch does not receive the commit ────────────
{
  const { dir, g } = repo();
  setOriginHead(g, 'main');
  g('checkout', '-q', '-b', 'feat/posted-date-sort');
  const decision = resolveUpdateCommitBranch(dir, { optIn: false });
  if (decision.commit === false && decision.reason === 'non-default-branch' &&
      decision.currentBranch === 'feat/posted-date-sort' && decision.defaultBranch === 'main') {
    pass('feature branch: update commit is withheld');
  } else {
    fail(`feature branch should withhold the commit, got ${JSON.stringify(decision)}`);
  }
}

// ── 2. The plain-user path is untouched ────────────────────────────────
{
  const { dir, g } = repo();
  setOriginHead(g, 'main');
  const decision = resolveUpdateCommitBranch(dir, { optIn: false });
  if (decision.commit === true && decision.reason === 'on-default-branch') {
    pass('default branch: commits exactly as before');
  } else {
    fail(`default branch must still commit, got ${JSON.stringify(decision)}`);
  }
}

// ── 3. A non-`main` default branch is honoured, not assumed ────────────
{
  const { dir, g } = repo();
  g('branch', '-m', 'trunk');
  setOriginHead(g, 'trunk');
  const onTrunk = resolveUpdateCommitBranch(dir, { optIn: false });
  g('checkout', '-q', '-b', 'main');
  const onMain = resolveUpdateCommitBranch(dir, { optIn: false });
  if (onTrunk.commit === true && onMain.commit === false) {
    pass("origin/HEAD wins over the name 'main'");
  } else {
    fail(`default branch must come from origin/HEAD, got trunk=${onTrunk.commit} main=${onMain.commit}`);
  }
}

// ── 4. Uncertain cases keep updating: detached HEAD ────────────────────
{
  const { dir, g } = repo();
  setOriginHead(g, 'main');
  g('checkout', '-q', '--detach', 'HEAD');
  const decision = resolveUpdateCommitBranch(dir, { optIn: false });
  if (currentBranchIn(dir) === null && decision.commit === true && decision.reason === 'detached-head') {
    pass('detached HEAD: behaves as before rather than withholding');
  } else {
    fail(`detached HEAD must not withhold, got ${JSON.stringify(decision)}`);
  }
}

// ── 5. Uncertain cases keep updating: no discoverable default branch ────
{
  const { dir, g } = repo();
  g('branch', '-m', 'trunk');            // no origin/HEAD, no main, no master
  g('checkout', '-q', '-b', 'feat/x');
  const decision = resolveUpdateCommitBranch(dir, { optIn: false });
  if (defaultBranchIn(dir) === null && decision.commit === true &&
      decision.reason === 'unknown-default-branch') {
    pass('unknown default branch: behaves as before rather than withholding');
  } else {
    fail(`unknown default branch must not withhold, got ${JSON.stringify(decision)}`);
  }
}

// ── 6. The main/master fallback when origin/HEAD is absent ─────────────
{
  const { dir, g } = repo();
  g('checkout', '-q', '-b', 'feat/x');
  const withMain = resolveUpdateCommitBranch(dir, { optIn: false });

  const { dir: dir2, g: g2 } = repo();
  g2('branch', '-m', 'master');
  g2('checkout', '-q', '-b', 'feat/x');
  const withMaster = resolveUpdateCommitBranch(dir2, { optIn: false });

  if (withMain.defaultBranch === 'main' && withMain.commit === false &&
      withMaster.defaultBranch === 'master' && withMaster.commit === false) {
    pass('no origin/HEAD: falls back to a main/master branch that exists locally');
  } else {
    fail(`fallback failed: ${JSON.stringify(withMain)} / ${JSON.stringify(withMaster)}`);
  }
}

// ── 7. The opt-in restores the old behaviour ───────────────────────────
{
  const { dir, g } = repo();
  setOriginHead(g, 'main');
  g('checkout', '-q', '-b', 'feat/x');
  const decision = resolveUpdateCommitBranch(dir, { optIn: true });
  if (decision.commit === true && decision.reason === 'opt-in') {
    pass('opt-in: commits on a feature branch on request');
  } else {
    fail(`opt-in must commit, got ${JSON.stringify(decision)}`);
  }
}

// ── 8. Where the opt-in comes from ─────────────────────────────────────
{
  const flag = commitOnBranchOptIn([COMMIT_ON_BRANCH_FLAG], {});
  const env = commitOnBranchOptIn([], { CAREER_OPS_UPDATE_COMMIT_ON_BRANCH: '1' });
  const neither = commitOnBranchOptIn(['apply', '--confirm', '--force'], {});
  const notOne = commitOnBranchOptIn([], { CAREER_OPS_UPDATE_COMMIT_ON_BRANCH: '0' });
  if (flag && env && !neither && !notOne) {
    pass('opt-in reads the flag and the env twin, and nothing else');
  } else {
    fail(`opt-in detection wrong: flag=${flag} env=${env} neither=${neither} notOne=${notOne}`);
  }
}

// ── 9. --force does not imply the branch opt-in ────────────────────────
{
  // The two mean different things (#2337 vs #3846). Folding them together
  // would make `--force`, which users reach for to resolve local system-file
  // edits, silently reintroduce the commit this guard exists to withhold.
  const decision = updateCommitBranchDecision({
    currentBranch: 'feat/x', defaultBranch: 'main',
    optIn: commitOnBranchOptIn(['apply', '--force', '--confirm'], {}),
  });
  if (decision.commit === false) {
    pass('--force does not authorize committing on a feature branch');
  } else {
    fail('--force must not imply --commit-on-branch');
  }
}

// ── 10. The suggested command matches the commit that was withheld ─────
{
  // Index form vs pathspec form are not interchangeable: the pathspec form
  // drops staged mode bits where core.fileMode is false. Handing the user the
  // wrong one turns the recovery step into the bug it recovers from.
  const indexForm = updateCommitCommand('1.31.0', true, ['a.mjs']);
  const pathspecForm = updateCommitCommand('1.31.0', false, ['a.mjs', "it's.mjs"]);
  if (indexForm === 'git commit -m "chore: auto-update system files to v1.31.0"' &&
      pathspecForm.includes("-- 'a.mjs' 'it'\\''s.mjs'")) {
    pass('suggested commit command matches the form the updater would have used');
  } else {
    fail(`commit command wrong: ${indexForm} / ${pathspecForm}`);
  }
}

// ── 11. The user is told, and given every exit ─────────────────────────
{
  const notice = skippedBranchCommitNotice({
    currentBranch: 'feat/x',
    defaultBranch: 'main',
    version: '1.31.0',
    commitCommand: 'git commit -m "chore: auto-update system files to v1.31.0"',
  });
  const missing = [
    "'feat/x'",                       // which branch they are on
    "'main'",                         // and what it is not
    'git commit -m',                  // 1. keep it here
    'git switch main',                // 2. move it
    'node update-system.mjs rollback',// 3. undo it
    COMMIT_ON_BRANCH_FLAG,            // how to stop being asked
  ].filter(fragment => !notice.includes(fragment));
  if (missing.length === 0 && /NOT committed/.test(notice)) {
    pass('notice names the branch and offers keep / move / undo');
  } else {
    fail(`notice is missing: ${missing.join(', ')}`);
  }
}

// ── 12. A withheld update must not read as a local edit next time ──────
{
  // NEGATIVE CONTROL FIRST. Without the recorded baseline, the second update on
  // the same branch sees the FIRST update's own staged files, finds no updater
  // commit to explain them, and classifies them as edits this install made — so
  // it preserves them, writes .bak copies, and skips exactly the delta it came
  // to install. That is the staleness failure the issue warns is worse than the
  // bug being fixed, arriving one run later.
  const { dir, g } = repo();
  const gitAt = (...args) => gitIn(dir, ...args);

  // v1 is the last committed updater snapshot; v2 is the update whose commit
  // the guard withheld (staged only); v3 is what upstream has moved on to.
  writeFileSync(join(dir, 'sys.mjs'), 'v1\n');
  g('add', 'sys.mjs');
  g('commit', '-qm', 'chore: auto-update system files to v1');
  g('checkout', '-q', '-b', 'upstream-line');
  writeFileSync(join(dir, 'sys.mjs'), 'v2\n');
  g('commit', '-qam', 'upstream v2');
  const upstreamV2 = g('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'sys.mjs'), 'v3\n');
  g('commit', '-qam', 'upstream v3');
  g('tag', 'upstream');
  g('checkout', '-q', 'main');
  writeFileSync(join(dir, 'sys.mjs'), 'v2\n');   // what the withheld run left staged
  g('add', 'sys.mjs');

  const withoutRef = locallyModifiedSystemFiles(['sys.mjs'], 'upstream', { git: gitAt, root: dir });
  g('update-ref', STAGED_UPDATE_REF, upstreamV2);
  const withRef = locallyModifiedSystemFiles(['sys.mjs'], 'upstream', { git: gitAt, root: dir });

  if (withoutRef.includes('sys.mjs') && !withRef.includes('sys.mjs')) {
    pass('withheld update is not mistaken for a local edit on the next run');
  } else {
    fail(`baseline wrong: without ref=${JSON.stringify(withoutRef)} with ref=${JSON.stringify(withRef)}`);
  }
}

// ── 13. A genuine local edit is still caught with the ref recorded ──────
{
  // The recorded baseline must not become a blanket amnesty: the preservation
  // guard (#2337) exists to stop the checkout silently overwriting a system
  // file this install edited, and that has to keep working while a withheld
  // update is pending.
  const { dir, g } = repo();
  writeFileSync(join(dir, 'sys.mjs'), 'v2\n');
  g('add', 'sys.mjs');
  g('commit', '-qm', 'staged update content');
  g('update-ref', STAGED_UPDATE_REF, g('rev-parse', 'HEAD'));
  writeFileSync(join(dir, 'sys.mjs'), 'v3-upstream\n');
  g('commit', '-qam', 'upstream moved on');
  g('tag', 'upstream');
  g('reset', '-q', '--hard', 'HEAD~1');
  writeFileSync(join(dir, 'sys.mjs'), 'my own local fix\n');   // the user's edit

  const atRisk = locallyModifiedSystemFiles(['sys.mjs'], 'upstream', { git: (...a) => gitIn(dir, ...a), root: dir });
  if (atRisk.includes('sys.mjs')) {
    pass('a real local edit is still flagged while a withheld update is pending');
  } else {
    fail('the recorded baseline swallowed a genuine local edit');
  }
}

for (const dir of cleanups) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
