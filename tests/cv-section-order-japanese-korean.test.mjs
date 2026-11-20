// tests/cv-section-order-japanese-korean.test.mjs — the section-order guard and cv.sections must read
// Japanese and Korean section titles, the way they already read English, Polish,
// Spanish, Italian, Chinese and Portuguese.
//
// SECTION_ALIASES had no Japanese and Korean entries, so a CV built with modes/ja/ or modes/ko/
// resolved no section key: `cv.sections` in config/profile.yml warned that it
// "matched no section in this CV" and the configured order was silently not
// applied, and the order guard compared raw titles instead of the canonical
// modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-japanese-korean.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="ja">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## 職務要約\n\n## 学歴\n\n## コアスキル\n\n## 職務経歴\n';

test('sectionKey resolves the Japanese and Korean spellings CVs use', () => {
  const cases = [
    ['職務要約', 'summary'], ['自己PR', 'summary'], ['プロフィール', 'summary'], ['요약', 'summary'], ['자기소개', 'summary'],
    ['コアスキル', 'competencies'], ['핵심 역량', 'competencies'],
    ['職務経歴', 'experience'], ['職歴', 'experience'], ['경력', 'experience'], ['경력 사항', 'experience'],
    ['プロジェクト', 'projects'], ['주요 프로젝트', 'projects'],
    ['学歴', 'education'], ['학력', 'education'],
    ['資格', 'certifications'], ['資格・免許', 'certifications'], ['자격증', 'certifications'],
    ['受賞歴', 'awards'], ['수상 경력', 'awards'],
    ['スキル', 'skills'], ['テクニカルスキル', 'skills'], ['역량', 'skills'], ['기술 역량', 'skills'],
    ['趣味', 'interests'], ['관심사', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('A Japanese and Korean CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(["職務要約", "コアスキル", "職務経歴", "学歴", "資格", "スキル"]),
    cvMd,
  ));
});

test('a genuinely scrambled Japanese and Korean CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## 職務要約\n\n## コアスキル\n\n## 職務経歴\n\n## 学歴\n';
  assert.throws(
    () => validateCvSectionOrder(html(["学歴", "職務経歴", "コアスキル", "職務要約"]), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a Japanese and Korean CV', () => {
  const input = sections([["PROFESSIONAL SUMMARY", "요약"], ["WORK EXPERIENCE", "경력"], ["EDUCATION", "학력"], ["SKILLS", "역량"]]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ["요약", "역량", "경력", "학력"]);
});
