// tests/cv-section-order-german.test.mjs — the section-order guard and
// cv.sections must read German section titles, the way they already read
// English, Polish, Spanish, Chinese and Portuguese.
//
// SECTION_ALIASES had no German entries, so a CV built with modes/de/ or
// modes/at/ resolved no section key: `cv.sections` in config/profile.yml
// warned that it "matched no section in this CV" and the configured order was
// silently not applied, and the order guard compared raw titles instead of the
// canonical modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-german.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="de">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## Zusammenfassung\n\n## Ausbildung\n\n## Kompetenzen\n\n## Berufserfahrung\n';

test('sectionKey resolves the German spellings CVs use', () => {
  const cases = [
    ['Zusammenfassung', 'summary'], ['Profil', 'summary'], ['Kurzprofil', 'summary'], ['Berufliches Profil', 'summary'], ['Über mich', 'summary'],
    ['Kernkompetenzen', 'competencies'], ['Kompetenzen', 'competencies'], ['Schlüsselkompetenzen', 'competencies'],
    ['Berufserfahrung', 'experience'], ['Beruflicher Werdegang', 'experience'], ['Werdegang', 'experience'], ['Berufspraxis', 'experience'],
    ['Projekte', 'projects'], ['Ausgewählte Projekte', 'projects'], ['Projekterfahrung', 'projects'],
    ['Ausbildung', 'education'], ['Bildungsweg', 'education'], ['Akademischer Werdegang', 'education'], ['Studium', 'education'],
    ['Zertifikate', 'certifications'], ['Zertifizierungen', 'certifications'], ['Weiterbildung', 'certifications'],
    ['Auszeichnungen', 'awards'],
    ['Kenntnisse', 'skills'], ['Fähigkeiten', 'skills'], ['Fachkenntnisse', 'skills'], ['Technische Kenntnisse', 'skills'], ['IT-Kenntnisse', 'skills'],
    ['Interessen', 'interests'], ['Hobbys', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('a German CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(['Zusammenfassung', 'Kernkompetenzen', 'Berufserfahrung', 'Ausbildung', 'Zertifikate', 'Kenntnisse']),
    cvMd,
  ));
});

test('a genuinely scrambled German CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Zusammenfassung\n\n## Kompetenzen\n\n## Berufserfahrung\n\n## Ausbildung\n';
  assert.throws(
    () => validateCvSectionOrder(html(['Ausbildung', 'Berufserfahrung', 'Kompetenzen', 'Zusammenfassung']), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a German CV', () => {
  const input = sections([
    ['PROFESSIONAL SUMMARY', 'Zusammenfassung'],
    ['WORK EXPERIENCE', 'Berufserfahrung'],
    ['EDUCATION', 'Ausbildung'],
    ['SKILLS', 'Kenntnisse'],
  ]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ['Zusammenfassung', 'Kenntnisse', 'Berufserfahrung', 'Ausbildung']);
});
