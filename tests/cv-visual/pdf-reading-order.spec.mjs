import { test, expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function fillTemplate(name, values) {
  return readFileSync(join(root, 'templates', name), 'utf8')
    .replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => values[key] ?? '');
}

async function rawPdfText(page, html) {
  await page.setContent(html);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-pdf-order-'));
  try {
    const pdfPath = join(dir, 'output.pdf');
    writeFileSync(pdfPath, await page.pdf({ format: 'Letter' }));
    return execFileSync('pdftotext', ['-raw', pdfPath, '-'], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectInOrder(text, markers) {
  const positions = markers.map(marker => text.indexOf(marker));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

test('cover-letter achievements retain DOM order in the PDF text stream', async ({ page }) => {
  const html = fillTemplate('cover-letter-template.html', {
    OPENING: 'OPENINGMARK',
    PROFILE_INTRO: 'PROFILEMARK',
    ACHIEVEMENTS_BLOCK: '<ul class="achievements"><li>FIRSTACHIEVEMENT</li><li>SECONDACHIEVEMENT</li></ul>',
    PROBLEMS_BLOCK: '<p>PROBLEMMARK</p>',
    CLOSING_BLOCK: '<p>CLOSINGMARK</p>',
  });
  const text = await rawPdfText(page, html);
  expectInOrder(text, ['OPENINGMARK', 'PROFILEMARK', '• FIRSTACHIEVEMENT', '• SECONDACHIEVEMENT', 'PROBLEMMARK', 'CLOSINGMARK']);
});

const nameFirstCv = {
  PAGE_WIDTH: '8.5in',
  LANG: 'en',
  NAME: 'Alex Rivera',
  TITLE_BLOCK: '<div class="header-title">Operations lead</div>',
  LOCATION: 'Springfield, IL',
  SECTION_SUMMARY: 'Summary',
  SUMMARY_TEXT: 'Builds internal tools for a small team.',
  SECTION_EXPERIENCE: 'Experience',
  EXPERIENCE: `
    <div class="job">
      <div class="job-header">
        <span class="job-company">Fixture Co</span>
        <span class="job-period">2022-2024</span>
      </div>
      <div class="job-role">Program Coordinator</div>
      <div class="job-context">Internal tools</div>
      <div class="job-location">Springfield, IL</div>
      <ul><li>Kept the release board current.</li></ul>
    </div>
    <div class="job">
      <div class="job-header">
        <span class="job-company">Fixture Beta</span>
        <span class="job-period">2020-2022</span>
      </div>
      <div class="job-role">Staff Assistant</div>
      <div class="job-location">Springfield, IL</div>
      <ul><li>Scheduled the weekly review.</li></ul>
    </div>`,
};

function flatPdfText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

for (const template of ['cv-template.jake.html', 'cv-template.leadership.html']) {
  test(`${template} extracted text starts with the candidate name`, async ({ page }) => {
    const text = flatPdfText(await rawPdfText(page, fillTemplate(template, nameFirstCv)));
    expect(text.toLowerCase().startsWith('alex rivera')).toBe(true);
    expect(text.toLowerCase().indexOf('program coordinator')).toBeGreaterThan('alex rivera'.length);
  });
}

test('modern CV headings precede their section bodies in the PDF text stream', async ({ page }) => {
  const values = {};
  const sections = [
    ['SUMMARY', 'SUMMARY_TEXT'],
    ['COMPETENCIES', 'COMPETENCIES'],
    ['EXPERIENCE', 'EXPERIENCE'],
    ['PROJECTS', 'PROJECTS'],
    ['EDUCATION', 'EDUCATION'],
    ['CERTIFICATIONS', 'CERTIFICATIONS'],
    ['AWARDS', 'AWARDS'],
    ['SKILLS', 'SKILLS'],
  ];
  const markers = [];
  for (const [heading, body] of sections) {
    const index = markers.length / 2 + 1;
    values[`SECTION_${heading}`] = `HEADINGMARK${index}`;
    values[body] = `BODYMARK${index}`;
    markers.push(`HEADINGMARK${index}`, `BODYMARK${index}`);
  }
  const text = await rawPdfText(page, fillTemplate('cv-template.modern.html', values));
  expectInOrder(text, markers);
});
