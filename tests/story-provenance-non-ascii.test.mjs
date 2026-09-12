// tests/story-provenance-non-ascii.test.mjs — the provenance checker must
// reach the same verdict whatever script the CV is written in.
//
// contextWords() stripped with `[^a-z0-9\s]`, the last surviving instance in
// the repo of the ASCII-only strip #2393/#2429/#2569/#2666 replaced everywhere
// else. Both of this checker's context consumers read the result as a list:
// hasScopedNumberMatch does `claimWords.includes(w)` and hasContextOverlap
// does `words.some(...)`. An EMPTY list makes both unconditionally false, so
// on a Cyrillic/Greek/Hebrew/Arabic/CJK CV the `existing` and
// `supportedByResume` buckets are unreachable and every extracted claim lands
// in `derived-unverified` — a figure sitting verbatim in cv.md included.
//
// That bucket is not a quiet one. AGENTS.md's "Confirmation UX invariant"
// hands derived-unverified findings to the user to confirm or deny, and names
// the risk: a confirmed guess launders the guess into a verified fact. A list
// where 100% of the entries are noise is how a user learns not to read it.
//
// The tests below pin the fix in BOTH directions — a real trace must verify,
// and the scoping guards that keep `existing` honest must still fire — because
// "keep every letter" would also be satisfied by a change that simply says yes
// to everything.
//
// Run:  node --test tests/story-provenance-non-ascii.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStoryBank } from '../story-provenance-check.mjs';

/** Bucket name a single-claim classification landed in. */
function verdict(storyBank, cv) {
  const b = classifyStoryBank(storyBank, cv);
  const hits = Object.entries(b).filter(([, v]) => v.length > 0);
  assert.equal(hits.length, 1, `expected exactly one non-empty bucket, got ${JSON.stringify(b)}`);
  assert.equal(hits[0][1].length, 1, `expected exactly one claim, got ${hits[0][1].length}`);
  return hits[0][0];
}

// ── The number is in cv.md, in context, in a non-Latin script ──────────

test('a Cyrillic CV verifies a claim its own prose supports', () => {
  const cv = [
    '# Иван Петров',
    '',
    '- Сократил расходы на инфраструктуру на 40% за один год.',
  ].join('\n');
  const story = [
    '### [Leadership] Масштабирование платформы',
    '',
    '**Result:** Сократил расходы на инфраструктуру на 40% за год.',
  ].join('\n');

  assert.equal(verdict(story, cv), 'existing');
});

test('a Greek CV verifies a claim its own prose supports', () => {
  const cv = '# Βιογραφικό\n\n- Μείωσε το κόστος υποδομής κατά 40% σε έναν χρόνο.';
  const story = '### [Impact] Μείωση κόστους\n\n**Result:** Μείωσε το κόστος υποδομής κατά 40%.';

  assert.equal(verdict(story, cv), 'existing');
});

// ── …and the scoping guards still fire in those scripts ───────────────

test('a bare digit coincidence in a Cyrillic CV is NOT verified', () => {
  // 40 appears in cv.md, but as a page count in an unrelated sentence. This is
  // the #2947 CodeRabbit finding (unscoped number matching) expressed in
  // Cyrillic: keeping the letters must not also drop the context requirement.
  const cv = '# Иван Петров\n\n- Опубликовал руководство объёмом 40 страниц.';
  const story = '### [Impact] Снижение затрат\n\n**Result:** Сократил расходы на инфраструктуру на 40%.';

  assert.equal(verdict(story, cv), 'derivedUnverified');
});

test('an accented word is no longer re-cut into a different real word', () => {
  // The old strip turned "évaluation" into " valuation" — a DIFFERENT English
  // word. Against a finance CV that legitimately says "valuation", the claim
  // then read as supportedByResume on a token the story never contained.
  const cv = '# Jane Roe\n\n- Built discounted cash flow valuation models for the M&A desk.';
  const story = '### [Risk] Revue annuelle\n\n**Result:** Réduit les incidents de 40% après une évaluation complète.';

  assert.equal(verdict(story, cv), 'derivedUnverified');
});

// ── supportedByResume: the second half of the same defect ─────────────
//
// hasContextOverlap searched cv.md with `\b${word}\b`, and `\b` is defined
// against `\w` = [A-Za-z0-9_]. For a Cyrillic or Greek word BOTH sides of every
// edge are non-word characters, so the assertion is never satisfied:
//
//   /\bсократил\b/i.test('сократил расходы')  ->  false
//
// Keeping the letters through the strip therefore was not enough on its own —
// they still could not be FOUND in cv.md, so this bucket stayed unreachable and
// every claim fell to derived-unverified anyway.

test('a Cyrillic claim cv.md supports but does not quantify is supportedByResume', () => {
  // The NUMBER is absent from cv.md, so `existing` is correctly out of reach.
  // The surrounding fact is there, which is exactly what this bucket means.
  const cv = '# Иван Петров\n\n- Отвечал за сокращение расходов на инфраструктуру платформы.';
  const story = '### [Impact] Снижение затрат\n\n**Result:** Сократил расходы на инфраструктуру на 40%.';

  assert.equal(verdict(story, cv), 'supportedByResume');
});

test('a Greek claim cv.md supports but does not quantify is supportedByResume', () => {
  const cv = '# Βιογραφικό\n\n- Υπεύθυνος για τη μείωση του κόστους υποδομής.';
  const story = '### [Impact] Μείωση κόστους\n\n**Result:** Μείωσε το κόστος υποδομής κατά 40%.';

  assert.equal(verdict(story, cv), 'supportedByResume');
});

test('the boundary is still a boundary — a substring does not count as overlap', () => {
  // The replacement must not become a bare `includes`, so the fixture has to
  // CONTAIN the substring case: the claim word "дизайн" sits inside cv.md's
  // "редизайн", and nothing else is shared. A whole-word matcher finds no
  // overlap; `includes` would return supportedByResume.
  const cv = '# CV\n\n- Выполнил редизайн макета.';
  const story = '### [Impact] Затраты\n\n**Result:** Создал дизайн и сократил расходы на 40%.';

  assert.equal(verdict(story, cv), 'derivedUnverified');
});

test('a Turkish dotted capital in cv.md still matches a claim word', () => {
  // Both sides have to be folded the SAME way. cv.md lowercases "İstanbul" to
  // `i` + U+0307, and the claim window has already had that dot stripped — so
  // folding only the claim side leaves them unequal.
  //
  // Every other content word is disjoint on purpose, so "istanbul" is the ONLY
  // thing that can produce the overlap — otherwise an ASCII word carries the
  // test and the fold is never exercised.
  const cv = '# CV\n\n- İstanbul biriminde görev aldı.';
  const story = '### [Impact] Tasarruf\n\n**Result:** Istanbul genelinde 40% tasarruf sağlandı.';

  assert.equal(verdict(story, cv), 'supportedByResume');
});

// ── The ASCII path is untouched ───────────────────────────────────────

test('the English behaviour the checker shipped with is unchanged', () => {
  const cv = '# Ivan Petrov\n\n- Cut infrastructure costs by 40% in one year.';
  const story = '### [Impact] Cost reduction\n\n**Result:** Cut infrastructure costs by 40% in one year.';
  assert.equal(verdict(story, cv), 'existing');

  const unrelated = '# Ivan Petrov\n\n- Published a 40 page onboarding guide.';
  assert.equal(verdict(story, unrelated), 'derivedUnverified');
});

test('a Turkish dotted capital folds to the same word as its plain i', () => {
  // `'İ'.toLowerCase()` is `i` + U+0307, and \p{M} in the new strip would have
  // KEPT that combining dot — so the fix has to drop it explicitly or
  // "İstanbul" and "Istanbul" stop comparing equal.
  // (Written `40%` rather than the Turkish `%40`: the percent pattern requires
  // the sign to FOLLOW the number, so `%40` extracts no claim at all. That is a
  // real gap for tr/de-style prose and a separate one — this test is about the
  // fold, so it uses a shape the extractor already sees.)
  const cv = '# CV\n\n- İstanbul ekibinde maliyetleri 40% azalttı.';
  const story = '### [Impact] Maliyet\n\n**Result:** Istanbul ekibinde maliyetleri 40% azalttı.';

  assert.equal(verdict(story, cv), 'existing');
});
