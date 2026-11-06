// tests/workflow-action-pins.test.mjs: every GitHub Action this repository
// runs is pinned to a full commit SHA, and the release job installs an exact
// npm (#6266).
//
// A tag such as `actions/checkout@v7` can be moved to any commit by whoever
// controls that action's repository, so a tagged action runs whatever the tag
// points to on the day the workflow runs. The SHA pins in .github/workflows/
// used to come from Renovate's `pinDigests: true`, which stopped when Renovate
// was retired (#4899). By then 42 of 68 refs were back on tags, including the
// release-please and npm publish job and the SBOM job, which have write access.
// #6437 and #6287 pinned them again. This file keeps them pinned: nothing else
// does any more.
//
// Dependabot's `github-actions` updater still moves the pins forward, SHA and
// trailing `# vX.Y.Z` comment together, so a pin is not a frozen version.
//
// What counts as a ref: every `uses:` value anywhere in a tracked workflow or
// composite action file, found by walking the parsed YAML, not by grepping
// lines. A step `uses:`, a job-level reusable-workflow `uses:`, and one nested
// under a matrix or an anchor are all reached the same way.
//
// Two forms are exempt, because neither names a commit someone else can move:
//   ./path        a local action or workflow in this repository
//   docker://...  a container image, which a SHA cannot pin
//
// Run:  node --test tests/workflow-action-pins.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { load } from 'js-yaml';
import { ROOT } from './helpers.mjs';
import { trackedFiles } from '../lib/mjs-files.mjs';

const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;

// Returns why `ref` is unacceptable, or null when it is pinned or exempt.
function pinProblem(ref) {
  if (typeof ref !== 'string') return 'is not a string';
  if (ref.startsWith('./')) return null;
  if (ref.startsWith('docker://')) return null;
  if (PINNED.test(ref)) return null;
  if (!ref.includes('@')) return 'has no @ref';
  return 'is not pinned to a full 40-character commit SHA';
}

function collectUses(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectUses(item, out);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uses') out.push(value);
      else collectUses(value, out);
    }
  }
  return out;
}

const isWorkflowFile = (p) =>
  /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) || /(^|\/)action\.ya?ml$/.test(p);

// trackedFiles reads the git index, so a new workflow is checked from the
// commit that adds it. It returns absolute paths; the rules use relative ones.
const files = trackedFiles(ROOT, p => isWorkflowFile(p.split(sep).join('/')))
  .map(abs => relative(ROOT, abs).split(sep).join('/'))
  .sort();

test('the predicate accepts SHA pins and the exempt forms', () => {
  const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
  assert.equal(pinProblem(`actions/checkout@${sha}`), null);
  assert.equal(pinProblem(`github/codeql-action/init@${sha}`), null);
  assert.equal(pinProblem(`org/repo/.github/workflows/ci.yml@${sha}`), null);
  assert.equal(pinProblem('./.github/actions/setup'), null);
  assert.equal(pinProblem('docker://alpine:3.20'), null);
});

test('the predicate rejects tags, branches and short or malformed SHAs', () => {
  for (const ref of [
    'actions/checkout@v7',
    'actions/dependency-review-action@v5.0.0', // a full version is still a tag
    'actions/checkout@main',
    'actions/checkout@3d3c42e',
    'actions/checkout@3D3C42E5AAC5BA805825DA76410C181273BA90B1',
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 ',
    'actions/checkout',
  ]) {
    assert.notEqual(pinProblem(ref), null, `${ref} must be rejected`);
  }
});

test('finds the workflow files it is meant to check', () => {
  assert.ok(files.includes('.github/workflows/release.yml'), 'release.yml must be scanned');
  assert.ok(files.includes('.github/workflows/sbom.yml'), 'sbom.yml must be scanned');
  assert.ok(files.length >= 20, `expected 20+ workflow files, found ${files.length}`);
});

test('every uses: ref is pinned to a commit SHA with a version comment', () => {
  const problems = [];
  let refs = 0;
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const ref of collectUses(load(text))) {
      refs++;
      const why = pinProblem(ref);
      if (why) problems.push(`${file}: ${ref} ${why}`);
    }
    // Dependabot updates the `# vX.Y.Z` comment along with the SHA. Without it
    // a reader cannot tell which release a pin is, short of looking it up.
    text.split('\n').forEach((line, i) => {
      if (/^\s*(-\s*)?uses:\s*['"]?[\w.-]+\/[^@\s]+@[0-9a-f]{40}/.test(line) && !/#\s*v\d/.test(line)) {
        problems.push(`${file}:${i + 1}: SHA pin has no trailing "# vX.Y.Z" comment`);
      }
    });
  }
  assert.ok(refs >= 50, `expected 50+ uses: refs, found ${refs}; is the walk still reaching them?`);
  assert.deepEqual(problems, [], `pin these to the commit of their current release, with a # vX.Y.Z comment:\n  ${problems.join('\n  ')}`);
});

test('release.yml installs an exact npm, at least the Trusted Publishing minimum', () => {
  const wf = load(readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8'));
  const installs = Object.values(wf.jobs)
    .flatMap(job => job.steps || [])
    .map(step => step.run)
    .filter(run => typeof run === 'string' && /\bnpm\s+(install|i)\s+-g\s+npm@/.test(run));
  assert.ok(installs.length >= 1, 'release.yml no longer upgrades npm before publishing');
  for (const run of installs) {
    const m = run.match(/npm@(\S+)/);
    assert.match(m[1], /^\d+\.\d+\.\d+$/, `npm@${m[1]} is not an exact version: the step runs with id-token: write`);
    const [maj, min, pat] = m[1].split('.').map(Number);
    const atLeast = maj > 11 || (maj === 11 && (min > 5 || (min === 5 && pat >= 1)));
    assert.ok(atLeast, `npm@${m[1]} is below 11.5.1, the minimum for Trusted Publishing`);
  }
});
