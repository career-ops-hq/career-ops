// tests/cv-markdown-zh-headings.test.mjs — a Chinese cv.md must expose its
// Experience and Skills sections to the checks that read cv.md.
//
// generate-pdf.mjs and verify-ats.mjs already read 工作经历 and 技能 as the
// Experience and Skills sections, and jd-skill-gap.mjs reads Chinese
// requirement headings in a JD. The cv.md readers did not: lib/cv-markdown.mjs
// knew English and Spanish Experience names only, so cv-title-check and
// verify-cv-structure reported "did not run" for a Chinese cv.md, and
// jd-skill-gap never filled "already in Skills section".
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

function cvWithSkillsHeading(heading) {
  return [
    '# 张三',
    '',
    '## 工作经历',
    '',
    '### 示例科技 — 上海',
    '**后端工程师**',
    '2021年3月 - 至今',
    '',
    '- 使用 Python 开发内部工具',
    '',
    heading,
    '',
    '- 编程语言：Go、Python',
    '- 中间件：Kafka、Redis',
  ].join('\n');
}

for (const heading of [
  '## 技能', '## 专业技能', '## 技术技能', '## 专长', '## 技术能力', '## 技术栈',
  '## 專業技能', '## 專長', '## 技術能力', '## 技術棧', '### 技能清单', '## **技能**',
  '### 技术栈', '### 技術棧',
]) {
  test(`"${heading}" opens a named skills section`, () => {
    const { existing, supportedByResume, gap } = classifySkillGaps(JD_SKILLS, cvWithSkillsHeading(heading));
    assert.deepEqual(existing.sort(), ['Go', 'Kafka'], `existing under ${heading}`);
    assert.deepEqual(supportedByResume, [], `nothing is left in prose under ${heading}`);
    assert.deepEqual(gap, ['Rust'], `gap under ${heading}`);
  });
}

test('control: without a skills heading the same lines are resume prose', () => {
  const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, cvWithSkillsHeading('## 其他'));
  assert.deepEqual(existing, []);
  assert.deepEqual(supportedByResume.sort(), ['Go', 'Kafka']);
});

test('a level-3 employer named with 技术栈 is not a skills section', () => {
  const cv = ['## 工作经历', '', '### 技术栈科技 — 上海', '', '- 使用 Go 和 Kafka 开发订单服务'].join('\n');
  const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, cv);
  assert.deepEqual(existing, []);
  assert.deepEqual(supportedByResume.sort(), ['Go', 'Kafka']);
});

for (const employer of ['### 技能培训有限公司 — 上海', '### 专长咨询 - 北京', '### 技術能力研究院 – 台北']) {
  test(`the employer entry "${employer}" is not a skills section`, () => {
    const cv = ['## 工作经历', '', employer, '', '- 使用 Go 和 Kafka 开发订单服务'].join('\n');
    const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, cv);
    assert.deepEqual(existing, []);
    assert.deepEqual(supportedByResume.sort(), ['Go', 'Kafka']);
  });
}

test('a dashed sub-heading inside a skills section is still a skills section', () => {
  const cv = [
    '## 工作经历', '', '### 示例科技 — 上海', '**后端工程师**', '', '- 使用 Python 开发内部工具', '',
    '## 专业技能', '', '- 编程语言：Python', '', '### 专业技能 — 后端', '', '- 中间件：Go、Kafka',
  ].join('\n');
  const { existing, supportedByResume } = classifySkillGaps(JD_SKILLS, cv);
  assert.deepEqual(existing.sort(), ['Go', 'Kafka']);
  assert.deepEqual(supportedByResume, []);
});

for (const name of ['工作经历', '工作经验', '专业经历', '工作經歷', '工作經驗', '專業經歷']) {
  test(`"${name}" is an Experience heading`, () => {
    assert.ok(isExperienceHeading(name), `isExperienceHeading(${name})`);
    assert.ok(EXPERIENCE_HEADING_NAMES.includes(name), `EXPERIENCE_HEADING_NAMES lists ${name}`);
  });
}

for (const name of ['项目经历', '教育经历', '实习经历与工作经历', '工作经历总结', '經歷']) {
  test(`"${name}" is not an Experience heading`, () => {
    assert.equal(isExperienceHeading(name), false);
  });
}

test('a Chinese Experience section is found, up to the next level-2 heading', () => {
  const sections = findExperienceSections(cvWithSkillsHeading('## 技能'));
  assert.equal(sections.length, 1, 'one Experience section found');
  const lines = sections.flat();
  assert.ok(lines.includes('### 示例科技 — 上海'), 'the entry heading is inside the section');
  assert.ok(!lines.some((line) => line.includes('编程语言')), 'the skills section is not part of it');
});

test('cv-title-check compares titles against a Chinese cv.md', () => {
  const cvEntries = parseCvExperience(cvWithSkillsHeading('## 技能'));
  assert.equal(cvEntries.length, 1, 'one cv.md entry parsed');
  const result = checkTitles(cvEntries, [
    { company: '示例科技', title: '后端技术负责人', dates: '2021年3月 - 至今' },
  ]);
  assert.equal(result.mismatches.length, 1, 'the changed title is reported');
  assert.equal(result.mismatches[0].cvTitle, '后端工程师');
  assert.equal(result.mismatches[0].tailoredTitle, '后端技术负责人');
});
