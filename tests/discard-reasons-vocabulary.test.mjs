// templates/discard-reasons.yml is the discard-reason vocabulary (#2785). Two
// surfaces restate its ids by hand: the batch prompt that tells evaluators what
// to write, and the dashboard picker's fallback options. Pin both to the file
// so adding or renaming an id cannot leave either one behind.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { pass, fail, ROOT, rmSync } from './helpers.mjs';
import { loadDiscardReasonVocabulary } from '../analyze-patterns.mjs';

console.log('\ndiscard-reasons vocabulary: one list, restated consistently');

function check(name, fn) {
  try { fn(); pass(name); }
  catch (error) { fail(`${name}: ${error.message}`); }
}

const file = join(ROOT, 'templates', 'discard-reasons.yml');
const reasons = yamlLoad(readFileSync(file, 'utf8')).reasons;
const ids = reasons.map(reason => reason.id);

check('every entry has a snake_case id, a label and a when-to-use line, with no duplicates', () => {
  for (const reason of reasons) {
    assert.match(reason.id, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, `id ${reason.id}`);
    assert.equal(typeof reason.label, 'string');
    assert.equal(typeof reason.when, 'string');
  }
  assert.equal(new Set(ids).size, ids.length);
  // `other` is the escape for labels outside the list, never a member of it.
  assert.ok(!ids.includes('other'));
});

check('analyze-patterns loads exactly the ids in the file', () => {
  assert.deepEqual([...loadDiscardReasonVocabulary()].sort(), [...ids].sort());
});

check('a missing, malformed or empty vocabulary loads as null rather than throwing', () => {
  const work = mkdtempSync(join(tmpdir(), 'cops-discard-vocab-'));
  try {
    assert.equal(loadDiscardReasonVocabulary(join(work, 'absent.yml')), null);
    writeFileSync(join(work, 'bad.yml'), 'reasons: [unterminated');
    assert.equal(loadDiscardReasonVocabulary(join(work, 'bad.yml')), null);
    writeFileSync(join(work, 'empty.yml'), 'reasons: []\n');
    assert.equal(loadDiscardReasonVocabulary(join(work, 'empty.yml')), null);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

check('the batch prompt lists the same ids in the same order', () => {
  const prompt = readFileSync(join(ROOT, 'batch', 'batch-prompt.md'), 'utf8');
  const rule = prompt.match(/^- `discard_reasons` items are canonical ids from `templates\/discard-reasons\.yml`: (.+?)\. Read that file/m);
  assert.ok(rule, 'discard_reasons rule not found in batch/batch-prompt.md');
  assert.deepEqual([...rule[1].matchAll(/`([^`]+)`/g)].map(match => match[1]), ids);
});

check('the dashboard picker offers the same ids in the same order', () => {
  const pipeline = readFileSync(join(ROOT, 'dashboard', 'internal', 'ui', 'screens', 'pipeline.go'), 'utf8');
  const block = pipeline.match(/var canonicalDiscardReasons = \[\]string\{([\s\S]*?)\}/);
  assert.ok(block, 'canonicalDiscardReasons not found in pipeline.go');
  assert.deepEqual([...block[1].matchAll(/"([^"]+)"/g)].map(match => match[1]), ids);
});
