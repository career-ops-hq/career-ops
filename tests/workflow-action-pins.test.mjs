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

// The executed commands of a `run:` script, one per entry: shell comments
// dropped, and each line split at `&&`, `||`, `;` and `|`. A version that
// only appears in a comment, or an earlier command on the line, must not
// stand in for the one that runs.
function commands(run) {
  return run.split('\n')
    .map(line => line.replace(/(^|\s)#.*$/, ''))
    .flatMap(line => line.split(/&&|\|\||;|\|/))
    .map(cmd => cmd.trim())
    .filter(Boolean);
}

// npm's own names for `install` (npm help install lists the aliases).
const NPM_INSTALL = new Set(['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal',
  'isnt', 'isnta', 'isntal', 'isntall', 'add']);
// Options that make npm print and exit before it runs any subcommand.
const NPM_EXITS_EARLY = new Set(['-v', '--version', '-h', '--help', '--usage', '-?']);

// Each global install of npm itself in `run`, as the version spec it names:
// '' for a bare `npm`, which installs latest. `-g` and `--global` both count,
// in any position, and options may come before the subcommand
// (`npm --no-fund install -g npm@latest`).
function npmSelfInstalls(run) {
  const specs = [];
  for (const cmd of commands(run)) {
    const tokens = cmd.split(/\s+/).map(t => t.replace(/^['"]|['"]$/g, ''));
    const at = tokens.indexOf('npm');
    if (at === -1) continue;
    let sub = at + 1;
    while (sub < tokens.length && tokens[sub].startsWith('-')) sub++;
    if (tokens.slice(at + 1, sub).some(t => NPM_EXITS_EARLY.has(t))) continue;
    if (!NPM_INSTALL.has(tokens[sub])) continue;
    const args = [...tokens.slice(at + 1, sub), ...tokens.slice(sub + 1)];
    if (!args.includes('-g') && !args.includes('--global')) continue;
    for (const arg of args) {
      if (arg === 'npm') specs.push('');
      else if (arg.startsWith('npm@')) specs.push(arg.slice(4));
    }
  }
  return specs;
}

const runsNpmPublish = run => commands(run).some(cmd => /(^|\s)npm\s+publish\b/.test(cmd));

function exactAtLeast(spec, [wantMaj, wantMin, wantPat]) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (!m) return false;
  const [maj, min, pat] = m.slice(1).map(Number);
  if (maj !== wantMaj) return maj > wantMaj;
  if (min !== wantMin) return min > wantMin;
  return pat >= wantPat;
}

test('npmSelfInstalls reads only the commands that run', () => {
  assert.deepEqual(npmSelfInstalls('npm install -g npm@12.2.2'), ['12.2.2']);
  assert.deepEqual(npmSelfInstalls('npm i --global npm@latest'), ['latest']);
  assert.deepEqual(npmSelfInstalls('npm install -g npm'), ['']);
  assert.deepEqual(npmSelfInstalls('npm install --global "npm@11.5.1"'), ['11.5.1']);
  assert.deepEqual(npmSelfInstalls('# was npm install -g npm@12.2.2\nnpm install -g npm@latest'), ['latest']);
  assert.deepEqual(npmSelfInstalls('echo npm@12.2.2 && npm install -g npm@latest'), ['latest']);
  assert.deepEqual(npmSelfInstalls('npm install npm@latest'), [], 'a local install is not a global upgrade');
  assert.deepEqual(npmSelfInstalls('npm install -g pnpm@9'), []);
  assert.deepEqual(npmSelfInstalls('npm --no-fund install -g npm@latest'), ['latest'], 'an option before the subcommand');
  assert.deepEqual(npmSelfInstalls('npm -g --no-audit i npm@latest'), ['latest'], '-g before the subcommand');
  assert.deepEqual(npmSelfInstalls('npm inst -g npm@latest'), ['latest'], 'an install alias');
  assert.deepEqual(npmSelfInstalls('npm --version install -g npm@latest'), [], 'npm exits before the subcommand');
});

test('exactAtLeast accepts only an exact version at or above the floor', () => {
  const floor = [11, 5, 1];
  for (const ok of ['11.5.1', '11.6.0', '12.0.0', '12.2.2']) assert.ok(exactAtLeast(ok, floor), ok);
  for (const bad of ['11.5.0', '10.9.9', 'latest', '', '12', '^12.2.2', '12.2.2-pre.1']) assert.ok(!exactAtLeast(bad, floor), bad);
});

test('release.yml upgrades to an exact npm, at least 11.5.1, before it publishes', () => {
  const wf = load(readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8'));
  let publishes = 0;
  for (const [name, job] of Object.entries(wf.jobs)) {
    const steps = job.steps || [];
    const runs = steps.map(step => (typeof step.run === 'string' ? step.run : ''));
    // Every global npm install in the job, before or after the publish, names
    // an exact version: this job runs with id-token: write throughout.
    for (const spec of runs.flatMap(npmSelfInstalls)) {
      assert.ok(exactAtLeast(spec, [11, 5, 1]),
        `job ${name}: npm@${spec || '(bare, i.e. latest)'} must be an exact version of at least 11.5.1, the Trusted Publishing minimum`);
    }
    const publishAt = runs.findIndex(runsNpmPublish);
    if (publishAt === -1) continue;
    publishes++;
    const before = runs.slice(0, publishAt).flatMap(npmSelfInstalls);
    assert.ok(before.length >= 1, `job ${name}: no npm upgrade before the publish step, and setup-node's npm is too old for Trusted Publishing`);
  }
  assert.ok(publishes >= 1, 'release.yml no longer runs npm publish; update this test with it');
});
