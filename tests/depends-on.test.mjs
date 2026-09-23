// Parser for the `Depends on` section of a PR body (#3880).
//
// The load-bearing case is the NEGATIVE one. "depends on" is ordinary English
// and appears mid-prose in most PR bodies in this repo; a parser that matches
// the phrase anywhere fires on bodies that declare no dependency at all, and a
// false positive here blocks a merge. So the anchor is strict: a heading, or
// the phrase at the start of a line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDependsOn, prFromQueueRef } from '../.github/scripts/depends-on.mjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

test('a `## Depends on` heading collects the refs beneath it', () => {
  assert.deepEqual(parseDependsOn('## Depends on\n\n#3513 — §2 lands with it.\n'), [3513]);
});

test('a `Depends on:` line collects the refs on that line', () => {
  assert.deepEqual(parseDependsOn('Depends on: #12, #34\n'), [12, 34]);
});

test('a line-initial bold `**Depends on #4076**` counts', () => {
  assert.deepEqual(parseDependsOn('**Depends on #4076** (it adds the field).\n'), [4076]);
});

test('a list item `- Depends on #7` counts', () => {
  assert.deepEqual(parseDependsOn('- Depends on #7\n'), [7]);
});

// This is the case that matters. Verbatim shapes taken from open PRs in this
// repo that declare NO dependency.
test('the phrase mid-sentence is prose and collects nothing', () => {
  const bodies = [
    'The flag would disable the very magic it depends on. See #3935 for context.\n',
    "`bodyAt`'s brace matching depends on it.\n\nCloses #3908\n",
    'It carries the one rule the whole design depends on.\n\nRefs #2185\n',
    'CI never depends on occ.com.mx being reachable. Fixes #3748\n',
  ];
  for (const b of bodies) assert.deepEqual(parseDependsOn(b), [], `prose matched: ${b.slice(0, 40)}`);
});

test('`Closes #N` alone collects nothing', () => {
  assert.deepEqual(parseDependsOn('Closes #123\n\n## Tests\n\nAll green.\n'), []);
});

test('the section ends at the next heading', () => {
  assert.deepEqual(parseDependsOn('## Depends on\n\n#1\n\n## Tests\n\n#2 is unrelated.\n'), [1]);
});

test('a fenced block is not the document', () => {
  assert.deepEqual(parseDependsOn('```\n## Depends on\n\n#99\n```\n'), []);
});

test('a code span is not a reference', () => {
  assert.deepEqual(parseDependsOn('## Depends on\n\n`#99` is the format. #1 is real.\n'), [1]);
});

test('repeats collapse and order is stable', () => {
  assert.deepEqual(parseDependsOn('## Depends on\n\n#5 and #3 and #5 again\n'), [5, 3]);
});

test('an empty or absent body collects nothing', () => {
  for (const b of [null, undefined, '', '   \n']) assert.deepEqual(parseDependsOn(b), []);
});

test('the heading match ignores case and depth', () => {
  assert.deepEqual(parseDependsOn('### DEPENDS ON\n\n#42\n'), [42]);
});

test('a merge-queue head_ref yields the PR number behind it', () => {
  assert.equal(prFromQueueRef('refs/heads/gh-readonly-queue/main/pr-4078-abc123'), 4078);
  assert.equal(prFromQueueRef('refs/heads/main'), null);
  assert.equal(prFromQueueRef(''), null);
  assert.equal(prFromQueueRef(undefined), null);
});

// #4078 writes it mid-paragraph, bolded. That is a live dependency (#4076 is open),
// so missing it defeats the check. A bold span carrying both the phrase and the ref
// is tight enough: across all ten open PRs whose body contains "depends on", it hits
// that one and nothing else.
test('a bold span carrying both the phrase and the ref counts anywhere', () => {
  const body = 'Reshaped after a compliance pass. **Depends on #4076** (it adds `externalId`).\n';
  assert.deepEqual(parseDependsOn(body), [4076]);
});

// The bound is per-line on purpose. Without it the span runs from one paragraph's
// closing `**` to the next paragraph's opening `**`, swallowing prose and an
// unrelated `#N` in between. That shape is real: it is what PR #2999's body does.
test('a bold span does not run across a blank line', () => {
  const body = [
    'Some emphasis **here** and the design depends on that.',
    '',
    'A later paragraph cites #2185 for unrelated reasons.',
    '',
    'And **more emphasis** closes it.',
  ].join('\n');
  assert.deepEqual(parseDependsOn(body), []);
});

// Without the ref inside the bold span, `**the design depends on this**` collects the
// whole line and any `#N` sharing it gets swept up.
test('a bold span without a ref inside it collects nothing', () => {
  assert.deepEqual(parseDependsOn('**The whole design depends on this**, and #2185 froze it.\n'), []);
});

test('a body listing its own number does not block itself', () => {
  assert.deepEqual(parseDependsOn('## Depends on\n\n#4078 and #4076\n', 4078), [4076]);
  assert.deepEqual(parseDependsOn('## Depends on\n\n#4078\n', 4078), []);
});

// The path the workflow runs (#3880).
//
// `.github/workflows/depends-on.yml` passes when the script is absent. That is
// correct on the PR introducing the check. It is correct again later: a required
// check whose implementation went missing should not redden every open PR.
//
// The cost is that absent and working look identical from outside. Rename the
// script, or edit the sparse-checkout path it arrives under, and the required
// check reports success on every PR in the repo. The ordering gate is off, and
// one log line nobody opens is the only signal.
//
// So the paths get pinned here. Every path below is read out of the workflow
// YAML. A test carrying its own copy stops tracking the workflow the day it
// moves, and pins nothing.
//
// The sweep reads every workflow, because the shape is not unique to this one.
// Four sibling jobs run a script out of a sparse checkout the same way. Their
// failure is loud, so they need no guard, and their paths cost nothing to pin
// while the parser is already open. The floor test asserts the sweep found
// something, so an extraction that quietly matches nothing cannot read as green.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/** `node <path>.mjs` inside a run block. */
const INVOKES = /\bnode\s+([^\s;&|)'"]+\.mjs)/g;
/** `[ ! -f <path>.mjs ]`, the absent-means-pass guard. */
const GUARDS = /\[\s*!\s*-f\s+([^\s\]]+\.mjs)\s*\]/g;

const paths = (re, text) => [...new Set([...text.matchAll(re)].map((m) => m[1]))].sort();

/**
 * Every workflow job, with the script paths its run steps name and the sparse
 * checkout those paths have to arrive under.
 * @returns {{file: string, job: string, sparse: string[], invoked: string[], guarded: string[]}[]}
 */
function workflowJobs() {
  const out = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/i.test(f))) {
    const doc = yaml.load(readFileSync(join(WORKFLOWS, file), 'utf-8'));
    for (const [job, spec] of Object.entries(doc?.jobs ?? {})) {
      const steps = spec?.steps ?? [];
      const sparse = steps.flatMap((s) => {
        const declared = s?.with?.['sparse-checkout'];
        const lines = Array.isArray(declared) ? declared : String(declared ?? '').split('\n');
        return lines.map((p) => p.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
      });
      // A step with its own working directory resolves its paths somewhere else.
      // This sweep reads repo-root-relative paths only.
      const run = steps.filter((s) => s?.run && !s['working-directory']).map((s) => s.run).join('\n');
      out.push({ file, job, sparse, invoked: paths(INVOKES, run), guarded: paths(GUARDS, run) });
    }
  }
  return out;
}

// Runs first on purpose. Every assertion below iterates what this sweep
// collected. An empty collection passes all of them without reading a byte of
// the workflow.
test('the workflow sweep finds paths to pin', () => {
  const jobs = workflowJobs();
  assert.ok(jobs.length > 0, 'no workflow jobs were read');
  assert.ok(jobs.some((j) => j.invoked.length), 'no run step invokes a script');
  assert.ok(jobs.some((j) => j.guarded.length), 'no absent-means-pass guard was found');
  assert.ok(jobs.some((j) => j.sparse.length), 'no sparse-checkout was found');
});

test('every script a workflow names is on disk', () => {
  for (const j of workflowJobs()) {
    for (const p of new Set([...j.invoked, ...j.guarded])) {
      assert.ok(existsSync(join(ROOT, p)), `${j.file} (${j.job}) names ${p}, which is not in the repo`);
    }
  }
});

// The guard decides whether the job runs at all. A guard reading one path while
// the step runs another passes the job whenever they disagree.
test('an absent-means-pass guard tests the path its job runs', () => {
  for (const j of workflowJobs()) {
    if (!j.guarded.length) continue;
    assert.deepEqual(j.guarded, j.invoked, `${j.file} (${j.job}) guards a different path than it runs`);
  }
});

// The script arrives through the sparse checkout. A sparse path that stops
// covering it makes it absent on every run, which the guard reads as a pass.
test('a sparse checkout covers every script its job names', () => {
  for (const j of workflowJobs()) {
    if (!j.sparse.length) continue;
    for (const p of new Set([...j.invoked, ...j.guarded])) {
      const covered = j.sparse.some((s) => p === s || p.startsWith(`${s}/`));
      assert.ok(covered, `${j.file} (${j.job}) runs ${p}, outside its sparse checkout (${j.sparse.join(', ')})`);
    }
  }
});
