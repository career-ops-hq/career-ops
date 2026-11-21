// tests/cv-section-order-italian.test.mjs — the section-order guard and
// cv.sections must read Italian section titles, the way they already read
// English, Polish, Spanish, Chinese and Portuguese.
//
// SECTION_ALIASES had no Italian entries, so a CV built with modes/it/
// resolved no section key: `cv.sections` in config/profile.yml
// warned that it "matched no section in this CV" and the configured order was
// silently not applied, and the order guard compared raw titles instead of the
// canonical modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-italian.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="it">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## Profilo\n\n## Istruzione e formazione\n\n## Competenze\n\n## Esperienza professionale\n';

test('sectionKey resolves the Italian spellings CVs use', () => {
  const cases = [
    ['Profilo', 'summary'], ['Profilo professionale', 'summary'], ['Sommario', 'summary'], ['Chi sono', 'summary'],
    ['Competenze', 'competencies'], ['Competenze chiave', 'competencies'], ['Competenze principali', 'competencies'],
    ['Esperienza professionale', 'experience'], ['Esperienze professionali', 'experience'], ['Esperienza lavorativa', 'experience'], ['Percorso professionale', 'experience'],
    ['Progetti', 'projects'], ['Progetti selezionati', 'projects'], ['Progetti personali', 'projects'],
    ['Istruzione e formazione', 'education'], ['Istruzione', 'education'], ['Formazione', 'education'], ['Titoli di studio', 'education'],
    ['Certificazioni', 'certifications'], ['Certificati', 'certifications'],
    ['Premi', 'awards'], ['Premi e riconoscimenti', 'awards'],
    ['Competenze tecniche', 'skills'], ['Conoscenze tecniche', 'skills'], ['Capacità tecniche', 'skills'],
    ['Interessi', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('an Italian CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(['Profilo', 'Competenze chiave', 'Esperienza professionale', 'Istruzione e formazione', 'Certificazioni', 'Competenze tecniche']),
    cvMd,
  ));
});

test('a genuinely scrambled Italian CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Profilo\n\n## Competenze\n\n## Esperienza professionale\n\n## Istruzione e formazione\n';
  assert.throws(
    () => validateCvSectionOrder(html(['Istruzione e formazione', 'Esperienza professionale', 'Competenze', 'Profilo']), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders an Italian CV', () => {
  const input = sections([
    ['PROFESSIONAL SUMMARY', 'Profilo'],
    ['WORK EXPERIENCE', 'Esperienza professionale'],
    ['EDUCATION', 'Istruzione e formazione'],
    ['SKILLS', 'Competenze tecniche'],
  ]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ['Profilo', 'Competenze tecniche', 'Esperienza professionale', 'Istruzione e formazione']);
});
