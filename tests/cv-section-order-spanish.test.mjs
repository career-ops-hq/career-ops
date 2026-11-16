// tests/cv-section-order-spanish.test.mjs — the section-order guard must read
// Spanish section titles, the way it already reads English, Polish and Chinese.
//
// SECTION_ALIASES had no Spanish entries, so every Spanish title fell through
// sectionKey()'s "return the normalized title" branch. The guard then never
// reached its canonical modes/pdf.md order (Experience before Education), and a
// Spanish CV rendered in exactly that documented order was rejected against a
// cv.md that lists Formación first:
//
//   CV section order diverges from cv.md: rendered perfil profesional ->
//   competencias -> experiencia profesional -> formación; cv.md perfil
//   profesional -> formación -> competencias -> experiencia profesional
//
// The only way through was --allow-reorder, which also silences a genuinely
// scrambled CV — the escape hatch was doing the alias table's job.
//
// Run:  node --test tests/cv-section-order-spanish.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
const cvMd = '# CV\n\n## Perfil Profesional\n\n## Formación\n\n## Competencias\n\n## Experiencia Profesional\n';

test('a Spanish CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(['Perfil Profesional', 'Competencias Clave', 'Experiencia Profesional', 'Formación', 'Certificaciones', 'Habilidades']),
    cvMd,
  ));
});

test('a genuinely scrambled Spanish CV is still rejected', () => {
  // Diverges from cv.md (Experiencia before Competencias) AND from the canonical
  // order (Competencias after Experiencia), so neither target accepts it.
  const expFirstMd = '# CV\n\n## Perfil Profesional\n\n## Competencias\n\n## Experiencia Profesional\n\n## Formación\n';
  assert.throws(
    () => validateCvSectionOrder(html(['Formación', 'Experiencia Profesional', 'Competencias', 'Perfil Profesional']), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('sectionKey resolves the Spanish spellings generated CVs actually use', () => {
  const cases = [
    ['Perfil Profesional', 'summary'], ['Resumen Profesional', 'summary'],
    ['Competencias', 'competencies'], ['Competencias Clave', 'competencies'],
    ['Experiencia Profesional', 'experience'], ['Experiencia Laboral', 'experience'],
    ['Proyectos', 'projects'], ['Proyectos y Laboratorios', 'projects'],
    ['Formación', 'education'], ['Formacion', 'education'], ['Educación', 'education'],
    ['Certificaciones', 'certifications'],
    ['Premios y Reconocimientos', 'awards'],
    ['Habilidades', 'skills'], ['Habilidades Técnicas', 'skills'], ['Herramientas e Idiomas', 'skills'],
    ['Intereses', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});
