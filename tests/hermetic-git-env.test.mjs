// tests/hermetic-git-env.test.mjs — hermeticGitEnv must keep ambient git
// configuration out of a fixture, in BOTH directions.
//
// Two variables walk past all three of its pins, because GIT_CONFIG_COUNT
// governs GIT_CONFIG_KEY_n / VALUE_n and nothing else, and neither of these is a
// config FILE that GLOBAL/SYSTEM could shadow:
//
//   GIT_CONFIG_PARAMETERS  how git hands `-c` to a subprocess, so it reaches
//                          every git invocation.
//   GIT_CONFIG             redirects the `git config` command — reads AND
//                          writes. The write half is the one that bites: the
//                          fixtures in test-all.mjs configure themselves by
//                          calling `git config`, so under an ambient value that
//                          write leaves the fixture, the setting silently never
//                          applies, and the suite edits a file it does not own.
//
// Asserted through hermeticGitEnv rather than around it, and on BEHAVIOUR rather
// than on the absence of a key: a check that the returned object lacks the two
// names would pass on any implementation that deletes them, including one that
// deletes them after git has already been handed the environment. What matters
// is what git saw.

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, hermeticGitEnv } from './helpers.mjs';

console.log('\nhermetic git env — ambient GIT_CONFIG* must not reach a fixture');

const root = mkdtempSync(join(tmpdir(), 'career-ops-hermetic-env-'));
try {
  const pinned = join(root, 'gitconfig');
  writeFileSync(pinned, '');
  const ambient = join(root, 'ambient-config');
  writeFileSync(ambient, '[user]\n\tname = ambient-leak\n');
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });

  // All three channels at once, each carrying a distinct value, so a failure
  // names which one got through rather than only that something did.
  //
  // GIT_CONFIG_COUNT is the channel the pins were originally built for (#2567),
  // and the only one closed by overwriting rather than deleting: setting it to 0
  // makes KEY_n / VALUE_n inert without enumerating them. Injecting it here is
  // what makes that pin load-bearing in this file — without this pair, removing
  // `GIT_CONFIG_COUNT: '0'` from the helper leaves this test green.
  const gitEnv = hermeticGitEnv(pinned, {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.name',
    GIT_CONFIG_VALUE_0: 'count-leak',
    GIT_CONFIG_PARAMETERS: "'user.name=parameters-leak'",
    GIT_CONFIG: ambient,
  });
  const gitRun = (args) => execFileSync('git', args, {
    cwd: repo, encoding: 'utf-8', timeout: 30000, env: gitEnv,
  }).trim();

  gitRun(['init']);

  let seenName = '';
  try {
    seenName = gitRun(['config', 'user.name']);
  } catch (err) {
    // `git config <key>` exits 1 for "not set", which is the outcome this
    // asserts. Anything else means the probe never ran — 128 for a broken repo,
    // 129 for a bad invocation — and swallowing those would turn a failed probe
    // into evidence that the isolation works.
    if (err?.status !== 1) throw err;
    seenName = '';
  }
  if (seenName === '') {
    pass('hermeticGitEnv keeps an ambient GIT_CONFIG_PARAMETERS / GIT_CONFIG out of git');
  } else {
    fail(`ambient config reached git through hermeticGitEnv: user.name = ${seenName}`);
  }

  gitRun(['config', 'core.excludesFile', join(root, 'excludes')]);
  const landedLocally = readFileSync(join(repo, '.git', 'config'), 'utf-8').includes('excludesFile');
  const escaped = readFileSync(ambient, 'utf-8').includes('excludesFile');
  if (landedLocally && !escaped) {
    pass("a fixture's own `git config` write stays inside the fixture");
  } else {
    fail(`git config write escaped the fixture: local=${landedLocally} ambient=${escaped}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
