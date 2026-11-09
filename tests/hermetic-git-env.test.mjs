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
import { fileURLToPath } from 'url';
import { pass, fail, hermeticGitEnv, hermeticGitRunner, importSuiteContained } from './helpers.mjs';

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

// Signing is the same leak through a different key. With `tag.gpgSign = true`
// in a contributor's ~/.gitconfig, `git tag <name>` stops making a lightweight
// tag: git tries to make a signed, annotated one, has no message for it, and
// dies with "no tag message?". The #3052 suite builds a release fixture with
// exactly that command through a runner that inherited the environment, so on
// such a machine it threw at the tag and none of the assertions after it ran.
// `commit.gpgSign` is the quieter half: it signs every fixture commit with the
// contributor's own key, and fails outright where no key is reachable.
//
// The real suite is run here, in a child, under a global config that turns both
// on and points signing at a program that does not exist. A fixture that still
// reads the contributor's config cannot commit or tag at all under it, so this
// passes only if the suite's repositories are sealed. GIT_CONFIG_GLOBAL stands
// in for ~/.gitconfig (it replaces it), which keeps the test off the real one.
console.log('\nhermetic git env — the #3052 release fixture builds under ambient signing config');

const signingRoot = mkdtempSync(join(tmpdir(), 'career-ops-hermetic-signing-'));
try {
  const signingConfig = join(signingRoot, 'gitconfig');
  writeFileSync(signingConfig, [
    '[tag]', '\tgpgSign = true', '\tforceSignAnnotated = true',
    '[commit]', '\tgpgSign = true',
    '[gpg]', `\tprogram = ${join(signingRoot, 'no-such-signing-program')}`,
    '',
  ].join('\n'));
  const suite = fileURLToPath(new URL('./updater-apply-target-verification.test.mjs', import.meta.url));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: signingConfig };
  // Nothing else may override the file this test injects.
  for (const name of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG']) delete env[name];
  const child = spawnSync(process.execPath, [suite], { encoding: 'utf-8', timeout: 120000, env });
  const out = child.stdout || '';
  const failures = out.split('\n').filter((line) => line.includes('❌'));
  const passes = out.split('\n').filter((line) => line.includes('✅')).length;

  if (child.status === 0 && failures.length === 0 && passes > 0) {
    pass(`the #3052 suite runs to the end under ambient tag.gpgSign / commit.gpgSign (${passes} assertions)`);
  } else {
    const why = failures[0]?.trim()
      || (child.stderr || '').split('\n').find((line) => /fatal:|error:|Error: /.test(line))?.trim()
      || 'no output';
    fail(`the #3052 suite does not survive ambient signing config (exit ${child.status}, ${passes} assertions ran): ${why}`);
  }
  // Both tag kinds the fixture makes must still be what it asked for. Proven by
  // the suite's own assertions on the lightweight and the annotated release tag,
  // which sit after the tag commands and so only run when those succeed.
  if (/a release target that IS the tag commit is accepted/.test(out)) {
    pass('the release fixture got past its lightweight and annotated tags');
  } else {
    fail('the release fixture never reached the assertions after its `git tag` commands');
  }
} finally {
  rmSync(signingRoot, { recursive: true, force: true });
}

// A global `core.hooksPath` is the same leak through a different key. A
// contributor whose global hooks enforce a commit-message format (or run a
// scanner) sees every fixture commit rejected, so these suites threw at their
// first `git commit` before a single assertion ran. Each one is run here under
// a global config that points hooksPath at hooks that always fail; a fixture
// that does not pin its own hooksPath cannot commit at all under it.
console.log('\nhermetic git env — fixture commits survive a global core.hooksPath');

const hooksRoot = mkdtempSync(join(tmpdir(), 'career-ops-hermetic-hooks-'));
try {
  const hooksDir = join(hooksRoot, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  for (const hook of ['pre-commit', 'commit-msg']) {
    writeFileSync(join(hooksDir, hook), '#!/bin/sh\necho "rejected by a global hook" >&2\nexit 1\n', { mode: 0o755 });
  }
  const hooksConfig = join(hooksRoot, 'gitconfig');
  writeFileSync(hooksConfig, `[core]\n\thooksPath = ${hooksDir.replace(/\\/g, '/')}\n`);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: hooksConfig };
  for (const name of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG']) delete env[name];

  for (const name of [
    'doctor-code-root-checks',
    'doctor-tracked-bak-files',
    'update-system',
    'updater-commit-file-modes',
    'updater-drift-detection',
    'updater-signature-ledger-drift',
    'updater-status-paths',
    'updater-upgrade-safety',
  ]) {
    const suite = fileURLToPath(new URL(`./${name}.test.mjs`, import.meta.url));
    const child = spawnSync(process.execPath, [suite], { encoding: 'utf-8', timeout: 120000, env });
    const out = child.stdout || '';
    const failures = out.split('\n').filter((line) => line.includes('❌'));
    if (child.status === 0 && failures.length === 0) {
      pass(`${name} commits its fixtures under a global hooksPath that rejects every commit`);
    } else {
      const why = failures[0]?.trim()
        || (child.stderr || '').split('\n').find((line) => /fatal:|error:|Error: /.test(line))?.trim()
        || 'no output';
      fail(`${name} does not survive a global core.hooksPath (exit ${child.status}): ${why}`);
    }
  }
} finally {
  rmSync(hooksRoot, { recursive: true, force: true });
}

// The same signing config, against the suites whose fixtures run git through
// something that inherits process.env (the updater's own gitIn, a bare
// execFileSync, a spawned CLI) and so are sealed by sealProcessGitEnv() rather
// than by a fixture runner. updater-branch-guard tags a fixture commit, which
// is the "no tag message?" case on a machine that signs tags; the rest only
// commit, which signs with the contributor's key or fails where none is
// reachable. A suite that loses its seal cannot build a fixture under this.
console.log('\nhermetic git env — process-sealed suites survive ambient signing config');

const sealedRoot = mkdtempSync(join(tmpdir(), 'career-ops-hermetic-sealed-'));
try {
  const signingConfig = join(sealedRoot, 'gitconfig');
  writeFileSync(signingConfig, [
    '[tag]', '\tgpgSign = true', '\tforceSignAnnotated = true',
    '[commit]', '\tgpgSign = true',
    '[gpg]', `\tprogram = ${join(sealedRoot, 'no-such-signing-program')}`,
    '',
  ].join('\n'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: signingConfig };
  for (const name of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG']) delete env[name];

  for (const name of [
    'doctor-code-root-checks',
    'doctor-tracked-bak-files',
    'update-system',
    'updater-branch-guard',
    'updater-commit-file-modes',
    'updater-status-paths',
    'updater-upgrade-safety',
  ]) {
    const suite = fileURLToPath(new URL(`./${name}.test.mjs`, import.meta.url));
    const child = spawnSync(process.execPath, [suite], { encoding: 'utf-8', timeout: 120000, env });
    const out = child.stdout || '';
    const failures = out.split('\n').filter((line) => line.includes('❌'));
    if (child.status === 0 && failures.length === 0) {
      pass(`${name} builds its fixtures under ambient tag.gpgSign / commit.gpgSign`);
    } else {
      const why = failures[0]?.trim()
        || (child.stderr || '').split('\n').find((line) => /fatal:|error:|Error: /.test(line))?.trim()
        || 'no output';
      fail(`${name} does not survive ambient signing config (exit ${child.status}): ${why}`);
    }
  }
} finally {
  rmSync(sealedRoot, { recursive: true, force: true });
}

// The serial loop (`test-all.mjs --jobs 1`) imports a suite into test-all's own
// process, so a seal must end with the suite that made it: every suite after it
// would otherwise run with the sealed config and without the variables the seal
// dropped. A probe suite seals and records what it saw; importSuiteContained,
// the serial loop's own import path, must hand the ambient values back. The
// mixed-case Git_Dir is the Windows spelling of GIT_DIR, which the seal has to
// drop too.
console.log('\nhermetic git env — a process seal ends with the in-process suite that made it');

const unsealRoot = mkdtempSync(join(tmpdir(), 'career-ops-hermetic-unseal-'));
const savedEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, Git_Dir: process.env.Git_Dir };
try {
  const ambientConfig = join(unsealRoot, 'ambient-gitconfig');
  const ambientGitDir = join(unsealRoot, 'elsewhere.git');
  process.env.GIT_CONFIG_GLOBAL = ambientConfig;
  process.env.Git_Dir = ambientGitDir;
  const probe = join(unsealRoot, 'sealing-probe.mjs');
  const helpersUrl = new URL('./helpers.mjs', import.meta.url).href;
  writeFileSync(probe, [
    `import { sealProcessGitEnv } from ${JSON.stringify(helpersUrl)};`,
    'sealProcessGitEnv();',
    'globalThis.__coSealedGitEnv = { global: process.env.GIT_CONFIG_GLOBAL, gitDir: process.env.Git_Dir };',
    '',
  ].join('\n'));
  await importSuiteContained(probe, 'sealing probe');
  const during = globalThis.__coSealedGitEnv;
  delete globalThis.__coSealedGitEnv;

  if (during && during.global !== ambientConfig && during.gitDir === undefined) {
    pass('the probe ran sealed: its own global config, and no Git_Dir');
  } else {
    fail(`the probe was not sealed: ${JSON.stringify(during)}`);
  }
  if (process.env.GIT_CONFIG_GLOBAL === ambientConfig && process.env.Git_Dir === ambientGitDir) {
    pass('importSuiteContained hands the ambient git environment back after a sealing suite');
  } else {
    fail(`the seal outlived its suite: GIT_CONFIG_GLOBAL=${process.env.GIT_CONFIG_GLOBAL} Git_Dir=${process.env.Git_Dir}`);
  }
} finally {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(unsealRoot, { recursive: true, force: true });
}
