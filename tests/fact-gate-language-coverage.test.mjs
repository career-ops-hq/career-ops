// tests/fact-gate-language-coverage.test.mjs — the fabrication gate must not
// report a confident pass on a document it could not read.
//
// verify-cv-facts.mjs is the last check before a generated CV or cover letter
// goes out (generate-cover-letter.mjs calls assertFacts on every one). Its
// count extractor is keyed on METRIC_NOUNS, an English word list, and
// COUNT_CLAIM_RE's modifier window is `[A-Za-z]`. Percentages, currency and
// multipliers are language-neutral and still checked everywhere — a COUNT is
// checked only in English.
//
// That is not an edge case for this project. AGENTS.md's `language.output`
// governs "reports, tracker notes, PDFs, cover letters ... any user-visible
// prose", and the repo ships market modes for de/fr/ar/ja/tr/hi. And counts are
// the class the file's own METRIC_NOUNS comment singles out:
//
//   "Managed 45 staff against a source saying 20 passed the gate silently,
//    which is the exact fabrication class this script exists to catch."
//
// Run:  node --test tests/fact-gate-language-coverage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFacts, diagnoseCoverage } from '../verify-cv-facts.mjs';

// No sources and no config: this asks what the gate SEES, not what it allows.
const BARE = { sourcePaths: [], configPath: 'config/__no_such_config__.json' };
const verdictOf = (text) => verifyFacts(text, BARE).verdict;

test('an English count inflation is caught, as it always was', () => {
  const r = verifyFacts('Managed 45 staff across 3 facilities.', BARE);
  assert.equal(r.verdict, 'block');
  assert.deepEqual([...r.invented].sort(), ['3 facilities', '45 staff']);
  assert.equal(r.coverage, null, 'a document the extractor read needs no coverage warning');
});

test('the same inflation in a space-delimited language is reported as unchecked', () => {
  for (const [lang, text] of [
    ['es', 'Gestioné 45 empleados en 3 instalaciones.'],
    ['de', 'Leitete 45 Mitarbeiter an 3 Standorten.'],
    ['tr', '3 tesiste 45 çalışanı yönetti.'],
    ['pt', 'Geri 45 funcionários em 3 unidades.'],
  ]) {
    const r = verifyFacts(text, BARE);
    assert.ok(r.coverage, `${lang}: no coverage signal — this document reads as scanned and clean`);
    assert.equal(r.coverage.reason, 'no-count-claims-recognized');
    assert.ok(r.coverage.spans.length >= 2, `${lang}: expected the count spans to be located`);
    assert.equal(r.verdict, 'warn', `${lang}: a document the gate could not read must not verdict 'pass'`);
  }
});

test('a clean English document is untouched — no new noise', () => {
  // The signal is added to a gate every generated document already runs, so a
  // false fire is a real cost. These must all stay silent.
  for (const text of [
    'Senior Engineer at Acme since 2019. Led the 2024 platform migration.',
    'Cut p99 latency by 30% and infrastructure spend by $1.2M.',
    'Mentored 6 engineers and ran 4 hiring loops.',
    'Managed 20 staff across 2 facilities.',
    // Currency followed by prose reads as "digits, then a word" to a detector
    // that has no lexicon — but these ARE checked, in every language, so
    // reporting them as unread is a false alarm. Caught by the existing suite
    // (test-all "source-backed currency metrics") before this shipped.
    'Raised $120k and closed a $90,000 deal.',
    'Cut spend by $1.2M and latency by 30%.',
    '',
  ]) {
    assert.equal(diagnoseCoverage(text), null, `fired on: ${JSON.stringify(text)}`);
  }
});

test('a year is not a count', () => {
  // Every CV carries several, and "Led the 2024 migration" is the shape of a
  // count and none of the meaning. Without the year filter this fires on
  // essentially every document, English included.
  assert.equal(diagnoseCoverage('Led the 2024 migration and the 2019 rollout.'), null);
});

test('the signal never creates or masks a block', () => {
  // A real fabrication still blocks even when the coverage warning also applies,
  // and a coverage gap alone never escalates to block — that would fail every
  // non-English document, trading a silent gap for a wall.
  const both = verifyFacts('Gestioné 45 empleados en 3 instalaciones y aumenté ingresos un 30%.', BARE);
  assert.equal(both.verdict, 'block', 'the language-neutral 30% claim must still block');
  assert.ok(both.coverage, 'and the unchecked counts must still be reported');

  assert.equal(verdictOf('Leitete 45 Mitarbeiter an 3 Standorten.'), 'warn');
});

test('one recognised count silences the warning — the documented under-report', () => {
  // French "sites" collides with the English noun, so the gate reaches one count
  // and the rest stay invisible. Asserted so the limitation is a decision on
  // record rather than an accident, and so a future lexicon change that removes
  // this coincidence shows up here.
  const r = verifyFacts('Encadré 45 collaborateurs sur 3 sites.', BARE);
  assert.equal(r.coverage, null);
  assert.deepEqual([...r.invented], ['3 sites'], 'only the coincidental noun was read');
});

test('CJK is NOT covered by this detector, and that is recorded', () => {
  // Japanese and Chinese put digits flush against the text, so the digit run is
  // preceded by a letter and the detector does not see it. Relaxing that would
  // match digits inside Latin identifiers, so it needs script-aware
  // segmentation rather than a looser regex. Pinned as a known gap: if a later
  // change makes this fire, that is an improvement and this test should be
  // updated deliberately, not a regression.
  assert.equal(diagnoseCoverage('3拠点で45名のスタッフを管理。'), null);
  assert.equal(diagnoseCoverage('管理3个站点的45名员工。'), null);
});
