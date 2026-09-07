/**
 * tests/update-system.test.mjs — formatLocalVersion must include short commit SHA when on git checkout, or version alone without git.
 */

import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { gitIn, formatLocalVersion } from '../update-system.mjs';

const NODE = process.execPath;
const ROOT = join(process.cwd());

console.log('\n🧪 Testing updater version short SHA formatting (#3883)...');

// 1. Git checkout fixture
{
  const dir = mkdtempSync(join(tmpdir(), 'co-ver-sha-git-'));
  try {
    writeFileSync(join(dir, 'VERSION'), '1.32.0\n');
    gitIn(dir, 'init', '-q', '-b', 'main', '.');
    gitIn(dir, 'config', 'user.email', 'test@example.com');
    gitIn(dir, 'config', 'user.name', 'Test');
    gitIn(dir, 'add', '-A');
    gitIn(dir, 'commit', '-qm', 'initial');

    const expectedSha = gitIn(dir, 'rev-parse', '--short', 'HEAD');
    
    const scriptPath = join(dir, 'update-system.mjs');
    copyFileSync(join(ROOT, 'update-system.mjs'), scriptPath);

    const formatted = formatLocalVersion(dir);
    if (formatted === `1.32.0 (${expectedSha})`) {
      pass('formatLocalVersion returns version and short SHA on a git checkout');
    } else {
      fail(`expected "1.32.0 (${expectedSha})", got "${formatted}"`);
    }

    const statusRes = spawnSync(NODE, [scriptPath, 'status'], { cwd: dir, encoding: 'utf-8' });
    if (statusRes.stdout.trim() === `career-ops v1.32.0 (${expectedSha})`) {
      pass('update-system.mjs status includes short SHA on git checkout');
    } else {
      fail(`status output wrong: ${statusRes.stdout.trim()}`);
    }

    const checkRes = spawnSync(NODE, [scriptPath, 'check'], { cwd: dir, encoding: 'utf-8' });
    const checkJson = JSON.parse(checkRes.stdout.trim());
    if (checkJson.local === '1.32.0' && checkJson.local_sha === expectedSha) {
      pass('update-system.mjs check splits local and local_sha on git checkout');
    } else {
      fail(`check output wrong: ${checkRes.stdout.trim()}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2. Non-git directory fixture (tarball / unpacked zip)
{
  const dir = mkdtempSync(join(tmpdir(), 'co-ver-sha-nogit-'));
  try {
    writeFileSync(join(dir, 'VERSION'), '1.32.0\n');
    
    const scriptPath = join(dir, 'update-system.mjs');
    copyFileSync(join(ROOT, 'update-system.mjs'), scriptPath);

    const formatted = formatLocalVersion(dir);
    if (formatted === '1.32.0') {
      pass('formatLocalVersion returns version alone without error in non-git directory');
    } else {
      fail(`expected "1.32.0", got "${formatted}"`);
    }

    const statusRes = spawnSync(NODE, [scriptPath, 'status'], { cwd: dir, encoding: 'utf-8' });
    if (statusRes.stdout.trim() === 'career-ops v1.32.0' && statusRes.stderr.trim() === '') {
      pass('update-system.mjs status returns version alone with empty stderr on non-git directory');
    } else {
      fail(`status output wrong: stdout=${statusRes.stdout.trim()} stderr=${statusRes.stderr.trim()}`);
    }

    const checkRes = spawnSync(NODE, [scriptPath, 'check'], { cwd: dir, encoding: 'utf-8' });
    const checkJson = JSON.parse(checkRes.stdout.trim());
    if (checkJson.local === '1.32.0' && !checkJson.local_sha) {
      pass('update-system.mjs check includes local without local_sha on non-git directory');
    } else {
      fail(`check output wrong: ${checkRes.stdout.trim()}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. Nested install fixture (a tarball install inside an enclosing repo)
{
  const outer = mkdtempSync(join(tmpdir(), 'co-ver-outer-'));
  try {
    gitIn(outer, 'init', '-q', '-b', 'main', '.');
    gitIn(outer, 'config', 'user.email', 'test@example.com');
    gitIn(outer, 'config', 'user.name', 'Test');
    const inner = join(outer, 'nested');
    mkdirSync(inner);
    writeFileSync(join(inner, 'VERSION'), '1.32.0\n');
    gitIn(outer, 'add', '-A');
    gitIn(outer, 'commit', '-qm', 'initial outer repo commit');

    const formatted = formatLocalVersion(inner);
    if (formatted === '1.32.0') {
      pass('formatLocalVersion ignores enclosing repository SHA for nested tarball install');
    } else {
      fail(`expected "1.32.0" for nested install, got "${formatted}" (it likely leaked the outer repo's SHA)`);
    }
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
}
