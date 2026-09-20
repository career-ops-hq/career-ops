/**
 * updater-migration-fixture-cleanup.test.mjs - the migration suite's git
 * fixture must not outlive the suite.
 *
 * updater-migration-tests.mjs gives a nested .git-less copy a tiny repository
 * of its own, so update-system's nested-install guard (#3334) lets its apply()
 * probes through. test-all runs every smoke script from ONE shared copy, and
 * that repository used to stay behind: `update-system.mjs check`, later in the
 * same matrix, then passed the guard it should have tripped and fetched
 * upstream main into the empty fixture repo - a full clone over the network,
 * killed at the 30s default on a slow connection as
 * `update-system.mjs check crashed (exit null, signal SIGTERM)`.
 *
 * The sections run the real suite from a nested copy inside a throwaway outer
 * repo (the shape of test-all's shared copy), then `check` from the SAME
 * directory, which is the order the smoke matrix runs them in. Four files are
 * enough: update-system.mjs is self-loading (#1706). The suite's manifest
 * assertions fail against so sparse a copy, which is useful rather than noise:
 * it sends the suite down its failing-exit path, and the cleanup has to hold
 * there too.
 */

import { mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, NODE, ROOT, rmSync, hermeticGitEnv } from './helpers.mjs';
import { gitIn } from '../update-system.mjs';

console.log('\n🧪 Testing updater-migration-tests.mjs fixture cleanup...');

const SUITE_FILES = ['update-system.mjs', 'updater-migration-tests.mjs', 'AGENTS.md', 'VERSION'];

// Every proxy variable curl and git read, pointed at a closed local port. With
// the fixture repository leaked, `check` gets past its guard and reaches for
// the network; this turns that into an immediate `offline` instead of a
// download, so the regression fails fast and never depends on connectivity.
const NO_NETWORK = {
  ...Object.fromEntries(
    ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
      .map((name) => [name, 'http://127.0.0.1:9']),
  ),
  NO_PROXY: '',
  no_proxy: '',
};

function makeCopy(dir) {
  mkdirSync(dir, { recursive: true });
  for (const file of SUITE_FILES) copyFileSync(join(ROOT, file), join(dir, file));
}

function spawnIn(cwd, fixtureDir, args) {
  return spawnSync(NODE, args, {
    cwd,
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...hermeticGitEnv(join(fixtureDir, 'hermetic-gitconfig')), ...NO_NETWORK },
  });
}

// ── 1. The suite's fixture repository is gone once the suite exits ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-migration-fixture-'));
  try {
    gitIn(dir, 'init', '-q', '-b', 'main', '.');
    const nested = join(dir, 'tools', 'career-ops');
    makeCopy(nested);

    const suite = spawnIn(nested, dir, ['updater-migration-tests.mjs']);
    // Proof the fixture existed while the suite ran, so the absence checked
    // below is not vacuous: without a repository of its own, apply() refuses
    // the nested copy before its confirmation gate and this line reads FAIL.
    if (suite.stdout.includes('PASS environment-only confirmation cannot authorize initial apply')) {
      pass('the suite ran its apply() probes against its own fixture repository');
    } else {
      fail(`the suite never reached apply()'s confirmation gate (exit ${suite.status}): ${JSON.stringify((suite.stderr || '').slice(0, 300))}`);
    }
    if (!existsSync(join(nested, '.git'))) {
      pass('the fixture repository is removed when the suite exits');
    } else {
      fail('updater-migration-tests.mjs left its fixture .git behind in the copy it ran from');
    }

    // ── 2. ...so `check`, run next from the same directory, trips the guard ──
    const check = spawnIn(nested, dir, ['update-system.mjs', 'check']);
    let status;
    try { status = JSON.parse(check.stdout).status; } catch { status = undefined; }
    if (check.status === 0 && status === 'not-a-git-toplevel') {
      pass('check run after the suite still reports not-a-git-toplevel and never reaches the network');
    } else {
      fail(`check run after the suite exited ${check.status} with ${JSON.stringify((check.stdout || '').slice(0, 200))} - a leaked fixture repo makes it fetch upstream`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 3. A repository the suite did not create is never removed ──
// A copy that is its own checkout, as a clone is when someone runs
// `node updater-migration-tests.mjs` by hand. The cleanup is keyed on `.git`
// being absent before the suite ran, so this layout comes out as it went in.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-migration-own-repo-'));
  try {
    makeCopy(dir);
    const g = (...args) => gitIn(dir, ...args);
    g('init', '-q', '-b', 'main', '.');
    g('config', 'user.email', 'test@example.com');
    g('config', 'user.name', 'Test');
    // Same three lines as the sibling fixtures: a contributor's global gpg
    // signer or hooksPath would otherwise kill this commit (#2754), and Windows
    // git would print a CRLF warning per file.
    g('config', 'commit.gpgsign', 'false');
    g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
    g('config', 'core.autocrlf', 'false');
    g('add', '-A');
    g('commit', '-qm', 'own checkout');
    const head = g('rev-parse', 'HEAD');

    spawnIn(dir, dir, ['updater-migration-tests.mjs']);
    if (existsSync(join(dir, '.git')) && g('rev-parse', 'HEAD') === head) {
      pass('a checkout that already had its own .git keeps it, and its HEAD, after the suite');
    } else {
      fail('updater-migration-tests.mjs removed or rewrote a repository it did not create');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
