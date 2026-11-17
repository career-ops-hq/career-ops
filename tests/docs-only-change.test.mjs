// tests/docs-only-change.test.mjs — what counts as a docs-only change, and what
// test.yml does with the answer (#6402, #5723).
//
// The failure that matters is a wrong "yes": it removes checks from code and
// stays green. So most cases here are things that must NOT count as docs, and
// the git cases run on real merge commits in a real shallow clone, because the
// classifier's job is reading the checkout CI actually has.
//
// Run:  node --test tests/docs-only-change.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import { classifyCheckout, isDocsOnly, isDocsPath } from '../.github/scripts/docs-only-change.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, '.github', 'scripts', 'docs-only-change.mjs');

test('isDocsPath accepts prose and images in the documented places', () => {
  for (const path of [
    'README.md', 'README.pt-BR.md', 'CONTRIBUTING.md', 'GOVERNANCE.md', 'CODE_OF_CONDUCT.md',
    'SECURITY.md', 'SUPPORT.md', 'SIGNATURES.md',
    'docs/WINDOWS.md', 'docs/recipes/gojobs/README.md', 'docs/press/wired.svg',
    'docs/logo.png', 'docs/hero-banner.jpg', 'docs/demo.gif',
  ]) assert.equal(isDocsPath(path), true, path);
});

test('isDocsPath refuses anything that can change behaviour', () => {
  for (const path of [
    // Read by agents, or shipped as instructions.
    'AGENTS.md', 'CLAUDE.md', 'DATA_CONTRACT.md', 'modes/oferta.md', 'templates/states.yml',
    'batch/batch-prompt.md',
    // A README in the wrong place: the patterns are for the repo root.
    'batch/README.md', 'modes/README.md', 'web/README.md', 'web/docs/README.md',
    // docs/ holds code and fixtures as well as prose.
    'docs/recipes/gojobs/parse-gojobs-html.mjs',
    'docs/recipes/gojobs/fixtures/gojobs-search-results.html',
    'docs/hired-count.json',
    // Near misses of the patterns.
    'README.mjs', 'README', 'docs', 'docs.md', 'docsx/a.md', '.github/docs/a.md',
    // CI itself.
    '.github/workflows/test.yml', '.github/scripts/docs-only-change.mjs', 'package.json',
  ]) assert.equal(isDocsPath(path), false, path);
});

test('isDocsOnly needs at least one file, and every file to be docs', () => {
  assert.equal(isDocsOnly(['README.md', 'docs/a.md']), true);
  assert.equal(isDocsOnly(['README.md', 'scan.mjs']), false);
  assert.equal(isDocsOnly([]), false);
});

// ── A real checkout ─────────────────────────────────────────────────────────

const sandboxes = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'co-docs-only-'));
  sandboxes.push(dir);
  return dir;
}
after(() => { for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true }); });

// A hook or an outer git process exports these, and they would aim every
// command below at the real repository. Removed from process.env itself because
// classifyCheckout runs in this process and its git calls inherit it.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete process.env[name];
const GIT_ENV = { ...process.env };

function git(cwd, ...args) {
  return execFileSync('git', [
    '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args,
  ], { cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function commitAll(repo, message) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

/**
 * A clone holding what actions/checkout gives a pull_request run with
 * fetch-depth: 2: GitHub's test merge of `change` into a base that has moved on
 * since the branch was cut, and nothing older than the merge's parents.
 */
function prCheckout(change) {
  const origin = tempDir();
  git(origin, 'init', '-q', '-b', 'main');
  write(origin, 'scan.mjs', 'export {};\n');
  write(origin, 'README.md', '# hello\n');
  write(origin, 'docs/a.md', 'a\n');
  commitAll(origin, 'base');

  git(origin, 'switch', '-q', '-c', 'pr');
  change(origin);
  commitAll(origin, 'the change');

  git(origin, 'switch', '-q', 'main');
  write(origin, 'landed-after-the-branch-was-cut.mjs', 'export {};\n');
  commitAll(origin, 'moved on');
  git(origin, 'merge', '-q', '--no-ff', '-m', 'test merge', 'pr');

  const clone = join(tempDir(), 'clone');
  git(dirname(clone), 'clone', '-q', '--depth=2', pathToFileURL(origin).href, clone);
  return clone;
}

test('a docs-only PR is docs-only, even when the base has moved on with code', () => {
  const clone = prCheckout((repo) => write(repo, 'README.md', '# hello there\n'));
  assert.equal(classifyCheckout(clone).docsOnly, true);
});

test('a PR that changes one code file among docs is not docs-only, and says which', () => {
  const clone = prCheckout((repo) => {
    write(repo, 'docs/a.md', 'changed\n');
    write(repo, 'scan.mjs', 'export const x = 1;\n');
  });
  const { docsOnly, reason } = classifyCheckout(clone);
  assert.equal(docsOnly, false);
  assert.match(reason, /"scan\.mjs"/);
});

test('moving code into docs/ is not docs-only, because the code left its old path', () => {
  const clone = prCheckout((repo) => renameSync(join(repo, 'scan.mjs'), join(repo, 'docs', 'scan.md')));
  assert.equal(classifyCheckout(clone).docsOnly, false);
});

test('a non-ASCII docs path still reads as docs, not as a quoted name', () => {
  const clone = prCheckout((repo) => write(repo, 'docs/résumé-guide.md', 'x\n'));
  assert.equal(classifyCheckout(clone).docsOnly, true);
});

test('a checkout that is not a merge commit is not docs-only', () => {
  const repo = tempDir();
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, 'scan.mjs', 'export {};\n');
  commitAll(repo, 'code');
  write(repo, 'README.md', '# hello\n');
  commitAll(repo, 'docs on top of code');
  assert.equal(classifyCheckout(repo).docsOnly, false);
});

test('a merge that changes nothing is not docs-only', () => {
  const repo = tempDir();
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, 'README.md', '# hello\n');
  commitAll(repo, 'base');
  git(repo, 'switch', '-q', '-c', 'pr');
  write(repo, 'README.md', '# same on both sides\n');
  commitAll(repo, 'the change');
  git(repo, 'switch', '-q', 'main');
  write(repo, 'README.md', '# same on both sides\n');
  commitAll(repo, 'the same change, already on the base');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge', 'pr');
  const { docsOnly, reason } = classifyCheckout(repo);
  assert.equal(docsOnly, false);
  assert.match(reason, /empty/);
});

/**
 * A clone holding what actions/checkout gives a merge_group run with
 * fetch-depth: 2: the entry's squash commit and its parent, which is the head of
 * the entry ahead of it. Returns the clone and the sha after each change.
 */
function queueCheckout(...changes) {
  const origin = tempDir();
  git(origin, 'init', '-q', '-b', 'main');
  write(origin, 'scan.mjs', 'export {};\n');
  write(origin, 'README.md', '# hello\n');
  commitAll(origin, 'main');
  const shas = [git(origin, 'rev-parse', 'HEAD').trim()];
  for (const change of changes) {
    change(origin);
    commitAll(origin, 'an entry');
    shas.push(git(origin, 'rev-parse', 'HEAD').trim());
  }
  const clone = join(tempDir(), 'clone');
  git(dirname(clone), 'clone', '-q', '--depth=2', pathToFileURL(origin).href, clone);
  return { clone, shas };
}

const editDocs = (repo) => write(repo, 'docs/a.md', 'changed\n');
const editCode = (repo) => write(repo, 'scan.mjs', 'export const x = 1;\n');

test('a docs entry in the merge queue is docs-only', () => {
  const { clone, shas } = queueCheckout(editDocs);
  assert.equal(classifyCheckout(clone, shas[0]).docsOnly, true);
});

test('a code entry in the merge queue is not docs-only', () => {
  const { clone, shas } = queueCheckout(editCode);
  assert.equal(classifyCheckout(clone, shas[0]).docsOnly, false);
});

test('a docs entry behind a code entry is judged on its own change', () => {
  const { clone, shas } = queueCheckout(editCode, editDocs);
  assert.equal(classifyCheckout(clone, shas[1]).docsOnly, true);
});

test('a queue base that is not on disk is not docs-only', () => {
  const { clone, shas } = queueCheckout(editCode, editDocs);
  const { docsOnly, reason } = classifyCheckout(clone, shas[0]);
  assert.equal(docsOnly, false);
  assert.match(reason, /could not read the diff/);
});

// ── The command line, as the workflow step runs it ──────────────────────────

function runScript(cwd, env = {}, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env } });
}

test('the script writes its answer to GITHUB_OUTPUT', () => {
  const clone = prCheckout((repo) => write(repo, 'docs/a.md', 'changed\n'));
  const output = join(tempDir(), 'output');
  const r = runScript(clone, { GITHUB_OUTPUT: output });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'docs_only=true\n');
});

test('the script reads the queue base from MERGE_GROUP_BASE_SHA', () => {
  const { clone, shas } = queueCheckout(editDocs);
  const output = join(tempDir(), 'output');
  const r = runScript(clone, { GITHUB_OUTPUT: output, MERGE_GROUP_BASE_SHA: shas[0] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'docs_only=true\n');
});

test('outside a git checkout the script answers false and exits 0', () => {
  const output = join(tempDir(), 'output');
  const r = runScript(tempDir(), { GITHUB_OUTPUT: output });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'docs_only=false\n');
});

test('--help prints usage and decides nothing', () => {
  const output = join(tempDir(), 'output');
  const r = runScript(tempDir(), { GITHUB_OUTPUT: output }, ['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage:/);
  assert.equal(existsSync(output), false);
});

// ── The workflow's use of the answer ────────────────────────────────────────

let jobs;
before(() => {
  jobs = load(readFileSync(join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8')).jobs;
});

test('the three required legs keep their names, so the checks still report', () => {
  assert.deepEqual(jobs.test.strategy.matrix.os, ['ubuntu-latest', 'macos-latest', 'windows-latest']);
  assert.equal(jobs.test.name, undefined, 'a job name would change the required check names');
});

test('a failed or skipped classifier cannot stop the required legs', () => {
  assert.equal(jobs.test.needs, 'changes');
  assert.match(jobs.test.if, /!cancelled\(\)/);
  assert.doesNotMatch(jobs.test.if, /docs_only/, 'the job must run so its check reports; only its steps skip');
});

test('only a docs-only answer skips a leg, and never the Ubuntu one', () => {
  assert.equal(jobs.test.env.SKIP_LEG, "${{ needs.changes.outputs.docs_only == 'true' && matrix.os != 'ubuntu-latest' }}");
});

test('every step of a skipped leg is skipped, apart from the one saying why', () => {
  const [notice, ...rest] = jobs.test.steps;
  assert.equal(notice.if, "env.SKIP_LEG == 'true'");
  for (const step of rest) {
    assert.match(String(step.if), /env\.SKIP_LEG != 'true'/, `step without the guard: ${step.name || step.run || step.uses}`);
  }
  assert.ok(rest.some((step) => step.run === 'node test-all.mjs --quick'), 'the suite is still a step of this job');
});

test('the optional jobs skip on a docs-only PR, and a failed classifier runs them', () => {
  for (const name of ['cv-visual', 'tool-suites', 'upgrade-gate', 'dependency-audit']) {
    const job = jobs[name];
    assert.equal(job.needs, 'changes', name);
    assert.match(job.if, /!cancelled\(\)/, name);
    assert.match(job.if, /needs\.changes\.outputs\.docs_only != 'true'/, name);
  }
});

test('the classifier runs in the merge queue too, and is told the base', () => {
  assert.equal(jobs.changes.if, undefined, 'a condition here could leave the queue on the full matrix unnoticed');
  const step = jobs.changes.steps.find((s) => s.id === 'classify');
  assert.equal(step.env.MERGE_GROUP_BASE_SHA, '${{ github.event.merge_group.base_sha }}');
});

test('the classifier sees both parents of the test merge', () => {
  const checkout = jobs.changes.steps.find((step) => String(step.uses).startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], 2, 'with depth 1, HEAD^1 is missing and every PR reads as not docs-only');
  assert.equal(checkout.with['persist-credentials'], false);
});
