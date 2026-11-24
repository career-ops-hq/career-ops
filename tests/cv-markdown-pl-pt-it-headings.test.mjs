// tests/cv-markdown-pl-pt-it-headings.test.mjs — a Polish, Portuguese or
// Italian cv.md must expose its Experience and Skills sections to the checks
// that read cv.md.
//
// generate-pdf.mjs's SECTION_ALIASES reads these languages' Experience and
// Skills titles for modes/pl, modes/pt and modes/it, but lib/cv-markdown.mjs
// knew English, Spanish and Chinese Experience names only, so cv-title-check
// and verify-cv-structure reported "did not run" for such a cv.md, and
// jd-skill-gap never filled "already in Skills section". The Spanish (#5664)
// and Chinese (#6925) names closed the same gap for their languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

const { classifySkillGaps } = await import(pathToFileURL(join(ROOT, 'jd-skill-gap.mjs')).href);
const { findExperienceSections, isExperienceHeading, EXPERIENCE_HEADING_NAMES } = await import(
  pathToFileURL(join(ROOT, 'lib', 'cv-markdown.mjs')).href
);
const { parseCvExperience, checkTitles } = await import(pathToFileURL(join(ROOT, 'cv-title-check.mjs')).href);

const JD_SKILLS = ['Go', 'Kafka', 'Rust'];

const LANGUAGES = [
  {
    name: 'Polish',
    experience: '## Doświadczenie zawodowe',
    entry: '### Przykład sp. z o.o. — Warszawa',
    company: 'Przykład sp. z o.o.',
    title: 'Inżynier backend',
    newTitle: 'Lider zespołu backend',
    dates: '03/2021 - obecnie',
    skills: ['## Umiejętności', '## Umiejętności techniczne', '## Kompetencje kluczowe', '## Kluczowe kompetencje'],
    names: ['Doświadczenie', 'Doświadczenie zawodowe', 'Przebieg kariery'],
    notExperience: ['Doświadczenie projektowe', 'Projekty'],
  },
  {
    name: 'Portuguese',
    experience: '## Experiência Profissional',
    entry: '### Exemplo Ltda — São Paulo',
    company: 'Exemplo Ltda',
    title: 'Engenheiro de Backend',
    newTitle: 'Líder Técnico de Backend',
    dates: '03/2021 - atual',
    skills: ['## Competências Técnicas', '## Competências', '## Conhecimentos Técnicos', '## Habilidades'],
    names: ['Experiência', 'Experiência Profissional', 'Experiências Profissionais', 'Histórico Profissional'],
    notExperience: ['Experiência Acadêmica', 'Projetos'],
  },
  {
    name: 'Italian',
    experience: '## Esperienza professionale',
    entry: '### Esempio S.r.l. — Milano',
    company: 'Esempio S.r.l.',
    title: 'Ingegnere backend',
    newTitle: 'Responsabile tecnico backend',
    dates: '03/2021 - oggi',
    skills: ['## Competenze tecniche', '## Competenze', '## Conoscenze tecniche', '## Capacità tecniche'],
    names: ['Esperienza', 'Esperienza professionale', 'Esperienze professionali', 'Esperienza lavorativa', 'Esperienze lavorative', 'Percorso professionale'],
    notExperience: ['Esperienza di volontariato', 'Progetti'],
  },
];

function cv(lang, skillsHeading) {
  return [
    '# CV', '',
    lang.experience, '',
    lang.entry, `**${lang.title}**`, lang.dates, '',
    '- Python', '',
    skillsHeading, '',
    '- Go, Python',
    '- Kafka, Redis',
  ].join('\n');
}

for (const lang of LANGUAGES) {
  for (const name of lang.names) {
    test(`${lang.name}: "${name}" is an Experience heading`, () => {
      assert.ok(isExperienceHeading(name), `isExperienceHeading(${name})`);
      assert.ok(EXPERIENCE_HEADING_NAMES.includes(name), `EXPERIENCE_HEADING_NAMES lists ${name}`);
    });
  }

  for (const name of lang.notExperience) {
    test(`${lang.name}: "${name}" is not an Experience heading`, () => {
      assert.equal(isExperienceHeading(name), false);
    });
  }

  test(`${lang.name}: the Experience section is found, up to the next level-2 heading`, () => {
    const sections = findExperienceSections(cv(lang, lang.skills[0]));
    assert.equal(sections.length, 1, 'one Experience section found');
    const lines = sections.flat();
    assert.ok(lines.includes(lang.entry), 'the entry heading is inside the section');
    assert.ok(!lines.some((line) => line.includes('Kafka')), 'the skills section is not part of it');
  });

  test(`${lang.name}: cv-title-check compares titles against the cv.md`, () => {
    const cvEntries = parseCvExperience(cv(lang, lang.skills[0]));
    assert.equal(cvEntries.length, 1, 'one cv.md entry parsed');
    const result = checkTitles(cvEntries, [{ company: lang.company, title: lang.newTitle, dates: lang.dates }]);
    assert.equal(result.mismatches.length, 1, 'the changed title is reported');
    assert.equal(result.mismatches[0].cvTitle, lang.title);
    assert.equal(result.mismatches[0].tailoredTitle, lang.newTitle);
  });

  for (const heading of lang.skills) {
    test(`${lang.name}: "${heading}" opens a named skills section`, () => {
      const { existing, supportedByResume, gap } = classifySkillGaps(JD_SKILLS, cv(lang, heading));
      assert.deepEqual(existing.sort(), ['Go', 'Kafka'], `existing under ${heading}`);
      assert.deepEqual(supportedByResume, [], `nothing is left in prose under ${heading}`);
      assert.deepEqual(gap, ['Rust'], `gap under ${heading}`);
    });
  }
}

test('control: without a skills heading the same lines are resume prose', () => {
  const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, cv(LANGUAGES[0], '## Inne'));
  assert.deepEqual(existing, []);
  assert.deepEqual(supportedByResume.sort(), ['Go', 'Kafka']);
});

test('a heading written with combining accents reads as the precomposed name', () => {
  assert.ok(isExperienceHeading('Experie\u0302ncia Profissional'), 'decomposed Experiência Profissional');
  assert.ok(isExperienceHeading('Dos\u0301wiadczenie zawodowe'), 'decomposed Doświadczenie zawodowe');
  const portuguese = LANGUAGES[1];
  const { existing } = classifySkillGaps(JD_SKILLS, cv(portuguese, '## Compete\u0302ncias Te\u0301cnicas'));
  assert.deepEqual(existing.sort(), ['Go', 'Kafka']);
});

for (const employer of ['### Competenze S.r.l. — Milano', '### Kompetencje Sp. z o.o. — Kraków', '### Competências Ltda — Lisboa']) {
  test(`the employer entry "${employer}" is not a skills section`, () => {
    const text = ['## Doświadczenie zawodowe', '', employer, '', '- Go, Kafka'].join('\n');
    const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, text);
    assert.deepEqual(existing, []);
    assert.deepEqual(supportedByResume.sort(), ['Go', 'Kafka']);
  });
}

test('a dashed sub-heading inside a skills section is still a skills section', () => {
  const text = ['## Doświadczenie zawodowe', '', '### Przykład — Warszawa', '**Inżynier**', '', '- Python', '',
    '## Umiejętności', '', '- Python', '', '### Umiejętności — backend', '', '- Go, Kafka'].join('\n');
  const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, text);
  assert.deepEqual(existing.sort(), ['Go', 'Kafka']);
  assert.deepEqual(supportedByResume, []);
});
