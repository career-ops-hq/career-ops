// tests/plugin-registry-validate-workflow.test.mjs: the registry gate must not
// run the code that a registry PR is allowed to change (#6010).
//
// .github/workflows/plugin-registry-validate.yml checked out the pull request
// and ran `node validate-plugin-registry.mjs` from that checkout. A PR that
// added one registry entry could also edit the validator (or any module it
// imports, such as plugins/_registry.mjs) so that it always exits 0, and the
// check would still go green. The "One plugin per PR" step did not see it: it
// counts files under plugins-registry/ only.
//
// The fix runs the validator from a second checkout of the BASE branch, with
// the PR's files as the working directory. The validator reads the registry
// from process.cwd() and imports its helpers relative to its own location, so
// the base copy validates the PR's data with the base copy's code.
//
// Two groups of cases:
//   1. The workflow wires that up and keeps its security posture. These fail
//      on the workflow as it was before #6010.
//   2. The validator really does behave the way (1) relies on: it validates the
//      directory it is run in, whichever copy of the code is running.
//
// Run:  node --test tests/plugin-registry-validate-workflow.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { ROOT } from './helpers.mjs';

const WORKFLOW = join(ROOT, '.github/workflows/plugin-registry-validate.yml');
const text = readFileSync(WORKFLOW, 'utf8');
const wf = load(text);
const steps = wf.jobs.validate.steps;

const checkouts = steps.filter(s => String(s.uses || '').startsWith('actions/checkout@'));
const runs = steps.filter(s => typeof s.run === 'string');

// ── 1. The workflow ──────────────────────────────────────────────────────

test('keeps its security posture: pull_request, contents: read, no secrets', () => {
  const triggers = Object.keys(wf.on || wf[true] || {});
  assert.deepEqual(triggers, ['pull_request'], 'must stay on pull_request, never pull_request_target');
  assert.deepEqual(wf.permissions, { contents: 'read' });
  assert.ok(!/\bsecrets\./.test(text), 'the job must not reference any secret');
  assert.ok(!/GITHUB_TOKEN/.test(text), 'the job must not hand the token to a step');
});

test('checks the base branch out beside the PR checkout', () => {
  const base = checkouts.filter(s => s.with && s.with.path === 'base');
  assert.equal(base.length, 1, 'exactly one checkout into base/');
  assert.equal(base[0].with.ref, '${{ github.base_ref }}', 'base/ must be the PR base branch');
  const pr = checkouts.filter(s => !(s.with && s.with.path));
  assert.equal(pr.length, 1, 'exactly one checkout of the PR into the workspace root');
  assert.ok(!pr[0].with || !pr[0].with.ref, 'the root checkout must stay the PR merge ref');
  // checkout cleans the workspace by default, so the root checkout must come
  // first or it would delete base/.
  assert.ok(steps.indexOf(pr[0]) < steps.indexOf(base[0]), 'checkout the PR first, then base/');
  // Nothing later in the job needs authenticated git, and the PR controls code
  // that runs here, so neither checkout may leave a token behind.
  for (const c of [pr[0], base[0]]) assert.equal(c.with && c.with['persist-credentials'], false, 'persist-credentials: false on every checkout');
});

test('runs the validator only from the base copy', () => {
  const invocations = runs.flatMap(s => s.run.split('\n')).filter(l => l.includes('validate-plugin-registry.mjs'));
  assert.ok(invocations.length >= 2, 'expected the shape run and the --deep run');
  for (const line of invocations) {
    assert.match(line.trim(), /^node base\/validate-plugin-registry\.mjs(\s|$)/, `must run the base copy: ${line.trim()}`);
  }
  assert.ok(invocations.some(l => l.includes('--deep')), 'the --deep run must also use the base copy');
});

test('runs nothing from the PR checkout', () => {
  for (const s of runs) {
    for (const line of s.run.split('\n')) {
      const t = line.trim();
      if (!/^(node|npm|npx|bash|sh|python3?)\b/.test(t)) continue;
      assert.match(t, /^node base\//, `only base/ code may run: ${t}`);
    }
  }
});

test('pins every action to a full commit SHA', () => {
  const uses = steps.map(s => s.uses).filter(Boolean);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `unpinned action: ${u}`);
});

// ── 2. The validator behaves as the workflow assumes ─────────────────────

const VALIDATOR = join(ROOT, 'validate-plugin-registry.mjs');

/** A stand-in for the PR checkout: the real registry, plus whatever the case adds. */
function prCheckout(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'co-registry-pr-'));
  cpSync(join(ROOT, 'plugins-registry'), join(dir, 'plugins-registry'), { recursive: true });
  if (mutate) mutate(dir);
  return dir;
}

const run = (cwd, script = VALIDATOR) => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });

test('the base validator accepts a valid PR registry', () => {
  const pr = prCheckout();
  try {
    const r = run(pr);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /plugin registry is valid/);
  } finally { rmSync(pr, { recursive: true, force: true }); }
});

test('the base validator rejects a bad entry in the PR registry', () => {
  const pr = prCheckout(dir => writeFileSync(join(dir, 'plugins-registry', 'evil.json'), JSON.stringify({ name: 'oops', id: 'evil' })));
  try {
    const r = run(pr);
    assert.equal(r.status, 1, 'the entry must be judged from the PR directory');
    assert.match(r.stderr, /oops/);
  } finally { rmSync(pr, { recursive: true, force: true }); }
});

test('a validator rewritten inside the PR is not the one that runs', () => {
  // The attack: the PR carries a validator that always passes. Running the base
  // copy against that directory must still reject the bad entry, and running the
  // PR's copy shows why that matters.
  const pr = prCheckout(dir => {
    writeFileSync(join(dir, 'plugins-registry', 'evil.json'), JSON.stringify({ name: 'oops', id: 'evil' }));
    writeFileSync(join(dir, 'validate-plugin-registry.mjs'), 'console.log("ok");\n');
  });
  try {
    assert.equal(run(pr, join(pr, 'validate-plugin-registry.mjs')).status, 0, 'the PR copy passes anything');
    assert.equal(run(pr, VALIDATOR).status, 1, 'the base copy still rejects the entry');
  } finally { rmSync(pr, { recursive: true, force: true }); }
});

test('a registry helper rewritten inside the PR is not the one that runs', () => {
  // Same attack one import down: the validator pulls plugins/_registry.mjs by a
  // path relative to itself, so the base copy of the validator loads the base
  // copy of the helper, whatever the PR put at plugins/_registry.mjs.
  const pr = prCheckout(dir => {
    writeFileSync(join(dir, 'plugins-registry', 'evil.json'), JSON.stringify({ name: 'oops', id: 'evil' }));
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'plugins', '_registry.mjs'),
      'export const loadRegistry = () => ({ registryVersion: 1, plugins: [] });\n' +
      'export const loadRegistryFiles = () => [];\n' +
      'export const validateRegistryEntry = () => [];\n');
  });
  try {
    const r = run(pr, VALIDATOR);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /oops/);
  } finally { rmSync(pr, { recursive: true, force: true }); }
});
