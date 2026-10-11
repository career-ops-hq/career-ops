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

import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, hermeticGitEnv, hermeticGitRunner } from './helpers.mjs';

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

// The helper being sound is not the same as the fixtures using it.
// makeUpdaterRepo pinned core.excludesFile with `git config` and ran git through
// the updater's own runner, which inherits the environment. An ambient
// GIT_CONFIG_COUNT pair overrode the pin, the seed file was never staged, and
// the base commit died before any assertion ran (#3801).
//
// Run in a child, because the fixture reads the environment of the process it
// is built in, and that is the thing under test: the injection is a
// contributor's shell, not an argument. Asserted, again, on what git saw.
console.log('\nhermetic git env — makeUpdaterRepo builds and runs under an ambient injection');

const ambientRoot = mkdtempSync(join(tmpdir(), 'career-ops-hermetic-fixture-'));
let fixtureDir = '';
try {
  const excludes = join(ambientRoot, 'ambient-excludes');
  writeFileSync(excludes, '*.txt\n');
  const ambientConfig = join(ambientRoot, 'ambient-config');
  const ambientBefore = '[user]\n\tname = ambient-leak\n';
  writeFileSync(ambientConfig, ambientBefore);

  // A fourth channel that is not config at all: GIT_DIR and its companions say
  // WHERE the repository is, so with one inherited the fixture's git commands
  // stop being about the fixture. `bystander` stands in for the contributor's
  // real checkout; it must come out of this exactly as it went in.
  const bystander = join(ambientRoot, 'bystander');
  mkdirSync(bystander, { recursive: true });
  const bystanderGit = hermeticGitRunner(bystander);
  bystanderGit('init', '-q', '-b', 'main', '.');
  bystanderGit('config', 'user.name', 'Bystander');
  const bystanderConfig = join(bystander, '.git', 'config');
  const bystanderBefore = readFileSync(bystanderConfig, 'utf-8');

  const script = [
    "import { writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `import { makeUpdaterRepo } from ${JSON.stringify(new URL('./helpers.mjs', import.meta.url).href)};`,
    "const { dir, g } = makeUpdaterRepo({ prefix: 'co-hermetic-fixture-' });",
    "console.log('FIXTURE_DIR=' + dir);",
    "writeFileSync(join(dir, 'seed.txt'), 'seed');",
    "g('add', '-A');",
    "g('commit', '-qm', 'base');",
    "console.log('RESULT=' + JSON.stringify({ tracked: g('ls-files'), author: g('log', '-1', '--format=%an') }));",
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    timeout: 60000,
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.excludesFile',
      GIT_CONFIG_VALUE_0: excludes,
      GIT_CONFIG_PARAMETERS: "'user.name=parameters-leak'",
      GIT_CONFIG: ambientConfig,
      GIT_DIR: join(bystander, '.git'),
      GIT_WORK_TREE: bystander,
      GIT_INDEX_FILE: join(bystander, '.git', 'index'),
    },
  });
  fixtureDir = (child.stdout || '').match(/^FIXTURE_DIR=(.+)$/m)?.[1]?.trim() ?? '';
  const resultLine = (child.stdout || '').match(/^RESULT=(.+)$/m)?.[1];

  if (child.status === 0 && resultLine) {
    const seen = JSON.parse(resultLine);
    if (seen.tracked === 'seed.txt') {
      pass('makeUpdaterRepo stages and commits its seed file under an ambient core.excludesFile');
    } else {
      fail(`ambient core.excludesFile reached the fixture: tracked = ${JSON.stringify(seen.tracked)}`);
    }
    if (seen.author === 'Test') {
      pass('the fixture commit takes its author from the fixture, not from GIT_CONFIG_PARAMETERS');
    } else {
      fail(`ambient GIT_CONFIG_PARAMETERS reached the fixture: author = ${seen.author}`);
    }
  } else {
    const why = (child.stderr || '').split('\n').find((line) => /nothing to commit|fatal:|Error: /.test(line)) || 'no output';
    fail(`makeUpdaterRepo could not build under an ambient injection (exit ${child.status}): ${why.trim()}`);
  }

  const ambientAfter = readFileSync(ambientConfig, 'utf-8');
  if (ambientAfter === ambientBefore) {
    pass("the fixture's own `git config` writes did not land in the ambient GIT_CONFIG file");
  } else {
    fail(`the fixture wrote into the ambient GIT_CONFIG file: ${JSON.stringify(ambientAfter)}`);
  }

  const bystanderAfter = readFileSync(bystanderConfig, 'utf-8');
  if (bystanderAfter === bystanderBefore) {
    pass('an ambient GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE does not point the fixture at another repository');
  } else {
    fail(`the fixture reconfigured the repository an ambient GIT_DIR pointed at: ${JSON.stringify(bystanderAfter)}`);
  }
} finally {
  rmSync(ambientRoot, { recursive: true, force: true });
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
}
