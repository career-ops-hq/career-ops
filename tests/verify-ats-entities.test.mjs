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

import { auditAts, extractVisibleText } from '../verify-ats.mjs';

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
