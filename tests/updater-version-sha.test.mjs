/**
 * tests/updater-version-sha.test.mjs — formatLocalVersion must include short commit SHA when on git checkout, or version alone without git.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import { formatLocalVersion, gitIn } from '../update-system.mjs';

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
    const formatted = formatLocalVersion(dir);
    const expectedText = `1.32.0 (${expectedSha})`;

    if (formatted === expectedText) {
      pass('formatLocalVersion returns version and short SHA on a git checkout');
    } else {
      fail(`expected "${expectedText}", got "${formatted}"`);
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

    const formatted = formatLocalVersion(dir);
    const expectedText = '1.32.0';

    if (formatted === expectedText) {
      pass('formatLocalVersion returns version alone without error in non-git directory');
    } else {
      fail(`expected "${expectedText}", got "${formatted}"`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
