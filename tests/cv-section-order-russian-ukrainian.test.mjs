// tests/cv-section-order-russian-ukrainian.test.mjs — the section-order guard and cv.sections must read
// Russian and Ukrainian section titles, the way they already read English, Polish,
// Spanish, Italian, Chinese and Portuguese.
//
// SECTION_ALIASES had no Russian and Ukrainian entries, so a CV built with modes/ru/ or modes/ua/
// resolved no section key: `cv.sections` in config/profile.yml warned that it
// "matched no section in this CV" and the configured order was silently not
// applied, and the order guard compared raw titles instead of the canonical
// modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-russian-ukrainian.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="ru">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## О себе\n\n## Образование\n\n## Ключевые навыки\n\n## Опыт работы\n';

test('sectionKey resolves the Russian and Ukrainian spellings CVs use', () => {
  const cases = [
    ['О себе', 'summary'], ['Обо мне', 'summary'], ['Профиль', 'summary'], ['Про себе', 'summary'], ['Профіль', 'summary'],
    ['Ключевые навыки', 'competencies'], ['Ключевые компетенции', 'competencies'], ['Ключові навички', 'competencies'], ['Компетенції', 'competencies'],
    ['Опыт работы', 'experience'], ['Профессиональный опыт', 'experience'], ['Досвід роботи', 'experience'], ['Професійний досвід', 'experience'],
    ['Проекты', 'projects'], ['Проєкти', 'projects'], ['Проекти', 'projects'],
    ['Образование', 'education'], ['Освіта', 'education'],
    ['Сертификаты', 'certifications'], ['Сертифікати', 'certifications'], ['Награды', 'awards'], ['Нагороди', 'awards'],
    ['Навыки', 'skills'], ['Технические навыки', 'skills'], ['Навички', 'skills'], ['Технічні навички', 'skills'],
    ['Интересы', 'interests'], ['Хобби', 'interests'], ['Інтереси', 'interests'], ['Хобі', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('A Russian and Ukrainian CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(["О себе", "Ключевые навыки", "Опыт работы", "Образование", "Сертификаты", "Навыки"]),
    cvMd,
  ));
});

test('a genuinely scrambled Russian and Ukrainian CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## О себе\n\n## Ключевые навыки\n\n## Опыт работы\n\n## Образование\n';
  assert.throws(
    () => validateCvSectionOrder(html(["Образование", "Опыт работы", "Ключевые навыки", "О себе"]), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a Russian and Ukrainian CV', () => {
  const input = sections([["PROFESSIONAL SUMMARY", "Про себе"], ["WORK EXPERIENCE", "Досвід роботи"], ["EDUCATION", "Освіта"], ["SKILLS", "Навички"]]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ["Про себе", "Навички", "Досвід роботи", "Освіта"]);
});
