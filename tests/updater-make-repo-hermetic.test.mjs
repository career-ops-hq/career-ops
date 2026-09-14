// tests/updater-make-repo-hermetic.test.mjs — makeUpdaterRepo should build its
// fixture with ambient GIT_CONFIG_* neutralized.
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, rmSync, makeUpdaterRepo } from './helpers.mjs';
import { gitIn } from '../update-system.mjs';

console.log('\n🧪 Testing makeUpdaterRepo fixture isolation from ambient GIT_CONFIG_*...');

const prior = {
  GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
  GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
  GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
};

const ambientRoot = mkdtempSync(join(tmpdir(), 'co-updater-fixture-ambient-'));
const ambientExcludes = join(ambientRoot, 'ambient-excludes');
writeFileSync(ambientExcludes, '*.txt\n');

let repoDir = null;
let observed = null;

try {
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = 'core.excludesFile';
  process.env.GIT_CONFIG_VALUE_0 = ambientExcludes;

  const { dir, g } = makeUpdaterRepo(gitIn, { prefix: 'co-updater-hermetic-fixture-' });
  repoDir = dir;

  writeFileSync(join(dir, 'seed.txt'), 'x');
  g('add', '-A');
  g('commit', '-qm', 'base');
} catch (err) {
  observed = err;
} finally {
  for (const [k, v] of Object.entries(prior)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  rmSync(ambientRoot, { recursive: true, force: true });
}

if (!observed) {
  pass('makeUpdaterRepo fixture setup ignores ambient GIT_CONFIG_COUNT/KEY_n/VALUE_n');
} else {
  const head = String(observed.message ?? observed).split('\n')[0];
  const tail = String(observed.stdout ?? '').trim().split('\n').filter(Boolean).slice(-1)[0] || '';
  fail(`makeUpdaterRepo leaked ambient GIT_CONFIG_* into fixture setup: ${head}${tail ? ` | ${tail}` : ''}`);
}
