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

// The three required checks, by the name each job reports under.
const checkName = (id, job) => job.name ?? (job.strategy?.matrix?.os ? `${id} (${job.strategy.matrix.os[0]})` : id);
const reporters = (check) => Object.entries(jobs).filter(([id, job]) => checkName(id, job) === check).map(([id]) => id);

test('the three required checks are each reported by exactly one job', () => {
  // A second job under the same name would make the check ambiguous; none
  // would leave it waiting forever.
  assert.deepEqual(jobs.test.strategy.matrix.os, ['ubuntu-latest']);
  assert.equal(jobs.test.name, undefined, 'a job name would change the Ubuntu check name');
  assert.deepEqual(reporters('test (ubuntu-latest)'), ['test']);
  assert.deepEqual(reporters('test (macos-latest)'), ['test-macos']);
  assert.deepEqual(reporters('test (windows-latest)'), ['test-windows']);
});

test('a failed or skipped classifier cannot stop a required check', () => {
  for (const id of ['test', 'test-macos', 'test-windows', 'suite-ubuntu']) {
    assert.match(jobs[id].if, /^\$\{\{ !cancelled\(\) \}\}$/, id);
  }
  assert.equal(jobs['suite-ubuntu'].needs, 'changes');
  assert.deepEqual(jobs.test.needs, ['changes', 'suite-ubuntu']);
});

test('Ubuntu runs the whole suite for every change, in two shards, and its gate never accepts a skip', () => {
  const job = jobs['suite-ubuntu'];
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.deepEqual(job.strategy.matrix.shard, [1, 2]);
  assert.equal(job.strategy['fail-fast'], false);
  for (const step of job.steps) assert.doesNotMatch(String(step.if ?? ''), /SKIP_LEG|docs_only|event_name/, step.name || step.run || step.uses);
  assert.ok(job.steps.some((step) => step.run === 'node test-all.mjs --quick --shard "${{ matrix.shard }}/2"'));
  const [gate] = jobs.test.steps;
  assert.equal(gate.env.RESULT, '${{ needs.suite-ubuntu.result }}');
  assert.equal(gate.env.MAY_SKIP, undefined);
  if (process.platform !== 'win32') {
    const outcome = (RESULT) => spawnSync('bash', ['-c', gate.run], { env: { ...process.env, RESULT }, encoding: 'utf8' }).status;
    assert.equal(outcome('success'), 0);
    for (const r of ['skipped', 'failure', 'cancelled', '']) assert.equal(outcome(r), 1, `"${r}"`);
  }
});

const SHARDED = { macos: { suite: 'suite-macos', gate: 'test-macos', os: 'macos-latest', n: 2 }, windows: { suite: 'suite-windows', gate: 'test-windows', os: 'windows-latest', n: 3 } };

test('macOS and Windows shards run only in the merge queue, for a change that is not docs-only', () => {
  for (const { suite, os, n } of Object.values(SHARDED)) {
    const job = jobs[suite];
    assert.equal(job['runs-on'], os);
    assert.equal(job.if, "${{ !cancelled() && github.event_name == 'merge_group' && needs.changes.outputs.docs_only != 'true' }}", suite);
    assert.deepEqual(job.strategy.matrix.shard, Array.from({ length: n }, (_, i) => i + 1), suite);
    assert.equal(job.strategy['fail-fast'], false, `${suite}: one shard failing must not cancel the others`);
    const run = job.steps.find((step) => String(step.run).startsWith('node test-all.mjs'));
    assert.equal(run.run, `node test-all.mjs --quick --shard "\${{ matrix.shard }}/${n}"`, suite);
  }
});

test('the shard rule, evaluated: the queue runs them for code, never on a PR, and a failed classifier runs them', () => {
  const runs = ({ event, docsOnly }) => event === 'merge_group' && docsOnly !== 'true';
  assert.equal(runs({ event: 'merge_group', docsOnly: 'false' }), true);
  assert.equal(runs({ event: 'merge_group', docsOnly: '' }), true, 'classifier failed');
  assert.equal(runs({ event: 'merge_group', docsOnly: 'true' }), false);
  assert.equal(runs({ event: 'pull_request', docsOnly: 'false' }), false);
});

test('every OS runs the same steps, so the legs cannot drift apart', () => {
  const strip = (steps) => JSON.stringify(steps).replace(/\/[23]\\"/g, '/N\\"');
  assert.equal(strip(jobs['suite-macos'].steps), strip(jobs['suite-windows'].steps));
  assert.equal(strip(jobs['suite-ubuntu'].steps), strip(jobs['suite-windows'].steps));
});

test('a gate passes on every shard passing, or on a skip that was meant, and on nothing else', () => {
  for (const { suite, gate } of Object.values(SHARDED)) {
    const job = jobs[gate];
    assert.equal(job['runs-on'], 'ubuntu-latest', `${gate} must not wait for a macOS or Windows runner`);
    assert.deepEqual(job.needs, ['changes', suite]);
    const [step] = job.steps;
    assert.equal(step.env.RESULT, `\${{ needs.${suite}.result }}`);
    assert.equal(step.env.MAY_SKIP, "${{ github.event_name == 'pull_request' || needs.changes.outputs.docs_only == 'true' }}");
    // The script, run for every outcome GitHub reports.
    const outcome = (RESULT, MAY_SKIP) => spawnSync('bash', ['-c', step.run], { env: { ...process.env, RESULT, MAY_SKIP }, encoding: 'utf8' }).status;
    if (process.platform === 'win32') continue; // bash semantics checked where bash is native
    assert.equal(outcome('success', 'false'), 0);
    assert.equal(outcome('skipped', 'true'), 0, 'a PR or docs-only change');
    assert.equal(outcome('skipped', 'false'), 1, 'skipped in a merge queue run of code: never green');
    for (const r of ['failure', 'cancelled', '']) assert.equal(outcome(r, 'true'), 1, `"${r}"`);
  }
});

test('the workflow still runs in the merge queue', () => {
  const on = load(readFileSync(join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8')).on;
  assert.ok(Object.hasOwn(on, 'merge_group'), 'without merge_group the queue would never run the macOS and Windows shards');
});

test('the Go dashboard tests start early and still decide the leg (shard 1 only when sharded)', () => {
  for (const id of ['suite-ubuntu', 'suite-macos', 'suite-windows']) {
    const steps = jobs[id].steps;
    const start = steps.findIndex((step) => step.id === 'go_start');
    const wait = steps.findIndex((step) => step.name === 'Go dashboard tests');
    const suite = steps.findIndex((step) => String(step.run).startsWith('node test-all.mjs'));
    const install = steps.findIndex((step) => step.run === 'npm install --ignore-scripts');
    // After the install: the Go tests run the repo's Node scripts, which need
    // the dependencies (the first run of #7778 failed on js-yaml).
    assert.ok(install > 0 && install < start && start < suite && suite < wait, `${id}: install ${install}, start ${start}, suite ${suite}, wait ${wait}`);
    assert.match(steps[start].run, /go test \.\/\.\.\./);
    assert.match(steps[wait].if, /steps\.go_start\.outcome == 'success'/, 'never wait for a run that did not start');
    assert.match(steps[wait].run, /exit "\$\(cat "\$out\/go-test\.exit"\)"/, 'the leg ends with the Go exit code');
    assert.equal(steps[start].if, '${{ matrix.shard == 1 }}', id);
  }
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
