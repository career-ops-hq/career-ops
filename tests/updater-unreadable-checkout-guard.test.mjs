/**
 * updater-unreadable-checkout-guard.test.mjs: a checkout git cannot read.
 *
 * The no-checkout guard (tests/updater-no-checkout-guard.test.mjs) covers an
 * install with no `.git` at all. This is the other side of it: `.git` is
 * there, but git refuses or cannot read the checkout. The common case is
 * rootful Docker, where the container runs git as root on a checkout the host
 * user owns and git stops with "detected dubious ownership". check() swallowed
 * that failure and still answered up-to-date (or a verdict without the local
 * commit) on both channels, while apply and rollback failed on the same
 * checkout.
 *
 * GIT_TEST_ASSUME_DIFFERENT_OWNER=1 makes git refuse the fixture exactly as it
 * refuses a checkout owned by another user, with no root and no Docker. The
 * check runs through a proxy that refuses connections, so no case touches the
 * network: a check that gets as far as GitHub answers `offline` at once.
 */

import { copyFileSync, mkdirSync, writeFileSync } from 'fs';
import { spawnSync, execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { pass, fail, warn, NODE, ROOT, rmSync, hermeticGitEnv, makeUpdaterRepo } from './helpers.mjs';

console.log('\n🧪 Testing updater check on a checkout git cannot read...');

const DEAD_PROXY = 'http://127.0.0.1:9';

// curl reads the first config file it finds and looks in CURL_HOME first, so an
// empty one there keeps the developer's ~/.curlrc (a `noproxy`, another
// `proxy`) from sending a check around DEAD_PROXY.
const curlHome = (dir) => join(dir, '.git', 'co-curl-home');

function makeFixture({ commit = true } = {}) {
  const { dir, g } = makeUpdaterRepo({ prefix: 'co-unreadable-' });
  copyFileSync(join(ROOT, 'update-system.mjs'), join(dir, 'update-system.mjs'));
  copyFileSync(join(ROOT, 'VERSION'), join(dir, 'VERSION'));
  mkdirSync(curlHome(dir));
  writeFileSync(join(curlHome(dir), '.curlrc'), '');
  if (commit) {
    g('add', 'update-system.mjs', 'VERSION');
    g('commit', '-q', '-m', 'fixture');
  }
  return { dir, g };
}

function updaterEnv(dir, extra = {}) {
  const env = {
    ...hermeticGitEnv(join(dir, '.git', 'co-hermetic-gitconfig')),
    GIT_CEILING_DIRECTORIES: dirname(dir),
    CURL_HOME: curlHome(dir),
    http_proxy: DEAD_PROXY,
    https_proxy: DEAD_PROXY,
    HTTP_PROXY: DEAD_PROXY,
    HTTPS_PROXY: DEAD_PROXY,
    ALL_PROXY: DEAD_PROXY,
    ...extra,
  };
  delete env.NO_PROXY;
  delete env.no_proxy;
  return env;
}

function runCheck(dir, args = [], extra = {}) {
  const res = spawnSync(NODE, ['update-system.mjs', 'check', ...args], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 60000,
    env: updaterEnv(dir, extra),
  });
  let out;
  try { out = JSON.parse(res.stdout); } catch { out = undefined; }
  return { res, out };
}

const REFUSE = { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' };

// ── 1. git refuses the checkout: both channels say so instead of a verdict ──
{
  const { dir } = makeFixture();
  try {
    let refuses = false;
    try {
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: 'pipe', env: updaterEnv(dir, REFUSE) });
    } catch {
      refuses = true;
    }
    if (!refuses) {
      warn('this git ignores GIT_TEST_ASSUME_DIFFERENT_OWNER, so the ownership cases were skipped');
    } else {
      for (const [label, args] of [['default channel', []], ['--channel main', ['--channel', 'main']]]) {
        const { res, out } = runCheck(dir, args, REFUSE);
        if (res.status === 0 && out?.status === 'checkout-unreadable' && out.local && /dubious ownership/.test(out.detail || '')) {
          pass(`${label}: a checkout git refuses reports checkout-unreadable with git's reason`);
        } else {
          fail(`${label}: a checkout git refuses exited ${res.status} with stdout ${JSON.stringify(res.stdout.slice(0, 300))}`);
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 2. git reads the checkout: the guard stays out of the way ──
{
  const { dir, g } = makeFixture();
  try {
    const { res, out } = runCheck(dir);
    const sha = g('rev-parse', '--short', 'HEAD');
    if (res.status === 0 && out?.status === 'offline' && out.local_sha === sha) {
      pass('a readable checkout goes on to the normal check and carries local_sha');
    } else {
      fail(`a readable checkout exited ${res.status} with stdout ${JSON.stringify(res.stdout.slice(0, 300))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 3. no git on PATH, and a repository with no commit yet: same status ──
{
  const { dir } = makeFixture();
  try {
    const { res, out } = runCheck(dir, [], { PATH: join(dir, 'no-such-bin') });
    if (res.status === 0 && out?.status === 'checkout-unreadable' && out.detail) {
      pass('git missing from PATH reports checkout-unreadable with a detail');
    } else {
      fail(`git missing from PATH exited ${res.status} with stdout ${JSON.stringify(res.stdout.slice(0, 300))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const { dir } = makeFixture({ commit: false });
  try {
    const { res, out } = runCheck(dir);
    if (res.status === 0 && out?.status === 'checkout-unreadable' && out.detail) {
      pass('a repository with no commit yet reports checkout-unreadable with a detail');
    } else {
      fail(`a repository with no commit exited ${res.status} with stdout ${JSON.stringify(res.stdout.slice(0, 300))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
