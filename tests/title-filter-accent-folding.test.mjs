// tests/title-filter-accent-folding.test.mjs — the title filter must ignore
// diacritics on BOTH sides of the comparison.
//
// Spanish-language boards (YPF, for one) publish titles in uppercase without
// accents: "TECNICO CONTROL DE PRODUCCION". A portals.yml keyword written as
// "Producción" never matched it under toLowerCase() alone, and one real scan
// dropped 37 relevant postings this way. The symptom is silent — they count as
// filtered_title, not as an error — so only a test like this catches it.
//
// Run:  node --test tests/title-filter-accent-folding.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTitleFilter } from '../title-keywords.mjs';
import { matchedTitleKeywords } from '../scan.mjs';

test('an accented keyword matches an unaccented title', () => {
  const f = buildTitleFilter({ positive: ['Producción'] });
  assert.equal(f('TECNICO CONTROL DE PRODUCCION'), true);
});

test('an unaccented keyword matches an accented title', () => {
  const f = buildTitleFilter({ positive: ['Produccion'] });
  assert.equal(f('Jefe de Producción'), true);
});

test('an accented negative still vetoes an unaccented title', () => {
  const f = buildTitleFilter({ positive: ['Analista'], negative: ['Bioquímic'] });
  assert.equal(f('ANALISTA BIOQUIMICO DE PLANTA'), false);
});

test('plain matching and negatives are unchanged', () => {
  const f = buildTitleFilter({ positive: ['Calidad'], negative: ['Software'] });
  assert.equal(f('Analista de Calidad'), true);
  assert.equal(f('Software Quality Analyst'), false);
});

test('short-acronym word-boundary matching is unchanged', () => {
  const f = buildTitleFilter({ positive: ['it'] });
  assert.equal(f('IT Communications Network Engineer'), true);
  assert.equal(f('Digital Transformation Lead'), false);
});

test('matchedTitleKeywords() folds the same way and returns the raw keyword', () => {
  const kws = matchedTitleKeywords('TECNICO CONTROL DE PRODUCCION', { positive: ['Producción'] });
  assert.deepEqual(kws, ['Producción']);
});
