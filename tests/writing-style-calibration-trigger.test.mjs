// tests/writing-style-calibration-trigger.test.mjs — modes/cover.md and
// modes/email.md carry the Writing Style calibration trigger (#5956).
//
// Reading modes/_writing.md loads a conditional ("no cached style: scan the
// samples, write back") that no step owns unless the mode says so. The
// trigger is one sentence, so it is matched as one block. Separate keyword
// tests pass when "writing-samples/" and "calibration" appear in unrelated
// text while the guard, the non-README.md condition, the write-back to
// modes/_profile.md or the "before drafting" ordering is gone.
//
// Run:  node --test tests/writing-style-calibration-trigger.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITING_CONSUMERS = ['modes/cover.md', 'modes/email.md'];
const readFile = (path) => readFileSync(join(ROOT, path), 'utf8');

const hasCalibrationTrigger = (src) =>
  /If `modes\/_profile\.md` has no `## Writing Style` section and `writing-samples\/` holds a file other than `README\.md`, run the Writing Style calibration in `modes\/_writing\.md`(?: now)? and write (?:the result|it) to `modes\/_profile\.md` before drafting/.test(src);

test('trigger predicate rejects scattered keywords', () => {
  const scattered = [
    '## Writing Style',
    'Samples live in `writing-samples/`.',
    'See the calibration notes elsewhere.',
  ].join('\n');
  assert.equal(hasCalibrationTrigger(scattered), false);
});

test('trigger predicate rejects a write-back to bare _profile.md', () => {
  const bare = readFile('modes/cover.md')
    .replace('write the result to `modes/_profile.md`', 'write the result to `_profile.md`');
  assert.equal(hasCalibrationTrigger(bare), false);
});

for (const path of WRITING_CONSUMERS) {
  test(`${path} triggers Writing Style calibration when samples exist and no cached style`, () => {
    assert.equal(hasCalibrationTrigger(readFile(path)), true);
  });
}
