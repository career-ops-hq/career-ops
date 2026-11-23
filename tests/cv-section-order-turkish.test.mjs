// tests/cv-section-order-turkish.test.mjs — the section-order guard and cv.sections must read
// Turkish section titles, the way they already read English, Polish,
// Spanish, Italian, Chinese and Portuguese.
//
// SECTION_ALIASES had no Turkish entries, so a CV built with modes/tr/
// resolved no section key: `cv.sections` in config/profile.yml warned that it
// "matched no section in this CV" and the configured order was silently not
// applied, and the order guard compared raw titles instead of the canonical
// modes/pdf.md order.
//
// Run:  node --test tests/cv-section-order-turkish.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCvSectionOrder, reorderCvSections, sectionKey } from '../generate-pdf.mjs';

const html = titles => titles.map(t => `<div class="section-title">${t}</div>`).join('\n');
// The template's section markers are English (<!-- EDUCATION -->) whatever
// language the titles are written in, so the fixture keeps them that way.
const sections = pairs => `<!DOCTYPE html>\n<html lang="tr">\n<head><title>CV</title></head>\n<body>\n<div class="cv">\n${pairs
  .map(([marker, title]) => `  <!-- ${marker} -->\n  <div class="section">\n    <div class="section-title">${title}</div>\n    <p>${title}</p>\n  </div>\n`)
  .join('\n')}</div>\n</body>\n</html>\n`;
const renderedTitles = out => [...out.matchAll(/class="section-title">([^<]*)</g)].map(m => m[1]);
const cvMd = '# CV\n\n## Özet\n\n## Eğitim\n\n## Yetkinlikler\n\n## İş Deneyimi\n';

test('sectionKey resolves the Turkish spellings CVs use', () => {
  const cases = [
    ['Özet', 'summary'], ['Profil', 'summary'], ['Profesyonel Özet', 'summary'], ['Hakkımda', 'summary'],
    ['Temel Yetkinlikler', 'competencies'], ['Yetkinlikler', 'competencies'],
    ['İş Deneyimi', 'experience'], ['İş Deneyimleri', 'experience'], ['Deneyim', 'experience'], ['Profesyonel Deneyim', 'experience'],
    ['Projeler', 'projects'], ['Öne Çıkan Projeler', 'projects'],
    ['Eğitim', 'education'], ['Eğitim Bilgileri', 'education'],
    ['Sertifikalar', 'certifications'], ['Ödüller', 'awards'],
    ['Beceriler', 'skills'], ['Teknik Beceriler', 'skills'], ['Yetenekler', 'skills'],
    ['İlgi Alanları', 'interests'], ['Hobiler', 'interests'],
  ];
  const missed = cases.filter(([title, key]) => sectionKey(title) !== key)
    .map(([title, key]) => `${title} => ${sectionKey(title)} (expected ${key})`);
  assert.deepEqual(missed, []);
});

test('A Turkish CV in the documented modes/pdf.md order is accepted', () => {
  assert.doesNotThrow(() => validateCvSectionOrder(
    html(["Özet", "Temel Yetkinlikler", "İş Deneyimi", "Eğitim", "Sertifikalar", "Teknik Beceriler"]),
    cvMd,
  ));
});

test('a genuinely scrambled Turkish CV is still rejected', () => {
  const expFirstMd = '# CV\n\n## Özet\n\n## Yetkinlikler\n\n## İş Deneyimi\n\n## Eğitim\n';
  assert.throws(
    () => validateCvSectionOrder(html(["Eğitim", "İş Deneyimi", "Yetkinlikler", "Özet"]), expFirstMd),
    /diverges from cv\.md/,
  );
});

test('cv.sections reorders a Turkish CV', () => {
  const input = sections([["PROFESSIONAL SUMMARY", "Özet"], ["WORK EXPERIENCE", "İş Deneyimi"], ["EDUCATION", "Eğitim"], ["SKILLS", "Beceriler"]]);
  const out = reorderCvSections(input, ['summary', 'skills', 'experience', 'education']);
  assert.deepEqual(renderedTitles(out), ["Özet", "Beceriler", "İş Deneyimi", "Eğitim"]);
});
