/** Recovery must restore the complete index and only report pending updates. */
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { bashSource, fail, getBash, makeUpdaterRepo, pass, rmSync, warn } from './helpers.mjs';
import {
  resolveUpdateCommitBranch,
  skippedBranchCommitNotice,
  updateCommitCommand,
} from '../update-system.mjs';

console.log('\n🧪 Testing updater branch recovery...');

function featureRepo() {
  const repo = makeUpdaterRepo({ prefix: 'co-branch-recovery-' });
  repo.g('config', 'core.autocrlf', 'false');
  repo.g('config', 'core.fileMode', 'false');
  writeFileSync(join(repo.dir, 'VERSION'), '1.0.0\n');
  writeFileSync(join(repo.dir, 'tool.mjs'), 'old system\n');
  repo.g('add', 'VERSION', 'tool.mjs');
  repo.g('commit', '-qm', 'base');
  repo.g('checkout', '-qb', 'feature');
  return repo;
}

// Execute both printed option-2 lines. Compare entire trees, including modes:
// an empty cached diff alone also passes when modified files were never staged.
for (const addFile of [false, true]) {
  const { dir, g } = featureRepo();
  try {
    const originalHead = g('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'VERSION'), '2.0.0\n');
    writeFileSync(join(dir, 'tool.mjs'), 'updated system\n');
    const paths = ['VERSION', 'tool.mjs'];
    if (addFile) {
      writeFileSync(join(dir, 'new.mjs'), 'new system\n');
      paths.push('new.mjs');
    }
    g('add', '--', ...paths);
    g('update-index', '--chmod=+x', 'tool.mjs');
    const expectedTree = g('write-tree');
    const notice = skippedBranchCommitNotice({
      currentBranch: 'feature', defaultBranch: 'main', version: '2.0.0',
      commitCommand: updateCommitCommand('2.0.0', true, paths),
    });
    const lines = notice.split('\n').map(line => line.trim());
    const commands = [
      lines.find(line => line.startsWith('git stash push --staged')),
      lines.find(line => line.startsWith('git switch')),
    ];
    const bash = getBash();
    const version = /(\d+)\.(\d+)/.exec(g('--version')) || [];
    if (bashSource() === 'unresolved' || Number(version[1]) < 2
        || (Number(version[1]) === 2 && Number(version[2]) < 35)) {
      warn('option-2 round trip requires a POSIX shell and Git 2.35+');
      continue;
    }
    for (const command of commands) {
      const shell = bashSource() === 'wsl' ? 'wsl' : bash;
      const args = bashSource() === 'wsl' ? ['-e', 'bash', '-c', command] : ['-c', command];
      execFileSync(shell, args, { cwd: dir, stdio: 'pipe' });
    }
    if (g('rev-parse', 'HEAD^{tree}') === expectedTree
        && g('status', '--porcelain') === ''
        && g('branch', '--show-current') === 'main'
        && g('rev-parse', 'feature') === originalHead) {
      pass(`option 2 commits modified files and staged modes${addFile ? ' plus added files' : ''} on main`);
    } else {
      fail(`option 2 left an incomplete commit: ${g('status', '--porcelain')}`);
    }
  } catch (error) {
    fail(`option 2 could not complete: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Drive the same repository-facing decision apply() calls, against real index
// states. Only the concrete update paths count; unrelated staged work cannot
// turn an already-current checkout into a withheld update.
{
  const { dir, g } = featureRepo();
  try {
    const options = { optIn: false, updatePaths: ['VERSION', 'tool.mjs', ' skill.md'] };
    const check = (condition, message) => condition ? pass(message) : fail(message);
    const isNoOp = () => {
      const decision = resolveUpdateCommitBranch(dir, options);
      return !decision.commit && decision.reason === 'no-staged-update';
    };
    const isWithheld = () => {
      const decision = resolveUpdateCommitBranch(dir, options);
      return !decision.commit && decision.reason === 'non-default-branch';
    };
    check(isNoOp(),
      'an already-current feature branch keeps the existing no-op path');
    writeFileSync(join(dir, 'mine.txt'), 'unrelated work\n');
    g('add', 'mine.txt');
    check(isNoOp(),
      'unrelated staged work alone does not trigger a withheld-update notice');
    check(g('diff', '--cached', '--name-only') === 'mine.txt',
      'the no-op decision leaves unrelated staged work intact');
    writeFileSync(join(dir, 'VERSION'), '2.0.0\n');
    g('add', 'VERSION');
    check(isWithheld(),
      'a staged system-file update still withholds the feature-branch commit');
    g('reset', '-q', 'HEAD', '--', 'VERSION');
    writeFileSync(join(dir, ' skill.md'), 'materialized entrypoint\n');
    g('add', ' skill.md');
    check(isWithheld(),
      'a materialized entrypoint alone triggers withholding without trimming its filename');
    check(resolveUpdateCommitBranch(dir, { ...options, optIn: true }).commit,
      'the explicit branch-commit opt-in still wins with staged update paths');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
