// tests/verify-ats-entities.test.mjs — a CV whose headings and body carry HTML
// entities, or accented letters, was scored as if its text were missing.
//
// Two independent causes (#4261):
//   1. stripInline()/extractVisibleText() stripped tags but left entities, so
//      `Exp&eacute;rience` reached the matcher as `exp eacute rience` and
//      matched neither /experience/ nor an ASCII keyword.
//   2. extractHeadings() lowercased without folding, so `ÉDUCATION` never
//      matched /education/ even once the entity was decoded.
//
// The assertions below are on auditAts' own output, so they fail on main and pass
// with the fix rather than pinning the helper functions.
//
// Run:  node --test tests/verify-ats-entities.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auditAts, extractHeadings, extractVisibleText } from '../verify-ats.mjs';

/** A CV body long enough to clear TEXT_MIN_CHARS, with a given heading set. */
function cvWithHeadings(headings) {
  const sections = headings.map(
    (h) => `<div class="section"><div class="section-title">${h}</div>
      <p>Led a team of engineers delivering reliable distributed systems, owning the
      roadmap, the on-call rotation, and the migration to containerised deploys.
      Cut p99 latency by 40 percent and halved infrastructure spend over two quarters
      while keeping every customer-facing SLA, and mentored four new hires.</p></div>`,
  );
  return `<html><head><style>body{font-family:Arial,sans-serif;font-size:11px;}</style></head>
<body>
  <div class="header"><p>Alex Martin | alex@example.com | +1 555 0100</p></div>
  ${sections.join('\n')}
</body></html>`;
}

const missingHeadings = (result) =>
  result.issues.filter((i) => i.message.startsWith('Missing standard section heading(s)'));

test('entity-encoded headings are recognised', () => {
  const result = auditAts(
    cvWithHeadings(['Exp&eacute;rience', '&Eacute;ducation', 'Comp&eacute;tences']),
  );
  assert.deepEqual(missingHeadings(result), [],
    'entity-encoded Experience/Education/Skills headings must each count');
});

test('accented headings are recognised without entities', () => {
  const result = auditAts(cvWithHeadings(['Expérience', 'Éducation', 'Compétences']));
  assert.deepEqual(missingHeadings(result), [],
    'accented headings must fold to their English equivalents');
});

test('plain English headings still count, so the fix does not narrow the gate', () => {
  const result = auditAts(cvWithHeadings(['Experience', 'Education', 'Skills']));
  assert.deepEqual(missingHeadings(result), []);
});

test('an entity-encoded body matches an ASCII keyword', () => {
  // The keyword appears only in entity-encoded form in the body, so this fails
  // unless the decode happens before the haystack is folded.
  const html = `<html><head><style>body{font-family:Arial,sans-serif;font-size:11px;}</style></head>
<body>
  <div class="header"><p>Alex Martin | alex@example.com | +1 555 0100</p></div>
  <div class="section"><div class="section-title">Exp&eacute;rience</div>
    <p>Led Kubernet&egrave;s migrations for a payments platform, and cut p99 latency by 40
    percent. Owned the Postgres query planner work, the on-call rotation, and the
    handover documentation for four new hires across two offices.</p></div>
</body></html>`;
  const result = auditAts(html, { keywords: 'kubernetes' });
  assert.equal(result.keywordCoverage.found, 1,
    'a keyword must match text that the CV carries, whatever its encoding');
});

test('an accented CV matches a keyword typed without accents', () => {
  // The keyword itself carries an accent in the CV ("réduit" is not it — the
  // search term is), so this only passes when both sides are folded.
  const html = `<html><head><style>body{font-family:Arial,sans-serif;font-size:11px;}</style></head>
<body>
  <div class="header"><p>Alex Martin | alex@example.com | +1 555 0100</p></div>
  <div class="section"><div class="section-title">Expérience</div>
    <p>Piloté la migration Réseaux d'une plateforme de paiement et réduit la
    latence p99 de 40 pour cent. Responsable de la rotation d'astreinte et de la
    documentation de passation pour quatre nouveaux collègues sur deux sites.</p></div>
</body></html>`;
  const result = auditAts(html, { keywords: 'reseaux' });
  assert.equal(result.keywordCoverage.found, 1,
    'an unaccented keyword must match the accented word the CV carries');
});

test('an unknown entity is left visible rather than dropped', () => {
  const html = cvWithHeadings(['Experience', 'Education', 'Skills']).replace(
    'Alex Martin',
    'Alex &notarealentity; Martin',
  );
  assert.ok(extractVisibleText(html).includes('&notarealentity;'),
    'a reference we do not know must survive as text, not vanish');
});

test('Chinese headings are recognised, not folded away', () => {
  // asciiFold returns '' when nothing Latin survives, so feeding headings
  // through it alone made every required section read missing for a Chinese CV:
  // a 15-point loss and a critical for a defect that does not exist. Raised in
  // review on #4330.
  const result = auditAts(cvWithHeadings(['工作经历', '教育经历', '技术栈']));
  assert.deepEqual(missingHeadings(result), [],
    'a Chinese CV must not report its sections as missing');
});

test('an unmapped non-Latin heading keeps its own text rather than vanishing', () => {
  // The alias table covers the languages we know; an unmapped one must still be
  // comparable instead of folding to '', so the heading is present at all.
  const headings = extractHeadings('<h2>職務要約</h2>');
  assert.ok(headings.some(h => h.includes('職務要約')),
    `the heading text must survive folding, got ${JSON.stringify(headings)}`);
});

test('a compound Chinese heading does not also claim an unrelated section', () => {
  // `教育经历` contains `经历`, so a naive substring match emitted `experience`
  // as well, reporting a section the CV may not have.
  const headings = extractHeadings('<h2>教育经历</h2>');
  assert.ok(headings.includes('education'), 'education is mapped');
  assert.ok(!headings.includes('experience'),
    `education must not also report experience, got ${JSON.stringify(headings)}`);
});

test('Latin headings fold exactly as before', () => {
  // The non-Latin support must not disturb the accented behaviour this PR added.
  for (const h of ['ÉDUCATION', 'Übersicht', 'Experience']) {
    const headings = extractHeadings(`<h2>${h}</h2>`);
    assert.ok(headings.includes(h.toLowerCase()), `folded form kept for ${h}`);
  }
  assert.ok(extractHeadings('<h2>ÉDUCATION</h2>').includes('education'));
});

test('a Latin alias does not match inside a longer word', () => {
  // Plain substring matching made `formation` hit inside `information`, so a CV
  // with an Information heading reported an education section it does not have.
  // Raised as a regression in review on #4330.
  const headings = extractHeadings('<h2>Information</h2>');
  assert.ok(!headings.includes('education'),
    `Information must not report education, got ${JSON.stringify(headings)}`);

  const tech = extractHeadings('<h2>Information Technology</h2>');
  assert.ok(!tech.includes('education'),
    `Information Technology must not report education, got ${JSON.stringify(tech)}`);

  // the alias still applies when it IS the word
  assert.ok(extractHeadings('<h2>Formation</h2>').includes('education'));
});

test('a punctuation-bearing keyword does not match a bare letter', () => {
  // `asciiFold('C++')` is 'c', so any CV containing a 'c' anywhere counted C++
  // as found. Reported in review on #4330.
  const wrap = (body) => `<html><head><style>body{font-family:Arial,sans-serif;font-size:11px;}</style></head>
<body>
  <div class="header"><p>Alex Martin | alex@example.com | +1 555 0100</p></div>
  <div class="section"><div class="section-title">Experience</div>
    <p>${body} Led a team of engineers through the migration, owning the roadmap,
    the on-call rotation and the handover docs for four new hires.</p></div>
  <div class="section"><div class="section-title">Education</div><p>BSc</p></div>
  <div class="section"><div class="section-title">Skills</div><p>Postgres</p></div>
</body></html>`;

  const strayC = auditAts(wrap('I write c and other letters'), { keywords: 'C++' });
  assert.equal(strayC.keywordCoverage.found, 0,
    'a stray c must not satisfy C++');
  assert.deepEqual(strayC.keywordCoverage.missing, ['C++']);

  const withCpp = auditAts(wrap('I write C++ professionally'), { keywords: 'C++' });
  assert.equal(withCpp.keywordCoverage.found, 1,
    'a real C++ mention must still match');
});

test('a keyword that folds to nothing is never counted as found', () => {
  // `includes('')` is true for every haystack, so a keyword whose fold is empty
  // was reported present in any CV. Reported in review on #4330.
  const html = `<html><head><style>body{font-family:Arial,sans-serif;font-size:11px;}</style></head>
<body>
  <div class="header"><p>Alex Martin | alex@example.com | +1 555 0100</p></div>
  <div class="section"><div class="section-title">Experience</div>
    <p>Led a team of engineers through the migration, owning the roadmap and the
    on-call rotation for two offices and four new hires.</p></div>
  <div class="section"><div class="section-title">Education</div><p>BSc</p></div>
  <div class="section"><div class="section-title">Skills</div><p>Python</p></div>
</body></html>`;
  const result = auditAts(html, { keywords: ['工作经历', 'Python'] });
  assert.equal(result.keywordCoverage.found, 1,
    'only the keyword present in the text may be found');
  assert.deepEqual(result.keywordCoverage.missing, ['工作经历']);
});
