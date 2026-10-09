import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoryBlocks, classifyStoryBank } from '../story-provenance-check.mjs';

function story(marker, newline = '\n') {
  return ['### [Delivery] Fictional migration', marker, '**Result:** Reduced latency by 37%.'].join(newline);
}

for (const newline of ['\n', '\r\n']) {
  for (const whitespace of ['', ' ', '\t']) {
    test(`empty provenance stays unverified (${JSON.stringify({ newline, whitespace })})`, () => {
      const text = story(`**Provenance:**${whitespace}${newline}${newline}source: cv.md`, newline);
      assert.equal(parseStoryBlocks(text)[0].provenance, null);
      const buckets = classifyStoryBank(text, '');
      assert.equal(buckets.existing.length, 0);
      assert.deepEqual(buckets.derivedUnverified.map(c => c.claim), ['37%']);
    });
  }
}

for (const marker of ['source: cv.md', 'user-stated 2026-09-22']) {
  test(`explicit inline ${marker} still verifies a claim`, () => {
    const text = story(`**Provenance:** \t${marker}  `, '\r\n');
    assert.equal(parseStoryBlocks(text)[0].provenance, marker);
    assert.equal(classifyStoryBank(text, '').existing.length, 1);
  });
}

test('cannot-confirm and absent markers preserve their buckets', () => {
  assert.equal(classifyStoryBank(story('**Provenance:** user-cannot-confirm'), '').userCannotConfirm.length, 1);
  assert.equal(classifyStoryBank(story(''), '').derivedUnverified.length, 1);
});

for (const newline of ['\n', '\r\n']) {
  test(`a wrapped cannot-confirm denial remains durable (${JSON.stringify(newline)})`, () => {
    const text = story(`**Provenance:**${newline}${newline}user-cannot-confirm`, newline);
    assert.equal(parseStoryBlocks(text)[0].provenance, 'user-cannot-confirm');
    for (const cv of ['', 'Reduced latency by 37%.']) {
      const buckets = classifyStoryBank(text, cv);
      assert.equal(buckets.userCannotConfirm.length, 1);
      assert.equal(buckets.existing.length, 0);
      assert.equal(buckets.derivedUnverified.length, 0);
    }
  });
}

test('wrapped positive declarations remain unverified', () => {
  const text = story('**Provenance:**\nuser-stated 2026-09-22');
  assert.equal(classifyStoryBank(text, '').existing.length, 0);
  assert.equal(classifyStoryBank(text, '').derivedUnverified.length, 1);
});
