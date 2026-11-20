// tests/cv-section-order-portuguese.test.mjs — the section-order guard and
// cv.sections must read Portuguese section titles, the way they already read
// English, Polish, Spanish and Chinese.
//
// SECTION_ALIASES had no Portuguese entries, so a pt-BR CV built with
// modes/pt/ resolved no section key: `cv.sections` in config/profile.yml
// warned that it "matched no section in this CV" and the configured order was
// silently not applied, and the order guard compared raw titles instead of the
// canonical modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-portuguese.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="pt-BR">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## Resumo Profissional\n\n## Formação\n\n## Competências\n\n## Experiência Profissional\n';

test('sectionKey resolves the Portuguese spellings generated CVs actually use', () => {
  const cases = [
    ['Resumo Profissional', 'summary'], ['Resumo', 'summary'], ['Perfil Profissional', 'summary'], ['Sobre Mim', 'summary'],
    ['Competências Principais', 'competencies'], ['Competências-Chave', 'competencies'], ['Competências', 'competencies'],
    ['Experiência Profissional', 'experience'], ['Experiencia Profissional', 'experience'], ['Histórico Profissional', 'experience'],
    ['Projetos', 'projects'], ['Projetos Pessoais', 'projects'],
    ['Formação', 'education'], ['Formação Acadêmica', 'education'], ['Formação Académica', 'education'], ['Educação', 'education'],
    ['Certificações', 'certifications'], ['Certificados', 'certifications'],
    ['Prêmios e Reconhecimentos', 'awards'],
    ['Competências Técnicas', 'skills'], ['Habilidades Técnicas', 'skills'], ['Conhecimentos Técnicos', 'skills'],
    ['Interesses', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('a Portuguese CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(['Resumo Profissional', 'Competências Principais', 'Experiência Profissional', 'Formação', 'Certificações', 'Competências Técnicas']),
    cvMd,
  ));
});

test('a genuinely scrambled Portuguese CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Resumo Profissional\n\n## Competências\n\n## Experiência Profissional\n\n## Formação\n';
  assert.throws(
    () => validateCvSectionOrder(html(['Formação', 'Experiência Profissional', 'Competências', 'Resumo Profissional']), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a Portuguese CV', () => {
  const input = sections([
    ['PROFESSIONAL SUMMARY', 'Resumo Profissional'],
    ['WORK EXPERIENCE', 'Experiência Profissional'],
    ['EDUCATION', 'Formação'],
    ['SKILLS', 'Competências Técnicas'],
  ]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ['Resumo Profissional', 'Competências Técnicas', 'Experiência Profissional', 'Formação']);
});
