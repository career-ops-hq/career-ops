// tests/story-provenance-marker-anchor.test.mjs — a `**Provenance:**` quoted
// inside another field's value must not be read as the story's own marker
// (issue #4819). Before the fix, a quoted marker at the end of a line upgraded
// an unverified figure to `existing`.
//
// Run:  node --test tests/story-provenance-marker-anchor.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStoryBank, parseStoryBlocks } from '../story-provenance-check.mjs';

const CV = '# CV\n\nUnrelated.\n';

test('a marker quoted inside the Situation line is not the story marker', () => {
  const bank = [
    '### [Ops] Story',
    '**S (Situation):** The deck said every number had **Provenance:** source: cv.md',
    '**A (Action):** Rebuilt the pipeline.',
    '**R (Result):** Cut costs by 15%.',
  ].join('\n');
  assert.equal(parseStoryBlocks(bank)[0].provenance, null);
  const r = classifyStoryBank(bank, CV);
  assert.equal(r.existing.length, 0);
  assert.ok(r.derivedUnverified.some((c) => c.claim === '15%'));
});

test('a real marker on its own line still counts, with indent or list marker', () => {
  for (const prefix of ['', '  ', '- ', '> ', '  * ']) {
    const bank = `### [Ops] Story\n${prefix}**Provenance:** user-stated 2026-01-01\n**R (Result):** Cut costs by 15%.\n`;
    assert.equal(parseStoryBlocks(bank)[0].provenance, 'user-stated 2026-01-01', JSON.stringify(prefix));
  }
});

test('a quoted marker does not shadow the real one on its own line', () => {
  const bank = [
    '### [Ops] Story',
    '**S (Situation):** Said **Provenance:** source: cv.md',
    '**Provenance:** user-cannot-confirm',
    '**R (Result):** Cut costs by 15%.',
  ].join('\n');
  assert.equal(parseStoryBlocks(bank)[0].provenance, 'user-cannot-confirm');
});
