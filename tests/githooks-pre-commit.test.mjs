// tests/githooks-pre-commit.test.mjs — the opt-in pre-commit hook (#6535).
//
// The hook is a contributor convenience, so most of what can go wrong with it
// is drift: its copy of the user-layer path list falls behind
// .github/workflows/no-user-data.yml, it blocks a file the repo already
// tracks, or it loses its executable bit. The first three tests pin those.
// The rest prove each check fires on a synthetic offender, and the last ones
// run the hook through a real `git commit` in a throwaway repository.
//
// Credential-shaped test values are assembled at runtime, so this file holds
// no literal that the hook, a secret scanner or GitHub push protection would
// flag.
//
// Run:  node --test tests/githooks-pre-commit.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hermeticGitEnv } from './helpers.mjs';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';
import {
  EXACT_SCAFFOLD,
  SECRET_ALLOW_MARKER,
  USER_PATHS,
  blockedPathReason,
  findSecrets,
  isScaffold,
  parseSkip,
  whitespaceSummary,
} from '../.githooks/pre-commit.mjs';
import { HOOKS_PATH, planInstall } from '../.githooks/install.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOW = '.github/workflows/no-user-data.yml';

/**
 * Evaluate the workflow's own USER_PATHS, EXACT_SCAFFOLD and isScaffold, the
 * same slice tests/no-user-data-batch-guard.test.mjs evaluates, so this
 * compares against the shipped logic and not a hand-copied list.
 */
function loadWorkflowGuard() {
  const yaml = readFileSync(join(ROOT, WORKFLOW), 'utf-8');
  const start = yaml.indexOf('const USER_PATHS = [');
  const end = yaml.indexOf('const bad = files');
  assert.ok(start !== -1, `${WORKFLOW} has no USER_PATHS declaration`);
  assert.ok(end > start, `${WORKFLOW} no longer consumes USER_PATHS via "const bad = files"`);
  // eslint-disable-next-line no-new-func
  return new Function(`${yaml.slice(start, end)}\nreturn { USER_PATHS, EXACT_SCAFFOLD, isScaffold };`)();
}

/** @returns {string[]} Every path the index holds. */
function trackedFiles() {
  return execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

const sortedSources = (list) => list.map((re) => `/${re.source}/${re.flags}`).sort();

test('the hook blocks the same user-layer paths as no-user-data.yml', () => {
  const wf = loadWorkflowGuard();

  assert.deepEqual(
    sortedSources(USER_PATHS),
    sortedSources(wf.USER_PATHS),
    `.githooks/pre-commit.mjs USER_PATHS has drifted from ${WORKFLOW}`,
  );
  const asLists = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]));
  assert.deepEqual(
    asLists(EXACT_SCAFFOLD),
    asLists(wf.EXACT_SCAFFOLD),
    `.githooks/pre-commit.mjs EXACT_SCAFFOLD has drifted from ${WORKFLOW}`,
  );

  // Equal lists can still be read differently, so compare the two isScaffold
  // decisions over every tracked path plus names that sit on each edge.
  const corpus = [
    ...trackedFiles(),
    'batch/tmp/README.md',
    'batch/cv-001.json',
    'documents/private/README.md',
    'data/.gitkeep',
    'reports/README.md',
    'reports/001-acme.md',
  ];
  const disagree = corpus.filter((f) => isScaffold(f) !== wf.isScaffold(f));
  assert.deepEqual(disagree, [], `the hook and ${WORKFLOW} disagree on isScaffold for: ${disagree.join(', ')}`);
});

test('the path check passes every file the repo already tracks', () => {
  const tracked = trackedFiles();
  assert.ok(tracked.length > 1000, `git ls-files listed only ${tracked.length} paths — the sweep would pass vacuously`);
  const blocked = tracked.filter((f) => blockedPathReason(f));
  assert.deepEqual(
    blocked,
    [],
    `the hook would block a commit that edits these tracked files: ${blocked.join(', ')}`,
  );
});

test('.githooks/pre-commit is tracked as executable', () => {
  const entry = execFileSync('git', ['-C', ROOT, 'ls-files', '-s', '--', '.githooks/pre-commit'], { encoding: 'utf-8' });
  assert.match(entry, /^100755 /, `git runs no hook without the executable bit; index entry: ${entry.trim() || '(none)'}`);
});

test('hooks:install is opt-in and nothing installs the hook for you', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  assert.equal(pkg.scripts['hooks:install'], 'node .githooks/install.mjs');
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (name === 'hooks:install') continue;
    assert.doesNotMatch(
      cmd,
      /hooksPath|githooks\/install|hooks:install/,
      `npm script "${name}" installs the hook; it must stay opt-in`,
    );
  }
});

test('hooks:install keeps an existing core.hooksPath unless forced', () => {
  assert.equal(planInstall(null, false).action, 'set');
  assert.equal(planInstall(HOOKS_PATH, false).action, 'keep');
  assert.equal(planInstall('.husky', false).action, 'refuse');
  const forced = planInstall('.husky', true);
  assert.equal(forced.action, 'set');
  assert.match(forced.message, /git config core\.hooksPath "\.husky"/, 'a forced install must say how to restore the old value');
});

test('whitespaceSummary keeps the git --check headers and drops the echoed lines', () => {
  const out = 'src/a.mjs:3: trailing whitespace.\n+const k = 1;   \nsrc/a.mjs:9: new blank line at EOF.\n';
  assert.equal(whitespaceSummary(out), 'src/a.mjs:3: trailing whitespace.\nsrc/a.mjs:9: new blank line at EOF.');
});

test('the coverage check reads SYSTEM_PATHS from the index under --index', (t) => {
  // A temporary index that stages a manifest without the .githooks/ entry,
  // while the working tree keeps it. Only --index should see the gap.
  const realIndex = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-path', 'index'], {
    encoding: 'utf-8',
  }).trim();
  const scratch = mkdtempSync(join(tmpdir(), 'co-cov-index-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const index = join(scratch, 'index');
  copyFileSync(realIndex, index);
  const env = { ...process.env, GIT_INDEX_FILE: index };

  const manifest = readFileSync(join(ROOT, 'lib', 'update-manifest.mjs'), 'utf-8');
  const dropped = manifest.replace("  '.githooks/',\n", '');
  assert.notEqual(dropped, manifest, "lib/update-manifest.mjs has no '.githooks/' entry to drop");
  const blob = execFileSync('git', ['-C', ROOT, 'hash-object', '-w', '--stdin'], { input: dropped, encoding: 'utf-8' }).trim();
  execFileSync('git', ['-C', ROOT, 'update-index', '--cacheinfo', `100644,${blob},lib/update-manifest.mjs`], { env });

  const run = (args) =>
    spawnSync(process.execPath, ['validate-system-paths-coverage.mjs', ...args], { cwd: ROOT, encoding: 'utf-8', env });
  const tree = run([]);
  assert.equal(tree.status, 0, describeSpawn(tree, 'the working-tree read should still see .githooks/'));
  const staged = run(['--index']);
  assert.ok(exitedNonZero(staged), describeSpawn(staged, '--index passed a staged manifest missing .githooks/'));
  assert.match(staged.stdout + staged.stderr, /\.githooks\/pre-commit/);
});

test('the path check blocks private files and lets their neighbours through', () => {
  const blocked = [
    'cv.md',
    'config/profile.yml',
    'reports/001-acme.md',
    'batch/cv-001.json',
    'documents/private/README.md',
    'cv.pdf',
    'Resume.DOCX',
    'cover-letter.pdf',
    'my-cv.md',
    'resume.txt',
    'CV_2026.html',
    'résumé.md',
    '.env',
    '.env.local',
    'config/.env',
  ];
  const allowed = [
    'README.md',
    'cv-sync-check.mjs',
    'build-cv-html.mjs',
    'examples/cv-example.md',
    'examples/resume-example.md',
    'docs/guide.pdf',
    'CVE-notes.md',
    'reports/.gitkeep',
    'batch/batch-runner.sh',
    '.env.example',
    '.envrc',
  ];
  assert.deepEqual(blocked.filter((f) => !blockedPathReason(f)), [], 'these should be blocked');
  assert.deepEqual(allowed.filter((f) => blockedPathReason(f)), [], 'these should be allowed');
});

// Fake tokens, assembled so no literal in this file matches a pattern.
const FAKES = {
  'AWS access key ID': 'AKIA' + 'Q'.repeat(16),
  'Anthropic API key': 'sk-' + 'ant-api03-' + 'x'.repeat(40),
  'GitHub token': 'ghp' + '_' + 'a'.repeat(36),
  'Google API key': 'AIza' + 'b'.repeat(35),
  'OpenRouter API key': 'sk-or-' + 'v1-' + 'c'.repeat(64),
  'private key': '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  'Slack token': 'xo' + 'xb-' + '1234567890-abcdef',
};

/** A one-file `git diff -U0` with `added` lines starting at line 10. */
function diffOf(file, added, { removed = [] } = {}) {
  return [
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -10,${removed.length} +10,${added.length} @@`,
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    '',
  ].join('\n');
}

test('the secret check finds each credential format and names it without the value', () => {
  for (const [name, value] of Object.entries(FAKES)) {
    const hits = findSecrets(diffOf('config/x.mjs', ['const ok = 1;', `const key = '${value}';`]));
    assert.deepEqual(hits, [{ file: 'config/x.mjs', line: 11, name }], `missed or misreported ${name}`);
    assert.ok(!JSON.stringify(hits).includes(value), `${name}: the report echoes the secret`);
  }
});

test('the secret check reads added lines only and honours the allow marker', () => {
  const key = FAKES['AWS access key ID'];
  assert.deepEqual(findSecrets(diffOf('a.mjs', ['x'], { removed: [key] })), [], 'a removed line is not a leak');
  assert.deepEqual(findSecrets(diffOf('a.mjs', [`${key} // ${SECRET_ALLOW_MARKER}`])), []);
  assert.deepEqual(
    findSecrets(diffOf('a.mjs', ['sk-learn is a library', 'an AKIA prefix alone', 'ghp_short'])),
    [],
    'prose that only mentions a prefix must pass',
  );
  // An added line that itself reads like a diff header stays an added line.
  assert.deepEqual(findSecrets(diffOf('a.md', [`++ b/${key}`])), [{ file: 'a.md', line: 10, name: 'AWS access key ID' }]);
  // git C-quotes a path holding a quote or a backslash.
  const quoted = [
    'diff --git "a/we\\"ird.txt" "b/we\\"ird.txt"',
    '--- "a/we\\"ird.txt"',
    '+++ "b/we\\"ird.txt"',
    '@@ -0,0 +1 @@',
    `+${key}`,
  ].join('\n');
  assert.deepEqual(findSecrets(quoted), [{ file: 'we"ird.txt', line: 1, name: 'AWS access key ID' }]);
});

test('CAREER_OPS_HOOK_SKIP keeps known names and reports the rest', () => {
  const { skip, unknown } = parseSkip('lint, coverage gofmt,nope');
  assert.deepEqual([...skip].sort(), ['coverage', 'gofmt', 'lint']);
  assert.deepEqual(unknown, ['nope']);
  assert.equal(parseSkip(undefined).skip.size, 0);
});

/**
 * A throwaway repository with this checkout's .githooks/ enabled. The git
 * environment is sealed so a contributor's global config cannot sign the
 * commits or point core.hooksPath elsewhere. coverage and lint are skipped:
 * they run this repository's scripts, which the fixture does not have.
 */
function hookRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'co-githooks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.githooks'));
  for (const f of ['install.mjs', 'pre-commit', 'pre-commit.mjs']) copyFileSync(join(ROOT, '.githooks', f), join(dir, '.githooks', f));
  // The hook imports these two for its flag handling and entry guard.
  mkdirSync(join(dir, 'lib'));
  for (const f of ['cli-flags.mjs', 'is-main-module.mjs']) copyFileSync(join(ROOT, 'lib', f), join(dir, 'lib', f));
  chmodSync(join(dir, '.githooks', 'pre-commit'), 0o755);

  const env = hermeticGitEnv(join(dir, 'co-hermetic-gitconfig'));
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
    delete env[name];
  }
  env.CAREER_OPS_HOOK_SKIP = 'coverage,lint';
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env });
  const must = (...args) => {
    const r = git(...args);
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  };
  must('init', '-q', '-b', 'main', '.');
  must('config', 'user.email', 'test@example.com');
  must('config', 'user.name', 'Test');
  must('config', 'commit.gpgsign', 'false');
  must('config', 'core.autocrlf', 'false');
  must('config', 'core.hooksPath', '.githooks');
  must('add', '.githooks');
  must('commit', '-q', '-m', 'seed');

  const commit = (files) => {
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), body);
      must('add', '-f', name);
    }
    return git('commit', '-q', '-m', 'change');
  };
  return { commit, dir, env, git };
}

test('a commit runs the hook and is refused over a private file', (t) => {
  const { commit, git } = hookRepo(t);
  const r = commit({ 'cv.md': '# Jane Doe\n' });
  assert.ok(exitedNonZero(r), describeSpawn(r, 'the commit went through with cv.md staged'));
  assert.match(r.stderr, /✗ paths/);
  assert.match(r.stderr, /cv\.md/);
  assert.equal(git('rev-list', '--count', 'HEAD').stdout.trim(), '1', 'a refused commit still landed');
});

test('a commit is refused over a staged key, and the key is not printed', (t) => {
  const { commit } = hookRepo(t);
  const key = FAKES['GitHub token'];
  const r = commit({ 'src/a.mjs': `export const token = '${key}';\n` });
  assert.ok(exitedNonZero(r), describeSpawn(r, 'the commit went through with a key staged'));
  assert.match(r.stderr, /src\/a\.mjs:1 {2}GitHub token/);
  assert.ok(!r.stderr.includes(key), 'the hook printed the secret it found');
});

test('trailing whitespace blocks code but not Markdown', (t) => {
  const { commit } = hookRepo(t);
  const md = commit({ 'notes.md': 'line one  \nline two\n' });
  assert.equal(md.status, 0, `trailing spaces in Markdown are a line break and must pass: ${md.stderr}`);

  const code = commit({ 'src/b.mjs': 'export const b = 1;   \n' });
  assert.ok(exitedNonZero(code), describeSpawn(code, 'trailing whitespace in a .mjs file passed'));
  assert.match(code.stderr, /✗ whitespace/);
});

test('a key with trailing spaces stays out of the whitespace report', (t) => {
  const { commit } = hookRepo(t);
  const key = FAKES['AWS access key ID'];
  const r = commit({ 'src/k.mjs': `export const k = '${key}';   \n` });
  assert.ok(exitedNonZero(r), describeSpawn(r, 'the commit went through with a key staged'));
  assert.match(r.stderr, /✗ whitespace[\s\S]*src\/k\.mjs:1: trailing whitespace/);
  assert.ok(!r.stderr.includes(key), 'git --check echoed the line holding the key');
});

test('hooks:install sets core.hooksPath, and refuses to replace another value without --force', (t) => {
  const { dir, env, git } = hookRepo(t);
  const install = (...args) =>
    spawnSync(process.execPath, [join('.githooks', 'install.mjs'), ...args], { cwd: dir, encoding: 'utf-8', env });
  const hooksPath = () => git('config', '--get', 'core.hooksPath').stdout.trim();

  assert.equal(install().status, 0, 'an install over its own value should be a no-op success');

  assert.equal(git('config', 'core.hooksPath', '.husky').status, 0);
  const refused = install();
  assert.ok(exitedNonZero(refused), describeSpawn(refused, 'install replaced an existing core.hooksPath'));
  assert.equal(hooksPath(), '.husky', 'a refused install still changed core.hooksPath');

  const forced = install('--force');
  assert.equal(forced.status, 0, describeSpawn(forced, 'install --force'));
  assert.equal(hooksPath(), '.githooks');
  assert.match(forced.stdout, /git config core\.hooksPath "\.husky"/);

  assert.equal(git('config', '--unset', 'core.hooksPath').status, 0);
  const fresh = install();
  assert.equal(fresh.status, 0, describeSpawn(fresh, 'install with no hooksPath set'));
  assert.equal(hooksPath(), '.githooks');

  // A worktree-scoped value outranks the clone's, so --force writes the clone
  // config and the old value still wins. The install must say so, not succeed.
  assert.equal(git('config', 'extensions.worktreeConfig', 'true').status, 0);
  assert.equal(git('config', '--worktree', 'core.hooksPath', '.husky').status, 0);
  const shadowed = install('--force');
  assert.ok(exitedNonZero(shadowed), describeSpawn(shadowed, 'install reported success under a worktree override'));
  assert.match(shadowed.stderr, /git config --worktree core\.hooksPath \.githooks/);
  assert.equal(hooksPath(), '.husky');
});

test('a clean commit passes and reports what it skipped', (t) => {
  const { commit } = hookRepo(t);
  const r = commit({ 'src/c.mjs': 'export const c = 1;\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /coverage: skipped \(CAREER_OPS_HOOK_SKIP\)/);
});

const hasGofmt = !spawnSync('gofmt', ['-h']).error;

test('gofmt flags an unformatted staged dashboard .go file', { skip: !hasGofmt && 'gofmt not on PATH' }, (t) => {
  const { commit } = hookRepo(t);
  const bad = commit({ 'dashboard/x.go': 'package main\nfunc  main()  {}\n' });
  assert.ok(exitedNonZero(bad), describeSpawn(bad, 'an unformatted .go file passed'));
  assert.match(bad.stderr, /✗ gofmt[\s\S]*dashboard\/x\.go/);

  const good = commit({ 'dashboard/x.go': 'package main\n\nfunc main() {}\n' });
  assert.equal(good.status, 0, good.stderr);
});
