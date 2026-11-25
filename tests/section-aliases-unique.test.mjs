// tests/section-aliases-unique.test.mjs — every SECTION_ALIASES spelling has
// a key of its own, and resolves to the section it names.
//
// generate-pdf.mjs builds the table from foldDiacritics(alias), so two
// spellings that fold alike are one key. A second entry adds nothing when it
// names the same section, and silently overrides the first when it names
// another: a word added for one language would change how a heading in another
// language resolves, with no error. The table now holds more than a dozen
// language blocks, each written on its own, so the check is mechanical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTION_ALIAS_ENTRIES, foldDiacritics, sectionKey } from '../generate-pdf.mjs';

test('no two SECTION_ALIASES entries fold to the same key', () => {
  const first = new Map();
  const repeats = [];
  for (const [alias, key] of SECTION_ALIAS_ENTRIES) {
    const folded = foldDiacritics(alias);
    const earlier = first.get(folded);
    if (earlier) repeats.push(`"${alias}" (${key}) folds to the key of "${earlier.alias}" (${earlier.key})`);
    else first.set(folded, { alias, key });
  }
  assert.deepEqual(repeats, []);
});

test('every SECTION_ALIASES entry resolves to its own section', () => {
  // sectionKey() lower-cases and collapses whitespace before the lookup, so an
  // entry written any other way could never be reached.
  const unreachable = SECTION_ALIAS_ENTRIES
    .filter(([alias, key]) => sectionKey(alias) !== key)
    .map(([alias, key]) => `"${alias}" resolves to "${sectionKey(alias)}", not "${key}"`);
  assert.deepEqual(unreachable, []);
});
