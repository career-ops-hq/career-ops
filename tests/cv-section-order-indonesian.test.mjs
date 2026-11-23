// tests/cv-section-order-indonesian.test.mjs — the section-order guard and cv.sections must read
// Indonesian section titles, the way they already read the other languages
// the alias table covers.
//
// SECTION_ALIASES had no Indonesian entries, so a CV built with modes/id/
// resolved no section key: `cv.sections` in config/profile.yml warned that it
// "matched no section in this CV" and the configured order was silently not
// applied, and the order guard compared raw titles instead of the canonical
// modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-indonesian.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="id">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## Ringkasan\n\n## Pendidikan\n\n## Kompetensi Inti\n\n## Pengalaman Kerja\n';

test('sectionKey resolves the Indonesian spellings CVs use', () => {
  const cases = [
    ['Ringkasan', 'summary'], ['Ringkasan Profesional', 'summary'], ['Tentang Saya', 'summary'], ['Profil', 'summary'],
    ['Kompetensi Inti', 'competencies'], ['Kompetensi Utama', 'competencies'],
    ['Pengalaman Kerja', 'experience'], ['Pengalaman', 'experience'], ['Riwayat Karier', 'experience'], ['Riwayat Pekerjaan', 'experience'],
    ['Proyek', 'projects'], ['Pendidikan', 'education'], ['Riwayat Pendidikan', 'education'],
    ['Sertifikasi', 'certifications'], ['Sertifikat', 'certifications'], ['Penghargaan', 'awards'],
    ['Keahlian', 'skills'], ['Kompetensi', 'skills'], ['Keterampilan', 'skills'], ['Keahlian Teknis', 'skills'],
    ['Minat', 'interests'], ['Hobi', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('An Indonesian CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(["Ringkasan", "Kompetensi Inti", "Pengalaman Kerja", "Pendidikan", "Sertifikasi", "Keahlian"]),
    cvMd,
  ));
});

test('a genuinely scrambled Indonesian CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Ringkasan\n\n## Kompetensi Inti\n\n## Pengalaman Kerja\n\n## Pendidikan\n';
  assert.throws(
    () => validateCvSectionOrder(html(["Pendidikan", "Pengalaman Kerja", "Kompetensi Inti", "Ringkasan"]), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders an Indonesian CV', () => {
  const input = sections([["PROFESSIONAL SUMMARY", "Ringkasan"], ["WORK EXPERIENCE", "Pengalaman Kerja"], ["EDUCATION", "Pendidikan"], ["SKILLS", "Keahlian"]]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ["Ringkasan", "Keahlian", "Pengalaman Kerja", "Pendidikan"]);
});
