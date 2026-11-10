/**
 * Branch safety (#3846): exercise apply()'s branch-decision entry point against
 * throwaway repositories. Cover withheld commits, unchanged default/uncertain
 * behavior, recovery commands, and pending-snapshot local-edit attribution.
 */

import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pass, fail, warn, getBash, bashSource, sealProcessGitEnv } from './helpers.mjs';
import {
  COMMIT_ON_BRANCH_FLAG,
  commitOnBranchOptIn,
  currentBranchIn,
  defaultBranchIn,
  STAGED_UPDATE_REF,
  locallyModifiedSystemFiles,
  recordStagedUpdate,
  resolveUpdateCommitBranch,
  shellQuoteArg,
  skippedBranchCommitNotice,
  updateCommitBranchDecision,
  updateCommitCommand,
  gitIn,
  gitQuietIn,
  unstagedPathsOutside,
} from '../update-system.mjs';

// One commit on main, no remote; each test sets origin/HEAD as needed.
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

// Simulate the origin/HEAD recorded by git clone.
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

// Fixture git inherits process.env, so keep the contributor's git config out of it.
sealProcessGitEnv();

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
  // --force permits overwriting local system-file edits, not branch commits.
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
  // Match the selected commit form to preserve staged file modes.
  const indexForm = updateCommitCommand('1.31.0', true, ['a.mjs']);
  const { dir, g } = repo();
  const paths = ['a.mjs', "it's.mjs"];
  const pathspecForm = updateCommitCommand('1.31.0', false, paths, { git: g, root: dir });
  const hint = pathspecForm.match(/"--pathspec-from-file=([^"]+)" --pathspec-file-nul$/);
  if (indexForm === 'git commit -m "chore: auto-update system files to v1.31.0"' &&
      hint && readFileSync(resolve(dir, hint[1]), 'utf8') === "a.mjs\0it's.mjs\0") {
    pass('suggested commit command matches the form the updater would have used');
  } else {
    fail(`commit command wrong: ${indexForm} / ${pathspecForm}`);
  }
  const fallback = updateCommitCommand('1.31.0', false, paths, {
    git: () => { throw new Error('git directory is not writable'); },
  });
  if (fallback.includes("-- 'a.mjs' 'it'\\''s.mjs'")) {
    pass('an unwritable pathspec file retains the quoted inline recovery fallback');
  } else {
    fail(`commit fallback wrong: ${fallback}`);
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

// ── 11b. The printed commands must survive being pasted into a shell ───
{
  // Git's ref rules forbid spaces and some glob characters but allow `;`, `&`,
  // `$` and backticks, so a branch name is not the safe token it looks like —
  // and these commands exist to be copied into a terminal.
  const notice = skippedBranchCommitNotice({
    currentBranch: 'feat/x',
    defaultBranch: 'release;whoami',
    version: '1.33.0',
    commitCommand: 'git commit -m "x"',
  });
  const bare = shellQuoteArg('main') === 'main' && shellQuoteArg('feat/x') === 'feat/x';
  if (notice.includes("git switch 'release;whoami'") && !notice.includes('git switch release;whoami') && bare) {
    pass('a branch name carrying shell syntax is quoted in the printed commands');
  } else {
    fail(`unquoted interpolation in the notice:\n${notice}`);
  }
}

// ── 11c. Option 2 must not move the contributor's own staged work ──────
{
  // `stash push --staged` takes the whole index, not this update's share of it.
  // The updater already knows when something else is staged — the same signal
  // that scopes its commit — so the recipe has to say so instead of quietly
  // carrying that work onto the default branch.
  const args = {
    currentBranch: 'feat/x', defaultBranch: 'main', version: '1.33.0',
    commitCommand: 'git commit -m "x"',
  };
  const warned = skippedBranchCommitNotice({
    ...args, unrelatedStaged: ['mine.txt', 'my notes.md'],
  });
  const quiet = skippedBranchCommitNotice({ ...args, unrelatedStaged: [] });
  const fires = /staged besides this update/.test(warned)
    && !/staged besides this update/.test(quiet);
  if (fires) {
    pass('option 2 warns when other staged work would ride along, and only then');
  } else {
    fail('the unrelated-staged warning is missing or unconditional');
  }
  // The remedy names the paths, and quotes the ones that need it. Asserted on
  // the rendered line rather than on the array, because an unquoted path with a
  // space is what turns a correct remedy into two wrong ones.
  if (/git stash push -m 'my work' -- mine\.txt 'my notes\.md'/.test(warned)) {
    pass("option 2's remedy is scoped to the unrelated paths, quoted");
  } else {
    fail(`option 2's remedy does not name the paths to move:\n${warned}`);
  }
}

// ── 11d. …and running that remedy actually leaves the update behind ────
{
  // The point of 11c is not the wording, it is that the printed command works.
  // Both unscoped readings of an unscoped remedy fail, and they fail AS the two
  // things this guard exists to prevent: a bare `git commit` puts the update's
  // snapshot on the feature branch (#3846), and a bare `git stash push` takes
  // the refreshed files out of the tree (the staleness the guard avoids). So
  // run the line the notice prints and check what survives.
  //
  // Through getBash(), not execSync(): the notice quotes paths the POSIX way
  // (shellQuoteArg), and cmd.exe — what execSync() spawns on win32 — passes
  // `'my notes.md'` through as two literal arguments, quotes included. The
  // command under test IS a shell string, so it needs the shell it was written
  // for; running it under the wrong one would test the quoting of a shell no
  // reader of this notice is in.
  const bash = getBash();
  const { dir, g } = makeRepo();
  try {
    g('checkout', '-qb', 'feat/x');
    writeFileSync(join(dir, 'sys.mjs'), 'refreshed by the update\n');
    writeFileSync(join(dir, 'mine.txt'), 'my own work\n');
    writeFileSync(join(dir, 'my notes.md'), 'my own notes\n');
    g('add', 'sys.mjs', 'mine.txt', 'my notes.md');

    const unrelatedStaged = ['mine.txt', 'my notes.md'];
    const notice = skippedBranchCommitNotice({
      currentBranch: 'feat/x', defaultBranch: 'main', version: '1.33.0',
      commitCommand: 'git commit -m "x"', unrelatedStaged,
    });
    const remedy = notice.split('\n').map(l => l.trim())
      .find(l => l.startsWith('git stash push -m'));
    if (bashSource() === 'unresolved') {
      // Skip loudly rather than pass: this assertion is the only one that runs
      // the remedy, so a silent skip would read as coverage that is not there.
      warn('no POSIX shell found — the remedy was not executed, only its text checked');
    } else if (!remedy) {
      fail(`no runnable remedy line in the notice:\n${notice}`);
    } else {
      const shell = bashSource() === 'wsl' ? 'wsl' : bash;
      const shellArgs = bashSource() === 'wsl' ? ['-e', 'bash', '-c', remedy] : ['-c', remedy];
      execFileSync(shell, shellArgs, { cwd: dir, stdio: 'pipe' });
      const staged = gitIn(dir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
      const onDisk = existsSync(join(dir, 'sys.mjs'));
      const movedOut = unrelatedStaged.every(p => !staged.includes(p) && !existsSync(join(dir, p)));
      if (staged.includes('sys.mjs') && onDisk && movedOut) {
        pass("the remedy moves the contributor's work out and leaves the update staged");
      } else {
        fail(`after \`${remedy}\`: staged=[${staged}], sys.mjs on disk=${onDisk}, `
          + `unrelated moved out=${movedOut}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Unstaged work needs the same isolation, even with no unrelated index entries.
{
  const { dir, g } = makeRepo();
  cleanups.push(dir);
  writeFileSync(join(dir, 'mine.txt'), 'original work\n');
  writeFileSync(join(dir, 'sys.mjs'), 'old system\n');
  g('add', 'mine.txt', 'sys.mjs');
  g('commit', '-qm', 'fixture');
  writeFileSync(join(dir, 'mine.txt'), 'unstaged work\n');
  writeFileSync(join(dir, 'sys.mjs'), 'refreshed system\n');
  g('add', 'sys.mjs');
  const rawGit = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
  const unrelatedUnstaged = unstagedPathsOutside(['sys.mjs'], [], rawGit);
  const notice = skippedBranchCommitNotice({
    currentBranch: 'feat/x', defaultBranch: 'main', version: '1.33.0',
    commitCommand: 'git commit -m "x"', unrelatedUnstaged,
  });
  const remedy = notice.split('\n').map(line => line.trim())
    .find(line => line.startsWith('git stash push -m'));
  if (unrelatedUnstaged.join(',') === 'mine.txt'
      && notice.includes('unrelated unstaged changes')
      && notice.includes('Stash or commit them before switching branches.')
      && remedy === "git stash push -m 'my work' -- mine.txt") {
    pass('option 2 detects and warns about unrelated work that is only unstaged');
  } else {
    fail(`unstaged-only recovery notice is incomplete: ${notice}`);
  }
  g('stash', 'push', '-m', 'my work', '--', 'mine.txt');
  if (g('diff', '--cached', '--name-only') === 'sys.mjs'
      && g('diff', '--name-only') === ''
      && g('show', 'stash@{0}:mine.txt') === 'unstaged work') {
    pass('isolating unstaged work leaves the update staged and preserves the user edit');
  } else {
    fail('unstaged-work recovery moved the update or lost the user edit');
  }
}

// Pending-update fixture: v1 committed, v2 staged, upstream at v3.
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

// Before Git 2.35, plain stash has the same effect in this staged-only fixture.
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

// The snapshot must not hide local customizations the withheld update preserved.
for (const staged of [false, true]) {
  const { dir, g, gitAt } = repoWithWithheldUpdate();
  g('reset', '--hard', 'HEAD');
  writeFileSync(join(dir, 'custom.mjs'), 'original\n');
  g('add', 'custom.mjs');
  g('commit', '-qm', 'fixture');
  writeFileSync(join(dir, 'custom.mjs'), 'my local customization\n');
  g('add', 'custom.mjs');
  if (!staged) g('commit', '-qm', 'local customization');
  writeFileSync(join(dir, 'sys.mjs'), 'v2\n');
  g('add', 'sys.mjs');
  recordStagedUpdate('2.0.0', { git: gitAt, preservedPaths: ['custom.mjs'] });
  const atRisk = locallyModifiedSystemFiles(['sys.mjs', 'custom.mjs'], 'upstream', { git: gitAt, root: dir });
  if (atRisk.includes('custom.mjs') && !atRisk.includes('sys.mjs')) {
    pass(`a withheld update keeps a ${staged ? 'staged' : 'committed'} preserved customization protected`);
  } else {
    fail(`preserved customization lost with staged=${staged}: ${JSON.stringify(atRisk)}`);
  }
}

// ── 13. A genuine local edit is still caught while one is pending ───────
{
  // Pending-update attribution must still detect genuine edits (#2337).
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
  // Discarding the files must invalidate the durable ref's attribution.
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
  // An updater run while stashed must not delete the ref needed after pop.
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
  // Only queried paths participate in snapshot validation.
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

// ── 17. The snapshot must be recordable without a git identity ─────────
{
  // Missing identity must not silently disable pending-update attribution.
  const { dir, g, gitAt } = repoWithWithheldUpdate();
  g('config', '--unset', 'user.email');
  g('config', '--unset', 'user.name');

  // Isolate both config and inherited identity variables for the negative control.
  const noConfig = join(dir, 'no-such-gitconfig');   // absent file reads as empty, on every platform
  const overrides = {
    GIT_CONFIG_GLOBAL: noConfig,
    GIT_CONFIG_SYSTEM: noConfig,
    GIT_AUTHOR_NAME: undefined,
    GIT_AUTHOR_EMAIL: undefined,
    GIT_COMMITTER_NAME: undefined,
    GIT_COMMITTER_EMAIL: undefined,
    EMAIL: undefined,
  };
  const restore = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    // NEGATIVE CONTROL: the same call without a pinned identity is what fails.
    let bareCommitTreeFailed = false;
    try {
      // gitQuietIn: this call is EXPECTED to fail, so its stderr is noise.
      gitQuietIn(dir, 'commit-tree', gitAt('write-tree'), '-p', gitAt('rev-parse', 'HEAD'), '-m', 'probe');
    } catch {
      bareCommitTreeFailed = true;
    }

    recordStagedUpdate('2.0.0', { git: gitAt });
    let recorded = false;
    try {
      recorded = Boolean(gitAt('rev-parse', '--verify', '--quiet', `${STAGED_UPDATE_REF}^{commit}`));
    } catch {
      recorded = false;
    }

    if (!bareCommitTreeFailed) {
      // Report an unreachable negative control rather than silently passing.
      warn('no-identity case not reachable on this git; snapshot recording untested here');
    } else if (recorded && !atRiskIn(dir, gitAt).includes('sys.mjs')) {
      pass('the snapshot is recorded even with no git identity configured');
    } else {
      fail(`no-identity: recorded=${recorded}, atRisk=${JSON.stringify(atRiskIn(dir, gitAt))}`);
    }
  } finally {
    for (const [key, value] of Object.entries(restore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

for (const dir of cleanups) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
