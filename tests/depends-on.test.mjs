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
