// tests/template-registry-validate-workflow.test.mjs: the template registry gate
// must not run the code that a registry PR is allowed to change (#6010).
//
// Mirror of tests/plugin-registry-validate-workflow.test.mjs. The workflow used
// to check out the pull request and run `node validate-template-registry.mjs`
// from that checkout, so a PR that added one registry entry could also edit the
// validator (or lib/templates-registry.mjs) so that it always exits 0.
//
// The fix runs the validator from a second checkout of the BASE branch. This
// validator defaults its root to its own directory, so the workflow must also
// pass `--root .` to point it at the PR's files; without that the base copy
// would validate the base registry and the gate would pass vacuously.
//
// Run:  node --test tests/template-registry-validate-workflow.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { ROOT } from './helpers.mjs';

const text = readFileSync(join(ROOT, '.github/workflows/template-registry-validate.yml'), 'utf8');
const wf = load(text);
const steps = wf.jobs.validate.steps;
const checkouts = steps.filter(s => String(s.uses || '').startsWith('actions/checkout@'));
const runs = steps.filter(s => typeof s.run === 'string');
const dirs = [];

// ── 1. The workflow ──────────────────────────────────────────────────────

test('keeps its security posture: pull_request, contents: read, no secrets', () => {
  assert.deepEqual(Object.keys(wf.on || wf[true] || {}), ['pull_request']);
  assert.deepEqual(wf.permissions, { contents: 'read' });
  assert.ok(!/\bsecrets\./.test(text), 'the job must not reference any secret');
  assert.ok(!/GITHUB_TOKEN/.test(text), 'the job must not hand the token to a step');
});

test('checks the base branch out beside the PR checkout', () => {
  const base = checkouts.filter(s => s.with && s.with.path === 'base');
  assert.equal(base.length, 1, 'exactly one checkout into base/');
  assert.equal(base[0].with.ref, '${{ github.base_ref }}');
  const pr = checkouts.filter(s => !(s.with && s.with.path));
  assert.equal(pr.length, 1);
  assert.ok(!pr[0].with || !pr[0].with.ref, 'the root checkout must stay the PR merge ref');
  assert.ok(steps.indexOf(pr[0]) < steps.indexOf(base[0]), 'checkout the PR first, then base/');
});

// Runs the shape-gate step's own shell script in a scratch tree, with `node`
// replaced by a stub that records its arguments, and returns what it ran.
const shapeStep = runs.find(s => s.run.includes('validate-template-registry.mjs'));
function runShapeStep({ baseHasValidator }) {
  const dir = mkdtempSync(join(tmpdir(), 'co-tpl-step-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'base'));
  writeFileSync(join(dir, 'validate-template-registry.mjs'), '');
  if (baseHasValidator) writeFileSync(join(dir, 'base', 'validate-template-registry.mjs'), '');
  const stub = join(dir, 'bin', 'node');
  writeFileSync(stub, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$NODE_LOG"\n');
  chmodSync(stub, 0o755);
  const log = join(dir, 'node.log');
  const r = spawnSync('bash', ['-e', '-c', shapeStep.run], {
    cwd: dir, encoding: 'utf8', env: { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, NODE_LOG: log },
  });
  assert.equal(r.status, 0, r.stderr);
  return readFileSync(log, 'utf8').trim().split('\n');
}

test('runs the base validator against the PR checkout', { skip: process.platform === 'win32' && 'the step runs in bash on ubuntu-latest; this replays it under a POSIX shell' }, () => {
  assert.ok(shapeStep, 'a step runs validate-template-registry.mjs');
  assert.deepEqual(runShapeStep({ baseHasValidator: true }), ['base/validate-template-registry.mjs --root .']);
});

test('runs the PR copy only while the base branch has no validator yet', { skip: process.platform === 'win32' && 'the step runs in bash on ubuntu-latest; this replays it under a POSIX shell' }, () => {
  // The PR that first adds the validator has no trusted copy to run. A PR cannot
  // delete the file from the base branch, so this branch is never reachable once
  // the validator has merged.
  assert.deepEqual(runShapeStep({ baseHasValidator: false }), ['validate-template-registry.mjs --root .']);
});

// Replays the one-pack step against a real repository: a clone of a base
// repository standing in for origin, with the PR's change committed on top.
const onePackStep = runs.find(s => s.run.includes('CHANGED='));
function runOnePackStep(change) {
  const dir = mkdtempSync(join(tmpdir(), 'co-tpl-onepack-'));
  dirs.push(dir);
  const env = {
    PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', HOME: dir, BASE_REF: 'main',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  const base = join(dir, 'base');
  mkdirSync(join(base, 'templates-registry'), { recursive: true });
  writeFileSync(join(base, 'templates-registry', 'old.json'), '{}\n');
  git(dir, 'init', '-q', base);
  git(base, 'add', '-A');
  git(base, 'commit', '-q', '-m', 'base');
  const pr = join(dir, 'pr');
  git(dir, 'clone', '-q', base, pr);
  change(pr);
  git(pr, 'add', '-A');
  git(pr, 'commit', '-q', '-m', 'pr');
  return spawnSync('bash', ['-e', '-c', onePackStep.run], { cwd: pr, env, encoding: 'utf8' });
}
const posixOnly = { skip: process.platform === 'win32' && 'the step runs in bash on ubuntu-latest; this replays it under a POSIX shell' };
const put = (pr, rel, body = '{}\n') => { mkdirSync(join(pr, rel, '..'), { recursive: true }); writeFileSync(join(pr, rel), body); };

test('one pack beside a nested JSON file still counts as one pack', posixOnly, () => {
  // The registry reads direct children only, so a nested file is not a second pack.
  const r = runOnePackStep((pr) => { put(pr, 'templates-registry/new.json'); put(pr, 'templates-registry/notes/extra.json'); });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('two packs in one PR are refused', posixOnly, () => {
  const r = runOnePackStep((pr) => { put(pr, 'templates-registry/new.json'); put(pr, 'templates-registry/other.json'); });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /exactly one/);
});

test('deleting a pack is refused', posixOnly, () => {
  const r = runOnePackStep((pr) => { rmSync(join(pr, 'templates-registry', 'old.json')); });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /not delete one/);
});

test('runs nothing else from the PR checkout', () => {
  for (const s of runs) {
    for (const line of s.run.split('\n')) {
      const t = line.trim();
      if (!/^(node|npm|npx|bash|sh|python3?)\b/.test(t)) continue;
      assert.match(t, /^node (base\/|"\$VALIDATOR")/, `only base/ code, or the chosen validator, may run: ${t}`);
    }
  }
});

test('pins every action to a full commit SHA', () => {
  const uses = steps.map(s => s.uses).filter(Boolean);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `unpinned action: ${u}`);
});

// ── 2. The validator behaves as the workflow assumes ─────────────────────

const VALIDATOR = join(ROOT, 'validate-template-registry.mjs');
function prCheckout(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-tpl-pr-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'templates-registry'));
  for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, 'templates-registry', f), body);
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('the base validator judges the directory --root names', () => {
  const bad = prCheckout({ 'evil.json': JSON.stringify({ name: 'oops', id: 'evil' }) });
  const r = run(VALIDATOR, '--root', bad);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /oops/);
  assert.equal(run(VALIDATOR, '--root', prCheckout()).status, 0, 'an empty registry is valid');
});

test('without --root the validator judges its own directory, which is why the workflow passes it', () => {
  const bad = prCheckout({ 'evil.json': JSON.stringify({ name: 'oops', id: 'evil' }) });
  const withoutRoot = spawnSync(process.execPath, [VALIDATOR], { cwd: bad, encoding: 'utf8' });
  assert.equal(withoutRoot.status, 0, 'cwd is ignored: the base registry is what was checked');
});

test('a validator rewritten inside the PR is not the one that runs', () => {
  const pr = prCheckout({ 'evil.json': JSON.stringify({ name: 'oops', id: 'evil' }) });
  const tampered = join(pr, 'validate-template-registry.mjs');
  writeFileSync(tampered, 'console.log("ok");\n');
  assert.equal(run(tampered, '--root', pr).status, 0, 'the PR copy passes anything');
  assert.equal(run(VALIDATOR, '--root', pr).status, 1, 'the base copy still rejects the entry');
});
