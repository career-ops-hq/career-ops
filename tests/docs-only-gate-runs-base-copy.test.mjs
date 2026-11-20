// tests/docs-only-gate-runs-base-copy.test.mjs — the docs-only classifier must be
// the base branch's copy, never the PR's.
//
// `.github/workflows/test.yml` reads docs_only to skip four jobs and the macOS and
// Windows legs. Running the checkout's own copy means a PR can rewrite the
// classifier and skip its own checks on itself. Every other gate in this repo
// already guards against that by checking out the base branch next to the PR
// (`plugin-registry-validate.yml`, `employers-validate.yml`, `depends-on`), so
// this test pins the same invariant for the docs-only gate.
//
// The wiring lives in YAML, which no behavioural test loads, so this reads the
// workflow as text: it is a meta-guard, like tests/workflow-action-pins.test.mjs.
//
// Run:  node --test tests/docs-only-gate-runs-base-copy.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');

/** The `changes` job block, so the assertions cannot be satisfied by another job. */
function changesJob(text) {
  const start = text.indexOf('  changes:');
  assert.notEqual(start, -1, 'test.yml has no `changes` job');
  const end = text.indexOf('\n  test:', start);
  return text.slice(start, end === -1 ? undefined : end);
}

const job = changesJob(workflow);

test('the docs-only classifier runs from the base checkout, not the PR checkout', () => {
  assert.match(job, /run:\s*node base\/\.github\/scripts\/docs-only-change\.mjs/,
    'the classifier must be run from the base checkout');
  assert.doesNotMatch(job, /run:\s*node \.github\/scripts\/docs-only-change\.mjs/,
    'the PR-editable copy must not decide whether the PR can skip its own checks');
});

test('the base checkout exists and is pinned to the base of the change', () => {
  assert.match(job, /path:\s*base/, 'no base checkout in the `changes` job');
  assert.match(job, /ref:\s*\$\{\{\s*github\.base_ref \|\| github\.event\.merge_group\.base_sha\s*\}\}/,
    'the base checkout must resolve for both pull_request and merge_group events');
});

test('the base checkout does not keep a token', () => {
  // Fork PRs run this workflow; a token in .git/config is reachable by the code
  // the PR added, and this job needs no write access at all.
  const baseStep = job.slice(job.indexOf('path: base') - 600, job.indexOf('id: classify'));
  assert.match(baseStep, /persist-credentials:\s*false/,
    'the base checkout must set persist-credentials: false');
});