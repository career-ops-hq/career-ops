// tests/cv-section-order-dutch.test.mjs — the section-order guard and
// cv.sections must read Dutch section titles, the way they already read
// English, Polish, Spanish, Chinese and Portuguese.
//
// SECTION_ALIASES had no Dutch entries, so a CV built with modes/nl/
// resolved no section key: `cv.sections` in config/profile.yml
// warned that it "matched no section in this CV" and the configured order was
// silently not applied, and the order guard compared raw titles instead of the
// canonical modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-dutch.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="nl">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## Profiel\n\n## Opleiding\n\n## Competenties\n\n## Werkervaring\n';

test('sectionKey resolves the Dutch spellings CVs use', () => {
  const cases = [
    ['Profiel', 'summary'], ['Persoonlijk profiel', 'summary'], ['Samenvatting', 'summary'], ['Over mij', 'summary'],
    ['Kerncompetenties', 'competencies'], ['Competenties', 'competencies'],
    ['Werkervaring', 'experience'], ['Professionele ervaring', 'experience'], ['Ervaring', 'experience'], ['Loopbaan', 'experience'],
    ['Projecten', 'projects'], ['Geselecteerde projecten', 'projects'],
    ['Opleiding', 'education'], ['Opleidingen', 'education'], ['Onderwijs', 'education'],
    ['Certificaten', 'certifications'], ['Certificeringen', 'certifications'],
    ['Prijzen', 'awards'], ['Onderscheidingen', 'awards'],
    ['Vaardigheden', 'skills'], ['Technische vaardigheden', 'skills'], ['Kennis en vaardigheden', 'skills'],
    ['Interesses', 'interests'], ["Hobby's", 'interests'], ['Hobby’s', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('a Dutch CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(['Profiel', 'Kerncompetenties', 'Werkervaring', 'Opleiding', 'Certificaten', 'Vaardigheden']),
    cvMd,
  ));
});

test('a genuinely scrambled Dutch CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Profiel\n\n## Competenties\n\n## Werkervaring\n\n## Opleiding\n';
  assert.throws(
    () => validateCvSectionOrder(html(['Opleiding', 'Werkervaring', 'Competenties', 'Profiel']), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a Dutch CV', () => {
  const input = sections([
    ['PROFESSIONAL SUMMARY', 'Profiel'],
    ['WORK EXPERIENCE', 'Werkervaring'],
    ['EDUCATION', 'Opleiding'],
    ['SKILLS', 'Vaardigheden'],
  ]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ['Profiel', 'Vaardigheden', 'Werkervaring', 'Opleiding']);
});

test('cv.sections moves "Hobby’s" with either apostrophe', () => {
  for (const hobbies of ["Hobby's", 'Hobby’s']) {
    const input = sections([
      ['PROFESSIONAL SUMMARY', 'Profiel'],
      ['SKILLS', 'Vaardigheden'],
      ['INTERESTS', hobbies],
    ]);
    const out = reorderCvSections(input, ['summary', 'interests', 'skills']);
    assert.deepEqual(renderedTitles(out), ['Profiel', hobbies, 'Vaardigheden'], hobbies);
  }
});
