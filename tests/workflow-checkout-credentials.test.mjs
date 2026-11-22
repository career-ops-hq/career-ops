// tests/workflow-checkout-credentials.test.mjs — a checkout keeps the token only
// when the job actually pushes with it.
//
// `actions/checkout` leaves the job's token in `.git/config`, where any code the
// job runs can read it. For a `pull_request` workflow that is fork code, and for
// every other workflow it is unnecessary exposure: nine steps still did it, and
// only the ones that push over git need to.
//
// The rule is deny-by-default with a named exception: a checkout must set
// `persist-credentials: false` unless its workflow is listed below as a pusher.
// Listing a workflow is a claim that it pushes — the second test fails when that
// claim stops being true, so the exception cannot quietly outlive its reason.
//
// Run:  node --test tests/workflow-checkout-credentials.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { load } from 'js-yaml';
import { ROOT } from './helpers.mjs';
import { trackedFiles } from '../lib/mjs-files.mjs';

/** Workflows that write to the repository over git, so git needs the token. */
const PUSHES = new Map([
  ['readme-badges.yml', 'commits the regenerated badge SVG/count back to main'],
  ['hired-wall.yml', 'commits the regenerated hired wall back to main'],
]);

// How a workflow writes to the repository. `git push` has to be a live line in a
// run script: `^(?!\s*#)` keeps a commented-out push, or a mention of one in a
// shell comment, from keeping an exemption alive.
const HOW_IT_PUSHES = [
  /^(?!\s*#).*\bgit push\b/m,
  /create-pull-request/,
  /git-auto-commit-action/,
  /peter-evans/,
];

/** Does any run script in this workflow actually push? */
const pushesFrom = (scripts) => HOW_IT_PUSHES.some((re) => re.test(scripts));

// trackedFiles reads the git index and returns absolute paths, so a workflow is
// checked from the commit that adds it; the rules use the basename.
const workflowFiles = trackedFiles(ROOT, (p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p.split(sep).join('/')));

/** Every `uses: actions/checkout` step in a parsed workflow, with its inputs. */
function checkoutSteps(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) checkoutSteps(item, out);
  } else if (node && typeof node === 'object') {
    if (typeof node.uses === 'string' && node.uses.startsWith('actions/checkout')) {
      out.push(node);
    }
    for (const value of Object.values(node)) checkoutSteps(value, out);
  }
  return out;
}

/** Every `run:` script in a parsed workflow, joined into one string. */
function runScripts(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) runScripts(item, out);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'run' && typeof value === 'string') out.push(value);
      else runScripts(value, out);
    }
  }
  return out;
}

test('every checkout keeps the token out of .git/config unless its job pushes', () => {
  const offenders = [];
  for (const abs of workflowFiles) {
    const name = abs.split(sep).pop();
    const text = readFileSync(abs, 'utf8');
    const steps = checkoutSteps(load(text));
    for (const step of steps) {
      const persisted = step.with?.['persist-credentials'];
      if (persisted === false) continue;
      if (PUSHES.has(name)) continue;
      offenders.push(`${name}: ${step.name || step.uses}`);
    }
  }
  assert.deepEqual(offenders, [],
    `these checkouts keep the token and their workflow does not push: ${offenders.join(', ')}`);
});

test('an exempted workflow still pushes, so the exemption is still earned', () => {
  for (const [name, why] of PUSHES) {
    const file = `.github/workflows/${name}`;
    // Only the executable steps count. Matching the file as text let a comment
    // that merely mentions `git push` keep an exemption alive, which is exactly
    // the drift this second test exists to catch.
    const scripts = runScripts(load(readFileSync(join(ROOT, file), 'utf8'))).join('\n');
    assert.ok(pushesFrom(scripts),
      `${file} is exempt from persist-credentials: false because it ${why}, but no run step in it pushes any more`);
  }
});