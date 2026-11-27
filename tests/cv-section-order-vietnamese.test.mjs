// tests/cv-section-order-vietnamese.test.mjs — the section-order guard and cv.sections must read
// Vietnamese section titles, the way they already read the other languages
// the alias table covers.
//
// SECTION_ALIASES had no Vietnamese entries, so a CV built with modes/vi/
// resolved no section key: `cv.sections` in config/profile.yml warned that it
// "matched no section in this CV" and the configured order was silently not
// applied, and the order guard compared raw titles instead of the canonical
// modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-vietnamese.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="vi">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## Tóm tắt\n\n## Học vấn\n\n## Năng lực cốt lõi\n\n## Kinh nghiệm làm việc\n';

test('sectionKey resolves the Vietnamese spellings CVs use', () => {
  const cases = [
    ['Tóm tắt', 'summary'], ['Giới thiệu bản thân', 'summary'], ['Mục tiêu nghề nghiệp', 'summary'],
    ['Năng lực cốt lõi', 'competencies'],
    ['Kinh nghiệm làm việc', 'experience'], ['Kinh nghiệm', 'experience'], ['Lịch sử nghề nghiệp', 'experience'], ['Quá trình làm việc', 'experience'],
    ['Dự án', 'projects'], ['Dự án tiêu biểu', 'projects'],
    ['Học vấn', 'education'], ['Trình độ học vấn', 'education'],
    ['Chứng chỉ', 'certifications'], ['Giải thưởng', 'awards'],
    ['Kỹ năng', 'skills'], ['Kỹ năng chuyên môn', 'skills'], ['Ky nang', 'skills'],
    ['Sở thích', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('A Vietnamese CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(["Tóm tắt", "Năng lực cốt lõi", "Kinh nghiệm làm việc", "Học vấn", "Chứng chỉ", "Kỹ năng"]),
    cvMd,
  ));
});

test('a genuinely scrambled Vietnamese CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Tóm tắt\n\n## Năng lực cốt lõi\n\n## Kinh nghiệm làm việc\n\n## Học vấn\n';
  assert.throws(
    () => validateCvSectionOrder(html(["Học vấn", "Kinh nghiệm làm việc", "Năng lực cốt lõi", "Tóm tắt"]), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a Vietnamese CV', () => {
  const input = sections([["PROFESSIONAL SUMMARY", "Tóm tắt"], ["WORK EXPERIENCE", "Kinh nghiệm làm việc"], ["EDUCATION", "Học vấn"], ["SKILLS", "Kỹ năng"]]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ["Tóm tắt", "Kỹ năng", "Kinh nghiệm làm việc", "Học vấn"]);
});
