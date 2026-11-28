// tests/cv-checks-section-aliases.test.mjs — the cv.md checks read every
// Experience and Skills title the PDF build reads.
//
// generate-pdf.mjs's SECTION_ALIASES maps German, French, Dutch, Danish,
// Norwegian, Russian, Ukrainian, Japanese, Korean, Turkish, Vietnamese,
// Indonesian, Hindi and Arabic titles to `experience` and `skills`, but
// lib/cv-markdown.mjs and jd-skill-gap.mjs kept their own lists, which knew
// English, Spanish, Chinese, Polish, Portuguese and Italian only. A cv.md whose
// Experience section is "## Berufserfahrung" rendered as Experience, while
// cv-title-check reported "title check did not run", verify-cv-structure
// reported UNVERIFIED and doctor warned that no Experience section was found.
// jd-skill-gap never filled "already in Skills section" under "## Kenntnisse".
//
// The table now lives in lib/cv-section-aliases.mjs and the checks read it, so
// these tests walk the table itself: a title added there is covered here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { SECTION_ALIAS_ENTRIES, aliasSectionKey } from '../lib/cv-section-aliases.mjs';
import { sectionKey } from '../generate-pdf.mjs';
import { findExperienceSections, isExperienceHeading } from '../lib/cv-markdown.mjs';
import { classifySkillGaps } from '../jd-skill-gap.mjs';
import { parseCvExperience, checkTitles } from '../cv-title-check.mjs';

const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

const titled = (alias) => alias.replace(/(^|\s)(\p{Ll})/gu, (_, space, letter) => space + letter.toUpperCase());
const aliasesFor = (key) => SECTION_ALIAS_ENTRIES.filter(([, k]) => k === key).map(([alias]) => alias);

test('the table is the one generate-pdf.mjs renders with', () => {
  for (const [alias, key] of SECTION_ALIAS_ENTRIES) {
    assert.equal(aliasSectionKey(alias), key, alias);
    assert.equal(sectionKey(alias), key, alias);
  }
});

test('every title the table maps to experience is an Experience heading, in any case', () => {
  const titles = aliasesFor('experience');
  assert.ok(titles.length > 50, `found ${titles.length} experience titles`);
  for (const alias of titles) {
    assert.ok(isExperienceHeading(alias), alias);
    assert.ok(isExperienceHeading(titled(alias)), titled(alias));
  }
});

const JD_SKILLS = ['Go', 'Kafka', 'Rust'];
const skillsCv = (heading) => ['# CV', '', '## Experience', '', '### Acme — Remote', '**Engineer**', '2021 - 2024', '',
  '- Python', '', heading, '', '- Go, Python', '- Kafka, Redis'].join('\n');

test('every title the table maps to skills opens a named skills section', () => {
  const titles = aliasesFor('skills');
  assert.ok(titles.length > 40, `found ${titles.length} skills titles`);
  for (const alias of titles) {
    for (const heading of [`## ${alias}`, `## ${titled(alias)}`]) {
      const { existing, supportedByResume, gap } = classifySkillGaps(JD_SKILLS, skillsCv(heading));
      assert.deepEqual(existing.sort(), ['Go', 'Kafka'], heading);
      assert.deepEqual(supportedByResume, [], heading);
      assert.deepEqual(gap, ['Rust'], heading);
    }
  }
});

test('control: a heading outside the table leaves the same lines in resume prose', () => {
  const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, skillsCv('## Sonstiges'));
  assert.deepEqual(existing, []);
  assert.deepEqual(supportedByResume.sort(), ['Go', 'Kafka']);
});

test('a longer or narrower title is not read as the section it starts with', () => {
  for (const name of ['Berufserfahrung und Projekte', 'Expérience associative', 'Doświadczenie projektowe', 'Опыт волонтёрства']) {
    assert.equal(isExperienceHeading(name), false, name);
  }
});

test('an employer entry named like a skills title keeps its bullets in resume prose', () => {
  const text = ['## Berufserfahrung', '', '### Kenntnisse GmbH — Berlin', '', '- Go, Kafka'].join('\n');
  const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, text);
  assert.deepEqual(existing, []);
  assert.deepEqual(supportedByResume.sort(), ['Go', 'Kafka']);
});

const LANGUAGES = [
  { name: 'German', experience: '## Berufserfahrung', entry: '### Beispiel GmbH — Berlin', company: 'Beispiel GmbH', title: 'Backend-Entwickler', newTitle: 'Teamleiter Backend', dates: '03/2021 - heute' },
  { name: 'French', experience: '## Expérience professionnelle', entry: '### Exemple SAS — Paris', company: 'Exemple SAS', title: 'Ingénieur backend', newTitle: 'Responsable technique', dates: '03/2021 - présent' },
  { name: 'Dutch', experience: '## Werkervaring', entry: '### Voorbeeld B.V. — Utrecht', company: 'Voorbeeld B.V.', title: 'Backend-ontwikkelaar', newTitle: 'Teamleider backend', dates: '03/2021 - heden' },
  { name: 'Russian', experience: '## Опыт работы', entry: '### Пример — Москва', company: 'Пример', title: 'Backend-разработчик', newTitle: 'Руководитель группы', dates: '03/2021 - н.в.' },
  { name: 'Japanese', experience: '## 職務経歴', entry: '### 株式会社サンプル — 東京', company: '株式会社サンプル', title: 'バックエンドエンジニア', newTitle: 'テックリード', dates: '2021/03 - 現在' },
  { name: 'Turkish', experience: '## İş Deneyimi', entry: '### Örnek A.Ş. — İstanbul', company: 'Örnek A.Ş.', title: 'Backend Geliştirici', newTitle: 'Takım Lideri', dates: '03/2021 - devam' },
  { name: 'Arabic', experience: '## الخبرة المهنية', entry: '### شركة مثال — دبي', company: 'شركة مثال', title: 'مهندس برمجيات', newTitle: 'قائد فريق', dates: '03/2021 - الآن' },
];

const cv = (lang) => ['# CV', '', lang.experience, '', lang.entry, `**${lang.title}**`, lang.dates, '', '- Python', '',
  '## Education', '', '- MSc'].join('\n');

for (const lang of LANGUAGES) {
  test(`${lang.name}: the Experience section is found and cv-title-check compares its titles`, () => {
    const sections = findExperienceSections(cv(lang));
    assert.equal(sections.length, 1);
    assert.ok(sections.flat().includes(lang.entry));
    const entries = parseCvExperience(cv(lang));
    assert.equal(entries.length, 1);
    const result = checkTitles(entries, [{ company: lang.company, title: lang.newTitle, dates: lang.dates }]);
    assert.equal(result.mismatches.length, 1);
    assert.equal(result.mismatches[0].cvTitle, lang.title);
  });
}

test('doctor finds the Experience section of a German cv.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-checks-aliases-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'cv.md'), cv(LANGUAGES[0]));
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = dir;
  const r = spawnSync(NODE, [join(ROOT, 'doctor.mjs')], { cwd: dir, env, encoding: 'utf-8', timeout: 60000 });
  assert.equal(r.error, undefined, describeSpawn(r));
  assert.doesNotMatch(r.stdout + r.stderr, /no Experience section the CV checks recognize/, describeSpawn(r));
  // The check ran and passed, not merely stayed silent: an early exit before
  // the cv.md check would also leave the warning out.
  assert.match(r.stdout, /cv\.md: Experience section recognized \(1 entry\)/, describeSpawn(r));
});

// generate-pdf.mjs's sectionKey() strips emphasis markers before its lookup,
// so an italic title is the same section there and here.
test('an emphasized title reads as the plain one, as in the PDF build', () => {
  for (const heading of ['*Kenntnisse*', '_Kenntnisse_', '`Kenntnisse`']) {
    assert.equal(sectionKey(heading), 'skills', heading);
    assert.equal(aliasSectionKey(heading), 'skills', heading);
    const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, skillsCv(`## ${heading}`));
    assert.deepEqual(existing.sort(), ['Go', 'Kafka'], heading);
    assert.deepEqual(supportedByResume, [], heading);
  }
  assert.ok(isExperienceHeading('*Berufserfahrung*'));
});
