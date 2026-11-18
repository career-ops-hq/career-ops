// tests/verify-cv-facts-structured-field-layouts.test.mjs — the fact gate must
// read the structured CV fields whatever element renders them.
//
// `structuredFieldClaims()` keys on the class (`job-company`, `edu-title`, …), so
// the element and the quote style are presentation. It read only
// `<span|div class="…">`, which meant a template using `<td>`, `<li>`, `<p>` or
// single quotes produced ZERO claims — and zero claims reads as "nothing to check",
// so the gate passed silently on exactly the CVs it exists to vet.
//
// Run:  node --test tests/verify-cv-facts-structured-field-layouts.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { structuredFieldClaims } = await import(pathToFileURL(join(ROOT, 'verify-cv-facts.mjs')).href);

const kinds = (html) => structuredFieldClaims(html).map((c) => `${c.kind}:${c.value}`);

test('a table cell renders an employer claim', () => {
  assert.deepEqual(kinds('<td class="job-company">Initech</td>'), ['employer:initech']);
});

test('a list item and a paragraph render an employer claim', () => {
  assert.deepEqual(kinds('<li class="job-company">Globex</li>'), ['employer:globex']);
  assert.deepEqual(kinds('<p class="job-company">Umbrella</p>'), ['employer:umbrella']);
});

test('a single-quoted class renders an employer claim', () => {
  assert.deepEqual(kinds("<td class='job-company'>Initech</td>"), ['employer:initech']);
});

test('the element the template already used still works', () => {
  assert.deepEqual(kinds('<span class="job-company">Acme</span>'), ['employer:acme']);
});

test('a nested organization is still read apart from its education title', () => {
  assert.deepEqual(
    kinds('<td class="edu-title">BSc <td class="edu-org">MIT</td></td>'),
    ['education:bsc', 'education:mit'],
  );
});

test('a nested organization is read apart whatever element wraps it', () => {
  // The strip that separates the two used a shorter element list than the reader
  // that finds them, so `<strong class="edu-org">` was read once as the title's
  // text and once on its own. Both now share one list.
  assert.deepEqual(
    kinds('<td class="edu-title">BSc <strong class="edu-org">MIT</strong></td>'),
    ['education:bsc', 'education:mit'],
  );
  assert.deepEqual(
    kinds('<section class="edu-title">MSc <section class="edu-org">Stanford</section></section>'),
    ['education:msc', 'education:stanford'],
  );
  assert.deepEqual(
    kinds("<strong class='edu-title'>PhD <em class='edu-org'>ETH</em></strong>"),
    ['education:phd', 'education:eth'],
  );
});

test('a class that merely contains the name is not a match', () => {
  // The boundary guard is what keeps `not-job-companyish` from being read as a
  // field, and broadening the element list must not lose it.
  assert.deepEqual(kinds('<span class="not-job-companyish">Nope</span>'), []);
});

test('a data-class attribute is not a class attribute', () => {
  // `\bclass=` also matched `data-class=`, which turned any element carrying that
  // data attribute into a structured field.
  assert.deepEqual(kinds('<td data-class="job-company">Initech</td>'), []);
  assert.deepEqual(kinds('<td data-edu-org="MIT" class="edu-title">BSc</td>'), ['education:bsc']);
});