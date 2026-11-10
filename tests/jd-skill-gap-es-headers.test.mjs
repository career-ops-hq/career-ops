// tests/jd-skill-gap-es-headers.test.mjs — Spanish (es-419 / es-ES)
// requirement and closing headings must be recognized, and a Spanish cv.md
// must expose its named skills section to the gap classifier.
//
// Before this, REQUIREMENT_HEADER_RE knew only English and CJK headings, so a
// Spanish posting's "Requisitos" block never opened: jd-skill-gap reported
// LOW CONFIDENCE (no-requirements-section) and "JD skills found: 0" for every
// Spanish JD, and every skill the CV listed came back as a gap. The Spanish
// closers matter for the same reason the English ones exist — without them a
// "Beneficios" section stays inside the requirements block and its perks
// ("Bono", "Seguro de vida") are scored as required skills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

const { extractJdSkills, classifySkillGaps } = await import(pathToFileURL(join(ROOT, 'jd-skill-gap.mjs')).href);
const { findExperienceSections, isExperienceHeading, EXPERIENCE_HEADING_NAMES } = await import(
  pathToFileURL(join(ROOT, 'lib', 'cv-markdown.mjs')).href
);

const BULLETS = '\n- Excel\n- Revit\n- Tekla\n';
const EXPECTED = ['Excel', 'Revit', 'Tekla'];

function assertExtracts(jd, label) {
  const found = extractJdSkills(jd).sort();
  assert.deepEqual(found, EXPECTED, `${label}: expected ${EXPECTED.join(', ')}, got ${found.join(', ') || '(none)'}`);
}

test('control: the English heading still works', () => {
  assertExtracts(`Requirements${BULLETS}`, 'en control');
});

for (const heading of [
  'Requisitos', 'REQUISITOS', 'Requisitos del puesto', 'Requisitos mínimos',
  'Requerimientos', 'Requerimientos específicos',
  'Calificaciones', 'Calificaciones requeridas',
  'Que buscamos', 'Qué buscamos', 'Lo que buscamos', 'Lo que necesitas', 'Lo que esperamos',
  'Perfil del cargo', 'Perfil requerido',
  'Conocimientos requeridos', 'Habilidades requeridas', 'Competencias requeridas',
  'Para el puesto',
]) {
  test(`Spanish heading "${heading}" opens a requirements block`, () => {
    assertExtracts(`${heading}${BULLETS}`, heading);
  });
}

// A skill listed after the closer must stay out: if the closer did not match,
// Tekla would leak into the requirements block and the assertion would fail.
function assertClosedBefore(closer) {
  const jd = `Requisitos\n- Excel\n${closer}\n- Tekla\n`;
  assert.deepEqual(extractJdSkills(jd), ['Excel'], `closer "${closer}" did not end the requirements block`);
}

for (const closer of [
  'Beneficios', 'Funciones', 'Qué ofrecemos', 'Cómo postular', 'Como postular',
  'Postulación', 'Proceso de selección', 'Proceso de seleccion',
]) {
  test(`a Spanish closing heading (${closer}) ends the requirements block`, () => {
    assertClosedBefore(closer);
  });
}

test('a Spanish cv.md exposes its named skills section to the classifier', () => {
  const cv = [
    '## Experiencia Laboral',
    '',
    '### Example Corp — Santiago, Chile',
    '',
    '**Ingeniera de Proyectos**',
    '**Enero 2020 – Diciembre 2021**',
    '',
    '## Aptitudes y Habilidades',
    '',
    '### Competencias Técnicas',
    '',
    '- Excel: Avanzado',
    '- Revit: Intermedio',
    '- Tekla: Básico',
  ].join('\n');
  const jdSkills = extractJdSkills(`Requisitos${BULLETS}`);
  const { existing, gap } = classifySkillGaps(jdSkills, cv);
  assert.ok(existing.includes('Excel'), `expected Excel in existing, got ${JSON.stringify(existing)}`);
  assert.ok(existing.includes('Tekla'), `expected Tekla in existing, got ${JSON.stringify(existing)}`);
  assert.ok(!gap.includes('Excel'), 'Excel must not be reported as a gap');
});

test('a Spanish Experience heading is recognized by the CV checks', () => {
  assert.ok(isExperienceHeading('Experiencia Laboral'), 'isExperienceHeading(Experiencia Laboral)');
  assert.ok(isExperienceHeading('Experiencia'), 'isExperienceHeading(Experiencia)');
  assert.ok(isExperienceHeading('EXPERIENCIA PROFESIONAL'), 'isExperienceHeading(EXPERIENCIA PROFESIONAL)');
  assert.ok(EXPERIENCE_HEADING_NAMES.includes('Experiencia Laboral'), 'EXPERIENCE_HEADING_NAMES lists the Spanish name');
  const cv = ['## Experiencia Laboral', '', '### Example Corp — Santiago, Chile', '', '**Ingeniera**', '2020', ''].join('\n');
  const sections = findExperienceSections(cv);
  assert.equal(sections.length, 1, 'one Experience section found');
  const headings = sections.flat().filter((line) => line.startsWith('### '));
  assert.equal(headings.length, 1, 'one entry heading in the Experience section');
  assert.match(headings[0], /Example Corp/, 'the entry heading names the company');
});
