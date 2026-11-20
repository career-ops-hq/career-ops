// tests/cv-section-order-french.test.mjs — the section-order guard and
// cv.sections must read French section titles, the way they already read
// English, Polish, Spanish, Chinese and Portuguese.
//
// SECTION_ALIASES had no French entries, so a CV built with modes/fr/
// resolved no section key: `cv.sections` in config/profile.yml
// warned that it "matched no section in this CV" and the configured order was
// silently not applied, and the order guard compared raw titles instead of the
// canonical modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-french.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="fr">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## Résumé\n\n## Formation\n\n## Compétences\n\n## Expérience professionnelle\n';

test('sectionKey resolves the French spellings CVs use', () => {
  const cases = [
    ['Résumé', 'summary'], ['Résumé professionnel', 'summary'], ['Profil', 'summary'], ['Profil professionnel', 'summary'], ['À propos de moi', 'summary'],
    ['Compétences', 'competencies'], ['Compétences clés', 'competencies'], ['Compétences principales', 'competencies'],
    ['Expérience professionnelle', 'experience'], ['Expériences professionnelles', 'experience'], ['Expérience', 'experience'], ['Parcours professionnel', 'experience'],
    ['Projets', 'projects'], ['Projets sélectionnés', 'projects'], ['Projets personnels', 'projects'],
    ['Formation', 'education'], ['Formations', 'education'], ['Éducation', 'education'], ['Études', 'education'], ['Diplômes', 'education'],
    ['Certifications', 'certifications'], ['Certificats', 'certifications'],
    ['Distinctions', 'awards'], ['Prix et distinctions', 'awards'],
    ['Compétences techniques', 'skills'], ['Connaissances techniques', 'skills'],
    ["Centres d'intérêt", 'interests'], ['Centres d’intérêt', 'interests'], ['Intérêts', 'interests'], ['Loisirs', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('a French CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(['Résumé', 'Compétences clés', 'Expérience professionnelle', 'Formation', 'Certifications', 'Compétences techniques']),
    cvMd,
  ));
});

test('a genuinely scrambled French CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Résumé\n\n## Compétences\n\n## Expérience professionnelle\n\n## Formation\n';
  assert.throws(
    () => validateCvSectionOrder(html(['Formation', 'Expérience professionnelle', 'Compétences', 'Résumé']), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a French CV', () => {
  const input = sections([
    ['PROFESSIONAL SUMMARY', 'Résumé'],
    ['WORK EXPERIENCE', 'Expérience professionnelle'],
    ['EDUCATION', 'Formation'],
    ['SKILLS', 'Compétences techniques'],
  ]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ['Résumé', 'Compétences techniques', 'Expérience professionnelle', 'Formation']);
});

test('cv.sections moves the interests heading written with a typographic apostrophe', () => {
  const input = sections([
    ['PROFESSIONAL SUMMARY', 'Résumé'],
    ['SKILLS', 'Compétences techniques'],
    ['INTERESTS', 'Centres d’intérêt'],
  ]);
  const out = reorderCvSections(input, ['summary', 'interests', 'skills']);
  assert.deepEqual(renderedTitles(out), ['Résumé', 'Centres d’intérêt', 'Compétences techniques']);
});
