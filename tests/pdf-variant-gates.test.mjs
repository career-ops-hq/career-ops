// tests/pdf-variant-gates.test.mjs — every fact gate a content-variant run
// uses reads cv.md only, as modes/pdf.md spells it out (#6792).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PDF_MODE = readFileSync(join(ROOT, 'modes', 'pdf.md'), 'utf-8').replace(/\r\n/g, '\n');

// Step 21a runs from its own number up to Step 22.
const STEP_21A = PDF_MODE.match(/^21a\. [\s\S]*?(?=^22\. )/m)?.[0] ?? '';

test('in a variant run the ATS gate uses cv.md as its only fact source, as Step 19 does (#6792)', () => {
  const gate = STEP_21A.split('\n').find((l) => l.includes('Gate it:')) ?? '';
  assert.match(gate, /variant run[^.]*`--source cv\.md --strict-source`/,
    'without it, a claim only article-digest.md backs is cut from the styled HTML but passes the ATS gate');
});

test('every variant fact gate in modes/pdf.md carries --strict-source (#6792)', () => {
  const lines = PDF_MODE.split('\n')
    .filter((l) => /--source cv\.md/.test(l));
  assert.equal(lines.length, 3);
  for (const l of lines) assert.match(l, /--source cv\.md --strict-source/);
});

test('variant gate commands resolve cv.md and the variant from the data root (#6792)', () => {
  const gates = PDF_MODE.split('\n').flatMap(l => l.match(/--source \S+ --strict-source/g) ?? []);
  assert.ok(gates.length >= 3);
  for (const g of gates) assert.match(g, /--source \{DATA_ROOT\}\/cv\.md /);
  assert.doesNotMatch(PDF_MODE, /(?<!\{DATA_ROOT\}\/)data\/cv-variants\/<name>\.md/);
});
