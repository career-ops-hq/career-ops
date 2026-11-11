// tests/employers-validate-workflow.test.mjs: the employer registry gate must
// not run code that a registry PR is allowed to change.
//
// .github/workflows/employers-validate.yml follows plugin-registry-validate.yml
// (#6010): it checks the BASE branch out next to the PR and runs the base copy
// of seeds/employers-validate.mjs against the PR's files. The one exception is
// the bootstrap: in the PR that adds the validator, the base has none, so that
// PR's own copy runs. These cases pin both halves.
//
// Run:  node --test tests/employers-validate-workflow.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { ROOT } from './helpers.mjs';

const WORKFLOW = join(ROOT, '.github/workflows/employers-validate.yml');
const text = readFileSync(WORKFLOW, 'utf8');
const wf = load(text);
const steps = wf.jobs.validate.steps;
const checkouts = steps.filter((s) => String(s.uses || '').startsWith('actions/checkout@'));
const runs = steps.filter((s) => typeof s.run === 'string');
const BASE_HAS_VALIDATOR = "hashFiles('base/seeds/employers-validate.mjs') != ''";
const BASE_LACKS_VALIDATOR = "hashFiles('base/seeds/employers-validate.mjs') == ''";
// The inbox-only check runs after the validation whatever its result, so its
// guard also says !cancelled().
const BASE_HAS_INBOX = "${{ !cancelled() && hashFiles('base/seeds/employers-inbox.mjs') != '' }}";
const BASE_LACKS_INBOX = "${{ !cancelled() && hashFiles('base/seeds/employers-inbox.mjs') == '' }}";

// ── The workflow ─────────────────────────────────────────────────────────

test('keeps its security posture: pull_request, contents: read, no secrets', () => {
  const triggers = Object.keys(wf.on || wf[true] || {});
  assert.deepEqual(triggers, ['pull_request'], 'must stay on pull_request, never pull_request_target');
  assert.deepEqual(wf.permissions, { contents: 'read' });
  assert.ok(!/\bsecrets\./.test(text), 'the job must not reference any secret');
  assert.ok(!/GITHUB_TOKEN/.test(text), 'the job must not hand the token to a step');
});

test('runs when the registry, the validator, its inbox rules or the URL builder changes', () => {
  const paths = (wf.on || wf[true]).pull_request.paths;
  for (const p of ['employers/**', 'seeds/employers-validate.mjs', 'seeds/employers-inbox.mjs', 'lib/ats-board-url.mjs']) {
    assert.ok(paths.includes(p), `paths must include ${p}`);
  }
});

test('checks the base branch out beside the PR checkout', () => {
  const base = checkouts.filter((s) => s.with && s.with.path === 'base');
  assert.equal(base.length, 1, 'exactly one checkout into base/');
  assert.equal(base[0].with.ref, '${{ github.base_ref }}', 'base/ must be the PR base branch');
  const pr = checkouts.filter((s) => !(s.with && s.with.path));
  assert.equal(pr.length, 1, 'exactly one checkout of the PR into the workspace root');
  assert.ok(!pr[0].with || !pr[0].with.ref, 'the root checkout must stay the PR merge ref');
  assert.ok(steps.indexOf(pr[0]) < steps.indexOf(base[0]), 'checkout the PR first, then base/');
  for (const c of [pr[0], base[0]]) assert.equal(c.with && c.with['persist-credentials'], false, 'persist-credentials: false on every checkout');
});

test('runs the base copy of the validator, and the PR copy only when the base has none', () => {
  const commands = runs.flatMap((s) => s.run.split('\n').map((l) => ({ step: s, line: l.trim() }))).filter((c) => c.line);
  const expected = new Map([
    ['node base/seeds/employers-validate.mjs --base base', BASE_HAS_VALIDATOR],
    ['node seeds/employers-validate.mjs --base base', BASE_LACKS_VALIDATOR],
    ['node base/seeds/employers-validate.mjs --inbox-only --base HEAD^1', BASE_HAS_INBOX],
    ['node seeds/employers-validate.mjs --inbox-only --base HEAD^1', BASE_LACKS_INBOX],
  ]);
  assert.equal(commands.length, expected.size, 'four commands: validation and inbox-only check, each from the base or as bootstrap');
  for (const { step, line } of commands) {
    assert.ok(expected.has(line), `unexpected command: ${line}`);
    assert.equal(step.if, expected.get(line), `${line}: the PR copy runs only when the base has none`);
  }
  // Every step that runs code is one of those four, each in its own step.
  assert.equal(runs.length, expected.size);
  assert.ok(!/npm |npx /.test(text), 'the gate installs nothing');
});

test('the inbox-only check reads the diff from the merge commit and exposes its answer', () => {
  const pr = checkouts.find((s) => !(s.with && s.with.path));
  assert.equal(pr.with['fetch-depth'], 2, 'HEAD^1 (the base tip) must be in the PR checkout');
  const ids = runs.filter((s) => / --inbox-only /.test(s.run)).map((s) => s.id).sort();
  assert.deepEqual(ids, ['inbox_only', 'inbox_only_bootstrap']);
  assert.equal(wf.jobs.validate.outputs.inbox_only,
    '${{ steps.inbox_only.outputs.inbox_only || steps.inbox_only_bootstrap.outputs.inbox_only }}');
  // It reports; it does not act. No label, merge, comment or write permission.
  assert.ok(!/gh |labels|merge|issues: write|pull-requests: write/.test(text.replace(/^\s*#.*$/gm, '')), 'the workflow must not act on the answer');
});

test('pins every action to a full commit SHA', () => {
  const uses = steps.map((s) => s.uses).filter(Boolean);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `unpinned action: ${u}`);
});

// ── The validator behaves as the workflow assumes ─────────────────────────

const VALIDATOR = join(ROOT, 'seeds', 'employers-validate.mjs');
// Plain output whatever runs the suite: in GitHub Actions the validator prints
// workflow commands instead (tests/employers-registry.test.mjs covers those).
const { GITHUB_ACTIONS: _ga, GITHUB_STEP_SUMMARY: _gss, ...PLAIN_ENV } = process.env;
const run = (cwd, script = VALIDATOR, args = []) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: PLAIN_ENV });

/** A stand-in for the PR checkout: the real registry plus whatever the case adds. */
function prCheckout(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'co-employers-pr-'));
  cpSync(join(ROOT, 'employers'), join(dir, 'employers'), { recursive: true });
  if (mutate) mutate(dir);
  return dir;
}
const plantBadRow = (dir) => writeFileSync(join(dir, 'employers/boards/greenhouse/z.ndjson'), '{"ats":"greenhouse","board":"oops"}\n');

test('the base validator accepts the PR registry it is run in', () => {
  const pr = prCheckout();
  try {
    const r = run(pr, VALIDATOR, ['--base', ROOT]);
    assert.equal(r.status, 0, r.stderr);
  } finally { rmSync(pr, { recursive: true, force: true }); }
});

test('the base validator judges the PR directory it is run in', () => {
  const pr = prCheckout(plantBadRow);
  try {
    const r = run(pr, VALIDATOR, ['--base', ROOT]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /boards\/greenhouse\/z\.ndjson:1: /);
  } finally { rmSync(pr, { recursive: true, force: true }); }
});

test('a validator rewritten inside the PR is not the one that runs', () => {
  const pr = prCheckout((dir) => {
    plantBadRow(dir);
    mkdirSync(join(dir, 'seeds'), { recursive: true });
    writeFileSync(join(dir, 'seeds', 'employers-validate.mjs'), 'console.log("ok");\n');
  });
  try {
    assert.equal(run(pr, join(pr, 'seeds', 'employers-validate.mjs')).status, 0, 'the PR copy passes anything');
    assert.equal(run(pr, VALIDATOR, ['--base', ROOT]).status, 1, 'the base copy still rejects the row');
  } finally { rmSync(pr, { recursive: true, force: true }); }
});
