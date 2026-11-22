// tests/cv-section-order-nordic.test.mjs — the section-order guard and cv.sections must read
// Danish and Norwegian section titles, the way they already read English, Polish,
// Spanish, Italian, Chinese and Portuguese.
//
// SECTION_ALIASES had no Danish and Norwegian entries, so a CV built with modes/da/ or modes/nb/
// resolved no section key: `cv.sections` in config/profile.yml warned that it
// "matched no section in this CV" and the configured order was silently not
// applied, and the order guard compared raw titles instead of the canonical
// modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-nordic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="da">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## Sammenfatning\n\n## Uddannelse\n\n## Kernekompetencer\n\n## Erhvervserfaring\n';

test('sectionKey resolves the Danish and Norwegian spellings CVs use', () => {
  const cases = [
    ['Profil', 'summary'], ['Resumé', 'summary'], ['Resume', 'summary'],
    ['Sammenfatning', 'summary'], ['Om mig', 'summary'], ['Sammendrag', 'summary'], ['Om meg', 'summary'],
    ['Kernekompetencer', 'competencies'], ['Kjernekompetanse', 'competencies'],
    ['Erhvervserfaring', 'experience'], ['Karriereforløb', 'experience'], ['Arbejdserfaring', 'experience'], ['Arbeidserfaring', 'experience'], ['Yrkeserfaring', 'experience'], ['Erfaring', 'experience'],
    ['Projekter', 'projects'], ['Prosjekter', 'projects'],
    ['Uddannelse', 'education'], ['Utdanning', 'education'], ['Utdannelse', 'education'],
    ['Certificeringer', 'certifications'], ['Certifikater', 'certifications'], ['Sertifiseringer', 'certifications'], ['Sertifikater', 'certifications'],
    ['Priser', 'awards'], ['Udmærkelser', 'awards'], ['Utmerkelser', 'awards'],
    ['Kompetencer', 'skills'], ['Kompetanse', 'skills'], ['Færdigheder', 'skills'], ['Tekniske færdigheder', 'skills'], ['Ferdigheter', 'skills'], ['Tekniske ferdigheter', 'skills'],
    ['Interesser', 'interests'], ['Fritidsinteresser', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('A Danish and Norwegian CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(["Sammenfatning", "Kernekompetencer", "Erhvervserfaring", "Uddannelse", "Certificeringer", "Kompetencer"]),
    cvMd,
  ));
});

test('a genuinely scrambled Danish and Norwegian CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Sammenfatning\n\n## Kernekompetencer\n\n## Erhvervserfaring\n\n## Uddannelse\n';
  assert.throws(
    () => validateCvSectionOrder(html(["Uddannelse", "Erhvervserfaring", "Kernekompetencer", "Sammenfatning"]), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a Danish and Norwegian CV', () => {
  const input = sections([["PROFESSIONAL SUMMARY", "Sammendrag"], ["WORK EXPERIENCE", "Arbeidserfaring"], ["EDUCATION", "Utdanning"], ["SKILLS", "Kompetanse"]]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ["Sammendrag", "Kompetanse", "Arbeidserfaring", "Utdanning"]);
});
