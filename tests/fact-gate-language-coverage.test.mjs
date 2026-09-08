// tests/fact-gate-language-coverage.test.mjs — the fabrication gate must read a
// non-English CV, and must not report a confident pass on one it could not.
//
// verify-cv-facts.mjs is the last check before a generated CV or cover letter
// goes out (generate-cover-letter.mjs calls assertFacts on every one). Its
// count extractor was keyed on METRIC_NOUNS, an English word list, and
// COUNT_CLAIM_RE's modifier window was `[A-Za-z]`. Percentages, currency and
// multipliers are language-neutral and were checked everywhere — a COUNT was
// checked only in English.
//
// That is not an edge case for this project. AGENTS.md's `language.output`
// governs "reports, tracker notes, PDFs, cover letters ... any user-visible
// prose", and the repo ships market modes for eighteen languages. And counts
// are the class the file's own METRIC_NOUNS comment singles out:
//
//   "Managed 45 staff against a source saying 20 passed the gate silently,
//    which is the exact fabrication class this script exists to catch."
//
// cv-lexicons.mjs now supplies the noun forms for every language with a mode
// dir, so those counts are extracted and compared like English ones. The
// coverage diagnostic stays as the backstop for what the lexicon does not
// reach — a language with no mode set, or a noun nobody has added yet — so
// this suite asserts BOTH: the languages we claim to support are really
// checked, and the ones we do not are reported rather than waved through.
//
// Run:  node --test tests/fact-gate-language-coverage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFacts, diagnoseCoverage, metricClaims } from '../verify-cv-facts.mjs';

// No sources and no config: this asks what the gate SEES, not what it allows.
const BARE = { sourcePaths: [], configPath: 'config/__no_such_config__.json' };
const verdictOf = (text) => verifyFacts(text, BARE).verdict;

test('an English count inflation is caught, as it always was', () => {
  const r = verifyFacts('Managed 45 staff across 3 facilities.', BARE);
  assert.equal(r.verdict, 'block');
  assert.deepEqual([...r.invented].sort(), ['3 facilities', '45 staff']);
  assert.equal(r.coverage, null, 'a document the extractor read needs no coverage warning');
});

test('the same inflation is now CAUGHT, not merely reported, in every supported language', () => {
  // This is the behaviour change cv-lexicons.mjs bought. Each of these used to
  // yield zero count claims and a 'warn' verdict; the gate could see that it
  // had failed to read the document but could not act on what it said.
  for (const [lang, text] of [
    ['es', 'Gestioné 45 empleados en 3 instalaciones.'],
    ['de', 'Leitete 45 Mitarbeiter an 3 Standorten.'],
    ['tr', '3 tesiste 45 çalışanı yönetti.'],
    ['pt', 'Geri 45 funcionários em 3 unidades.'],
    ['fr', 'Encadré 45 collaborateurs sur 3 sites.'],
    ['nl', 'Leidde 45 werknemers op 3 locaties.'],
    ['pl', 'Zarządzał 45 pracowników w 3 lokalizacji.'],
    ['ru', 'Руководил 45 сотрудников на 3 площадок.'],
    ['ua', 'Керував 45 співробітників на 3 майданчиків.'],
    ['it', 'Ha gestito 45 dipendenti in 3 sedi.'],
    ['da', 'Ledede 45 ansatte på 3 lokationer.'],
    ['id', 'Memimpin 45 karyawan di 3 lokasi.'],
    ['hi', '3 स्थलों पर 45 कर्मचारी का नेतृत्व किया।'],
    ['ar', 'أدار 45 موظفا في 3 مواقع.'],
    ['ja', '3拠点で45名の従業員を管理。'],
    ['ko', '3개 거점에서 45명의 직원을 관리.'],
    ['zh', '管理3个站点的45名员工。'],
    ['zh-TW', '管理3個站點的45名員工。'],
  ]) {
    const r = verifyFacts(text, BARE);
    assert.equal(r.verdict, 'block', `${lang}: an unsupported count must block, not warn`);
    assert.ok(
      r.invented.some(claim => claim.startsWith('45 ')),
      `${lang}: expected the headcount to be extracted, got ${JSON.stringify(r.invented)}`,
    );
    assert.equal(r.coverage, null, `${lang}: a document the extractor read needs no coverage warning`);
  }
});

test('a truthful non-English CV passes, including against an English source', () => {
  // The direction that matters just as much: widening the lexicon must not turn
  // true statements red. The second case is the cross-language one AGENTS.md
  // makes routine — an English cv.md, a German CV, because `language.output`
  // and the source language are independent settings.
  assert.equal(verdictOf.length, 1); // (guard: helper signature unchanged)
  const sameLanguage = verifyFacts(
    'Leitete 45 Mitarbeiter an 3 Standorten.',
    { ...BARE, sourcePaths: [] },
  );
  assert.ok(sameLanguage.invented.length, 'sanity: with no sources at all, nothing is evidenced');

  // With evidence present, in either language, the claim resolves.
  const claimsOf = (text) => [...metricClaims(text)].sort();
  assert.deepEqual(claimsOf('Leitete 45 Mitarbeiter an 3 Standorten.'), ['3 sites', '45 employees']);
  assert.deepEqual(claimsOf('Managed 45 employees across 3 sites.'), ['3 sites', '45 employees'],
    'the German CV and its English source must produce the SAME canonical claims');
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

test('foreign noun forms do not hijack ordinary English prose', () => {
  // The lexicon is applied to every document, not only to ones declared to be
  // in that language — a CV's language is not always knowable, and the source
  // and the CV may differ. So a foreign form that is also an English word would
  // bind the number to the wrong noun and invent a claim the CV never made,
  // which fails a TRUTHFUL CV: the exact bug class this work set out to fix,
  // reintroduced from the other side. cv-lexicons.mjs omits those forms; this
  // pins the ones that were actually caught doing it.
  const claimsOf = (text) => [...metricClaims(text)].sort();
  assert.deepEqual(claimsOf('Led 5 personal projects.'), ['5 projects'], 'de/es "personal"');
  assert.deepEqual(claimsOf('Operated across 2 time zones.'), [], 'da "time"');
  assert.deepEqual(claimsOf('Billed at $5 an hour.'), ['$5'], 'fr "an"');
  assert.deepEqual(claimsOf('Assayed 4 ore samples.'), [], 'it "ore"');
  assert.deepEqual(claimsOf('Ran 3 jam sessions.'), ['3 sessions'], 'id "jam"');
});

test('a year is not a count', () => {
  // Every CV carries several, and "Led the 2024 migration" is the shape of a
  // count and none of the meaning.
  assert.equal(diagnoseCoverage('Led the 2024 migration and the 2019 rollout.'), null);
  assert.deepEqual([...metricClaims('Joined in 2013. Led the 2024 migration.')], []);
});

test('a CJK date is not a duration', () => {
  // The sharp edge of putting CJK counters in the lexicon: in ja/zh/ko a date
  // IS "number + duration noun", so "2024年3月" would otherwise extract as
  // "2024 years" — a fabricated claim on every dated CJK CV. 年 is guarded by
  // the calendar-year test; bare 月 and 日 are kept out of the lexicon entirely
  // because no guard can separate "March" from "3 months".
  const claimsOf = (text) => [...metricClaims(text)].sort();
  assert.deepEqual(claimsOf('2024年3月に入社。'), [], 'a bare CJK date yields no claim');
  assert.deepEqual(claimsOf('2019年4月〜2024年3月'), [], 'a CJK date range yields no claim');
  assert.deepEqual(claimsOf('15年の経験。'), ['15 years'], 'but a real duration still counts');
  assert.deepEqual(claimsOf('6ヶ月のプロジェクト'), ['6 months'], 'and the unambiguous month counter works');
});

test('the coverage signal still fires for a language the lexicon does not reach', () => {
  // The lexicon covers the mode-set languages; the diagnostic is what keeps a
  // document outside them from reading as "scanned and clean". Finnish, Greek
  // and Vietnamese ship no mode set and are deliberately not in the lexicon.
  for (const [lang, text] of [
    ['fi', 'Johti 45 työntekijää 3 toimipisteessä.'],
    ['el', 'Διηύθυνε 45 υπαλλήλους σε 3 εγκαταστάσεις.'],
    ['vi', 'Quản lý 45 nhân viên tại 3 địa điểm.'],
  ]) {
    const r = verifyFacts(text, BARE);
    assert.ok(r.coverage, `${lang}: no coverage signal — this document reads as scanned and clean`);
    assert.equal(r.coverage.reason, 'no-count-claims-recognized');
    assert.ok(r.coverage.spans.length >= 2, `${lang}: expected the count spans to be located`);
    assert.equal(r.verdict, 'warn', `${lang}: a document the gate could not read must not verdict 'pass'`);
  }
});

test('the coverage detector now sees CJK too', () => {
  // Previously pinned as a known gap: the detector required 3+ letters after
  // the number, which "45名" never satisfies, so a ja/zh CV whose nouns the
  // lexicon missed reached 'pass' with neither a claim nor a warning. Now that
  // CJK counters ARE in the lexicon this rarely fires — but the backstop has to
  // work for the counter the lexicon does not yet know, so it is asserted on a
  // CJK noun deliberately absent from the table.
  const unknown = '3隻の船と45羽の鳥。';
  assert.deepEqual([...metricClaims(unknown)], [], 'sanity: these nouns are not in the lexicon');
  const r = verifyFacts(unknown, BARE);
  assert.ok(r.coverage, 'an unreadable CJK document must not verdict pass');
  assert.equal(r.verdict, 'warn');
});

test('the signal never creates or masks a block', () => {
  // A real fabrication still blocks even when the coverage warning also applies,
  // and a coverage gap alone never escalates to block — that would fail every
  // document in an unsupported language, trading a silent gap for a wall.
  const both = verifyFacts('Johti 45 työntekijää 3 toimipisteessä ja kasvatti liikevaihtoa 30%.', BARE);
  assert.equal(both.verdict, 'block', 'the language-neutral 30% claim must still block');
  assert.ok(both.coverage, 'and the unchecked counts must still be reported');

  assert.equal(verdictOf('Johti 45 työntekijää 3 toimipisteessä.'), 'warn');
});
