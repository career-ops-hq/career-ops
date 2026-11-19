// tests/title-filter-inclusive-suffix.test.mjs — the title filter must ignore
// gender-inclusive suffixes on BOTH sides of the comparison.
//
// Quebec and France boards publish "Chargé·e de projets" and "Chargé(e) de
// projet"; German boards publish "Projektleiter:in" and "Projektleiter*in";
// Spanish boards publish "Coordinador/a". A substring test misses every one of
// them, because "chargé de projet" is not a substring of "chargé·e de
// projets". The plural was never the problem — it is a suffix — only the
// inserted marker is.
//
// The symptom is silent, exactly as in title-filter-accent-folding: the
// postings count as filtered_title, indistinguishable from a genuinely
// irrelevant title, so nothing in the scan output points at the cause. Two
// real postings a candidate was applying to never appeared in a scan this way.
//
// Run:  node --test tests/title-filter-inclusive-suffix.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTitleFilter, foldTitle } from '../title-keywords.mjs';

test('the middle-dot form matches a plain keyword (fr)', () => {
  const f = buildTitleFilter({ positive: ['Chargé de projet'] });
  assert.equal(f('Chargé·e de projets, Événements corporatifs'), true);
  assert.equal(f('Chargé·e de projets expérientiels'), true);
});

test('the parenthesised form matches a plain keyword (fr)', () => {
  const f = buildTitleFilter({ positive: ['Chargé de projet'] });
  assert.equal(f('Chargé(e) de projet'), true);
});

test('a longer middle-dot suffix matches too', () => {
  const f = buildTitleFilter({ positive: ['Directeur des ventes'] });
  assert.equal(f('Directeur·rice des ventes'), true);
  assert.equal(f('Coordonnateur·rice technique'), false); // no positive for it
});

test('the German colon and asterisk forms match', () => {
  const f = buildTitleFilter({ positive: ['Projektleiter'] });
  assert.equal(f('Projektleiter:in Digitalisierung'), true);
  assert.equal(f('Projektleiter*in Digitalisierung'), true);
});

test('the Spanish slash form matches', () => {
  const f = buildTitleFilter({ positive: ['Coordinador'] });
  assert.equal(f('Coordinador/a de Proyectos'), true);
});

test('an inclusive keyword matches a plain title, symmetrically', () => {
  const f = buildTitleFilter({ positive: ['Chargé·e de projet'] });
  assert.equal(f('Chargé de projets'), true);
});

test('an inclusive negative still vetoes', () => {
  const f = buildTitleFilter({ positive: ['Chargé de projet'], negative: ['Développeur·euse'] });
  assert.equal(f('Chargé·e de projets — Développeur senior'), false);
});

test('a real parenthetical is untouched', () => {
  const f = buildTitleFilter({ positive: ['Manager'] });
  assert.equal(f('Manager (Engineering)'), true);
  assert.equal(foldTitle('Manager (Engineering)'), 'manager (engineering)');
});

test('short slash tokens are untouched', () => {
  // "/a" only strips after three or more letters, so these keep their text.
  assert.equal(foldTitle('R/A and N/A reporting'), 'r/a and n/a reporting');
});

test('a colon that is not an inclusive marker is untouched', () => {
  assert.equal(foldTitle('Manager: Internal Audit'), 'manager: internal audit');
});

test('plain matching, accents and short acronyms are unchanged', () => {
  const f = buildTitleFilter({ positive: ['Producción'], negative: ['Software'] });
  assert.equal(f('TECNICO CONTROL DE PRODUCCION'), true);
  assert.equal(f('Software Quality Analyst'), false);
  const g = buildTitleFilter({ positive: ['it'] });
  assert.equal(g('IT Communications Network Engineer'), true);
  assert.equal(g('Digital Transformation Lead'), false);
});
