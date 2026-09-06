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
  recordStagedUpdate,
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

// ── 12-15. The withheld snapshot as a baseline, and its lifetime ───────
//
// A withheld update leaves its snapshot staged and uncommitted, so there is no
// updater commit to serve as locallyModifiedSystemFiles' baseline and the next
// run reads the previous run's own files as edits THIS install made: preserved,
// .bak'd, and the delta it came to install skipped. recordStagedUpdate() writes
// the snapshot the run staged; stagedUpdateBaseline() believes it only while it
// is still the state on disk.
//
// A repo in the state a withheld run leaves behind: v1 is the last committed
// updater snapshot, v2 is staged but uncommitted, upstream has moved to v3.
function repoWithWithheldUpdate() {
  const { dir, g } = repo();
  writeFileSync(join(dir, 'sys.mjs'), 'v1\n');
  g('add', 'sys.mjs');
  g('commit', '-qm', 'chore: auto-update system files to v1');
  g('checkout', '-q', '-b', 'upstream-line');
  writeFileSync(join(dir, 'sys.mjs'), 'v3\n');
  g('commit', '-qam', 'upstream v3');
  g('tag', 'upstream');
  g('checkout', '-q', 'main');
  writeFileSync(join(dir, 'sys.mjs'), 'v2\n');
  g('add', 'sys.mjs');
  return { dir, g, gitAt: (...args) => gitIn(dir, ...args) };
}

const atRiskIn = (dir, gitAt) =>
  locallyModifiedSystemFiles(['sys.mjs'], 'upstream', { git: gitAt, root: dir });

// `git stash push --staged` needs git 2.35, and nothing in this repo declares a
// minimum — so on an older git it would throw out of gitIn() and take the whole
// suite file down with it, turning a version difference into a mystery failure.
// Plain `stash push` performs the same index-and-worktree transition for a
// fixture whose only change IS the staged one, so the scenario stays real on
// every version; the flag is used where it exists because that is the exact
// command the withheld-update notice hands the user.
function stashStagedArgs(g) {
  const version = /(\d+)\.(\d+)/.exec(g('--version')) || [];
  const [major, minor] = [Number(version[1]), Number(version[2])];
  const supportsStagedStash = major > 2 || (major === 2 && minor >= 35);
  return supportsStagedStash
    ? ['stash', 'push', '--staged', '-m', 'career-ops']
    : ['stash', 'push', '-m', 'career-ops'];
}

// ── 12. NEGATIVE CONTROL + fix: pending snapshot is not a local edit ────
{
  const { dir, gitAt } = repoWithWithheldUpdate();
  const withoutRecord = atRiskIn(dir, gitAt);      // no snapshot recorded: the bug
  recordStagedUpdate('2.0.0', { git: gitAt });
  const withRecord = atRiskIn(dir, gitAt);

  if (withoutRecord.includes('sys.mjs') && !withRecord.includes('sys.mjs')) {
    pass('withheld update is not mistaken for a local edit on the next run');
  } else {
    fail(`baseline wrong: unrecorded=${JSON.stringify(withoutRecord)} recorded=${JSON.stringify(withRecord)}`);
  }
}

// ── 13. A genuine local edit is still caught while one is pending ───────
{
  // The recorded snapshot must not become a blanket amnesty: the preservation
  // guard (#2337) exists to stop the checkout silently overwriting a system
  // file this install edited, and it has to keep working while an update waits.
  const { dir, gitAt } = repoWithWithheldUpdate();
  recordStagedUpdate('2.0.0', { git: gitAt });
  writeFileSync(join(dir, 'sys.mjs'), 'my own local fix\n');

  if (atRiskIn(dir, gitAt).includes('sys.mjs')) {
    pass('a real local edit is still flagged while a withheld update is pending');
  } else {
    fail('the recorded snapshot swallowed a genuine local edit');
  }
}

// ── 14. Discarding the withheld update by hand must self-heal ──────────
{
  // The ref is durable; the state it describes is not. A contributor who throws
  // the withheld update away leaves the ref behind, and believing it on sight
  // makes every system file read as a local edit against a snapshot that is no
  // longer there — the invisible skip this guard exists to remove, one step
  // further out. Measured before the check existed: `sys.mjs` came back at risk
  // with the working tree untouched.
  for (const [label, discard] of [
    ['git reset --hard', (g) => g('reset', '--hard', 'HEAD')],
    ['git restore', (g) => { g('restore', '--staged', '--worktree', 'sys.mjs'); }],
  ]) {
    const { dir, g, gitAt } = repoWithWithheldUpdate();
    recordStagedUpdate('2.0.0', { git: gitAt });
    discard(g);

    const atRisk = atRiskIn(dir, gitAt);
    if (!atRisk.includes('sys.mjs')) {
      pass(`discarded by hand (${label}): the stale snapshot is distrusted`);
    } else {
      fail(`${label}: stale snapshot still trusted, atRisk=${JSON.stringify(atRisk)}`);
    }
  }
}

// ── 16. …and distrust must not become deletion ─────────────────────────
{
  // Deleting a snapshot that fails the check would be tidier, but it makes the
  // damage permanent in the one sequence where the state comes back: the
  // notice's own option 2 is `git stash push --staged` then a branch switch, and
  // an updater run in that window sees an index that does not match. Delete
  // there and `git stash pop` restores the update with nothing left to explain
  // it — the false positives return, on the default branch this time. Keeping
  // the ref costs nothing: the check is a content comparison, so a ref that
  // matches the index describes the tree truthfully whatever produced it.
  const { dir, g, gitAt } = repoWithWithheldUpdate();
  g('checkout', '-q', '-b', 'feat/x');
  recordStagedUpdate('2.0.0', { git: gitAt });

  g(...stashStagedArgs(g));
  g('switch', '-q', 'main');
  const whileStashed = atRiskIn(dir, gitAt);      // distrusted: nothing is staged
  g('stash', 'pop');
  const afterPop = atRiskIn(dir, gitAt);          // trusted again: the state is back

  if (!whileStashed.includes('sys.mjs') && !afterPop.includes('sys.mjs')) {
    pass('a stashed-and-restored update is still explained after the round trip');
  } else {
    fail(`stash round trip: stashed=${JSON.stringify(whileStashed)} popped=${JSON.stringify(afterPop)}`);
  }
}

// ── 15. Staging unrelated work does not invalidate the snapshot ─────────
{
  // The check is scoped to the paths being asked about, because a contributor
  // with a withheld update pending is also, by definition, working on something
  // else in the same tree. Invalidating on that would put the false positives
  // straight back.
  const { dir, g, gitAt } = repoWithWithheldUpdate();
  recordStagedUpdate('2.0.0', { git: gitAt });
  writeFileSync(join(dir, 'my-feature.mjs'), 'export const x = 1;\n');
  g('add', 'my-feature.mjs');

  if (!atRiskIn(dir, gitAt).includes('sys.mjs')) {
    pass('the contributor\'s own staged work leaves the snapshot trusted');
  } else {
    fail('unrelated staged work invalidated the withheld snapshot');
  }
}

for (const dir of cleanups) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
