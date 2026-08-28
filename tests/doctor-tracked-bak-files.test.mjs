// tests/doctor-tracked-bak-files.test.mjs — doctor.mjs's tracked-.bak warning.
//
// update-system.mjs versions before #2857 could commit cascading .bak backups
// when a checkout write failed. #2857 stops that for NEW installs, but an
// install that already `git add`ed one is stuck: nothing in the update path
// untracks a path git already has, so the update looks like it silently did
// nothing (career-ops#2881) with no signal pointing at .bak. This pins the
// doctor check that surfaces it instead of letting it stay silent.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\ndoctor.mjs — tracked .bak files');

const DOCTOR = join(ROOT, 'doctor.mjs');

function runDoctor(cwd) {
  try {
    const out = execFileSync(NODE, [DOCTOR, '--json', '--target', cwd], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return JSON.parse(out);
  } catch (e) {
    return { _error: e.message, _stderr: e.stderr ? String(e.stderr) : '' };
  }
}

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(dir) {
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
}

// 1. A tracked .bak file is reported as a warning naming the remedy.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-bak-2-'));
  try {
    initRepo(dir);
    writeFileSync(join(dir, 'notes.md.bak'), 'stale backup\n', 'utf-8');
    git(dir, 'add', 'notes.md.bak');
    git(dir, 'commit', '-q', '-m', 'accidentally tracked backup');

    const state = runDoctor(dir);
    if (state._error) {
      fail(`tracked .bak run: doctor crashed: ${state._error}`);
    } else {
      const warningText = (state.warnings || []).join('\n');
      if (/tracked \.bak/.test(warningText) && /notes\.md\.bak/.test(warningText)) {
        pass('a tracked .bak file is surfaced in doctor --json warnings, naming the path');
      } else {
        fail(`tracked .bak file was not surfaced: ${JSON.stringify(state.warnings)}`);
      }
      if (/git rm --cached/.test(warningText) && /git commit/.test(warningText)) {
        pass('the warning includes the untrack-and-commit remedy');
      } else {
        fail(`remedy commands missing from warning: ${JSON.stringify(state.warnings)}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2. A clean repo (no tracked .bak files) stays silent on this check.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-bak-3-'));
  try {
    initRepo(dir);
    writeFileSync(join(dir, 'cv.md'), '# CV\n', 'utf-8');
    git(dir, 'add', 'cv.md');
    git(dir, 'commit', '-q', '-m', 'add cv');

    const state = runDoctor(dir);
    if (state._error) {
      fail(`clean-repo run: doctor crashed: ${state._error}`);
    } else {
      const warningText = (state.warnings || []).join('\n');
      if (!/tracked \.bak/.test(warningText)) {
        pass('a repo with no tracked .bak files produces no .bak warning');
      } else {
        fail(`unexpected .bak warning on a clean repo: ${JSON.stringify(state.warnings)}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. A directory that is not a git checkout at all does not crash doctor.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-bak-4-'));
  try {
    writeFileSync(join(dir, 'cv.md'), '# CV\n', 'utf-8');

    const state = runDoctor(dir);
    if (state._error) {
      fail(`non-git run: doctor crashed: ${state._error}`);
    } else {
      pass('a non-git target directory does not crash the .bak check');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
