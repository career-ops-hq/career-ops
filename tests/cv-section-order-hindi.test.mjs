// tests/cv-section-order-hindi.test.mjs — the section-order guard and cv.sections must read
// Hindi section titles, the way they already read the other languages
// the alias table covers.
//
// SECTION_ALIASES had no Hindi entries, so a CV built with modes/hi/
// resolved no section key: `cv.sections` in config/profile.yml warned that it
// "matched no section in this CV" and the configured order was silently not
// applied, and the order guard compared raw titles instead of the canonical
// modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-hindi.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="hi">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## सारांश\n\n## शिक्षा\n\n## मुख्य दक्षताएं\n\n## कार्य अनुभव\n';

test('sectionKey resolves the Hindi spellings CVs use', () => {
  const cases = [
    ['सारांश', 'summary'], ['पेशेवर सारांश', 'summary'], ['प्रोफ़ाइल', 'summary'], ['प्रोफाइल', 'summary'],
    ['मुख्य दक्षताएं', 'competencies'], ['मुख्य दक्षताएँ', 'competencies'],
    ['कार्य अनुभव', 'experience'], ['व्यावसायिक अनुभव', 'experience'], ['करियर इतिहास', 'experience'],
    ['परियोजनाएं', 'projects'], ['परियोजनाएँ', 'projects'], ['शिक्षा', 'education'], ['शैक्षिक योग्यता', 'education'],
    ['प्रमाणपत्र', 'certifications'], ['पुरस्कार', 'awards'],
    ['कौशल', 'skills'], ['तकनीकी कौशल', 'skills'],
    ['रुचियां', 'interests'], ['रुचियाँ', 'interests'], ['शौक', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('A Hindi CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(["सारांश", "मुख्य दक्षताएं", "कार्य अनुभव", "शिक्षा", "प्रमाणपत्र", "कौशल"]),
    cvMd,
  ));
});

test('a genuinely scrambled Hindi CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## सारांश\n\n## मुख्य दक्षताएं\n\n## कार्य अनुभव\n\n## शिक्षा\n';
  assert.throws(
    () => validateCvSectionOrder(html(["शिक्षा", "कार्य अनुभव", "मुख्य दक्षताएं", "सारांश"]), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a Hindi CV', () => {
  const input = sections([["PROFESSIONAL SUMMARY", "सारांश"], ["WORK EXPERIENCE", "कार्य अनुभव"], ["EDUCATION", "शिक्षा"], ["SKILLS", "कौशल"]]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ["सारांश", "कौशल", "कार्य अनुभव", "शिक्षा"]);
});
