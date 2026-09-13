/**
 * updater-rollback-target-manifest.test.mjs — rollback must remove files that
 * a failed update introduced even when the local updater still has the older
 * SYSTEM_PATHS list.
 *
 * This reproduces issue 3780 at the CLI layer with a throwaway repo: the
 * fixture copies the real updater source, downgrades only the fixture copy's
 * manifest, simulates a partial apply that leaves behind a newer-release file
 * outside that old manifest, then runs `node update-system.mjs rollback`.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync, ROOT, NODE, hermeticGitEnv } from './helpers.mjs';
import { gitIn } from '../update-system.mjs';

console.log('\n🧪 Testing updater rollback target-manifest cleanup...');

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'co-rollback-target-manifest-'));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');

  writeFileSync(join(dir, 'VERSION'), '0.0.0-test\n');
  const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
  const downgraded = source.replace(
    /const SYSTEM_PATHS = \[[\s\S]*?^\];/m,
    "const SYSTEM_PATHS = [\n  'known-system.txt',\n];",
  );
  if (downgraded === source) {
    throw new Error('could not replace SYSTEM_PATHS in the fixture updater source');
  }
  writeFileSync(join(dir, 'update-system.mjs'), downgraded);
  copyFileSync(join(ROOT, 'tracker-aliases.json'), join(dir, 'tracker-aliases.json'));
  writeFileSync(join(dir, 'known-system.txt'), 'base\n');
  g('add', 'VERSION', 'update-system.mjs', 'tracker-aliases.json', 'known-system.txt');
  g('commit', '-qm', 'base');
  g('branch', 'backup-pre-update-0.0.0');
  return { dir, g };
}

function runRollback(dir) {
  return spawnSync(NODE, ['update-system.mjs', 'rollback'], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 60_000,
    env: hermeticGitEnv(join(dir, 'hermetic-gitconfig')),
  });
}

{
  const fixture = makeFixture();
  try {
    // Simulate a failed partial apply: a tracked system file the old manifest
    // knows about changed, and a newer-release file outside that manifest was
    // left behind on disk before update-system.mjs itself was updated.
    writeFileSync(join(fixture.dir, 'known-system.txt'), 'upstream\n');
    fixture.g('add', 'known-system.txt');
    mkdirSync(join(fixture.dir, 'future-system'), { recursive: true });
    writeFileSync(join(fixture.dir, 'future-system', 'added.txt'), 'from newer release\n');

    const before = fixture.g('status', '--short');
    const res = runRollback(fixture.dir);
    const after = fixture.g('status', '--short');
    const known = readFileSync(join(fixture.dir, 'known-system.txt'), 'utf-8');

    if (res.status === 0) {
      pass('rollback completes in the old-manifest fixture');
    } else {
      fail(`rollback exited ${res.status} with stderr ${JSON.stringify(res.stderr.slice(0, 200))}`);
    }
    if (known === 'base\n') {
      pass('rollback restores a path that the old manifest still knows about');
    } else {
      fail(`known system path did not revert: ${JSON.stringify(known)}`);
    }
    if (!existsSync(join(fixture.dir, 'future-system', 'added.txt'))) {
      pass('rollback removes an upstream-only file even when only the target manifest knows it');
    } else {
      fail([
        'rollback left the upstream-only file behind when the local manifest was stale',
        `before=${JSON.stringify(before)}`,
        `stdout=${JSON.stringify(res.stdout.trim())}`,
        `after=${JSON.stringify(after)}`,
      ].join(' | '));
    }
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}
