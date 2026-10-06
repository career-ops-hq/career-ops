import { test, expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { listTemplates } from '../../cv-templates.mjs';
import { injectPrintPageCss } from '../../generate-pdf.mjs';
import { fixtures } from './fixtures.mjs';
import { collectDomLayout, parsePdfLayout, inspectPdfLayout, missingAtsWords } from './layout.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ARTIFACTS = join(ROOT, 'test-results', 'cv-visual-artifacts');
const BASELINES = JSON.parse(readFileSync(join(ROOT, 'tests/cv-visual/baselines.json'), 'utf8'));
// Use the same registry as the product, including one-level template packs.
const templates = listTemplates('cv', { format: 'html' });
const normalize = (text) => text.normalize('NFC').replace(/\s+/gu, '').toLowerCase();

function atsValues(payload) {
  return [
    payload.candidate.name, payload.candidate.email, payload.candidate.location,
    payload.candidate.linkedin.display, payload.candidate.portfolio.display,
    payload.summary, ...payload.competencies,
    ...payload.experience.flatMap(({ company, role, dates, bullets }) => [company, role, dates, ...bullets]),
    ...payload.projects.flatMap(({ name, tech, description }) => [name, tech, description]),
    ...payload.education.flatMap(({ title, org, year }) => [title, org, year]),
    ...payload.certifications.flatMap(({ title, org, year }) => [title, org, year]),
    ...payload.skills.flatMap(({ category, items }) => [category, ...items]),
  ].filter(Boolean);
}

for (const template of templates) {
  for (const fixture of fixtures) {
    test(`${template.name} / ${fixture.id}`, async ({ page }, testInfo) => {
      const temp = mkdtempSync(join(tmpdir(), 'cv-visual-'));
      const artifactBase = `${template.name}-${fixture.id}`;
      const artifactDir = join(ARTIFACTS, artifactBase);
      rmSync(artifactDir, { recursive: true, force: true });
      mkdirSync(artifactDir, { recursive: true });
      const pdfPath = join(artifactDir, 'cv.pdf');
      try {
        const input = join(temp, 'payload.json');
        const html = join(temp, 'cv.html');
        writeFileSync(input, JSON.stringify(fixture.payload));
        execFileSync(process.execPath, ['build-cv-html.mjs', input, html, template.path], {
          cwd: ROOT,
          // Isolate even the fallback configuration lookup from real user data.
          env: { ...process.env, CAREER_OPS_ROOT: temp, CAREER_OPS_DATA_DIR: temp },
        });
        writeFileSync(html, injectPrintPageCss(readFileSync(html, 'utf8'), 'a4'));
        // Fixtures and shipped templates must be self-contained; never fetch a
        // real photo, font, or profile while testing.
        await page.route(/^https?:\/\//, (route) => route.abort());
        await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map((image) => image.decode()));
        });

        // Geometry at the printable width, not a wide desktop viewport that
        // can conceal wrapping failures. Respect each template's own margin.
        const margin = await page.evaluate(() => {
          const probe = document.createElement('div');
          probe.style.width = 'var(--page-margin, 0.6in)';
          document.body.append(probe);
          const width = probe.getBoundingClientRect().width;
          probe.remove();
          return width;
        });
        await page.setViewportSize({ width: Math.floor(210 / 25.4 * 96 - 2 * margin), height: 1123 });
        const geometry = await page.evaluate(collectDomLayout);
        const photoCount = await page.locator('.cv-photo').count();
        const supportsPhoto = readFileSync(template.path, 'utf8').includes('{{PHOTO}}');
        const photoVisible = await page.locator('.cv-photo').evaluateAll((images) => images.every((img) =>
          img.naturalWidth > 0 && img.getBoundingClientRect().width > 0 && img.getBoundingClientRect().height > 0
          && getComputedStyle(img).visibility === 'visible' && getComputedStyle(img).opacity !== '0'));

        // Produce all evidence before assertions, so a geometry failure still
        // leaves reviewable PDF pages and ATS text in CI artifacts.
        writeFileSync(pdfPath, await page.pdf({ printBackground: true, preferCSSPageSize: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' } }));
        const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
        const xml = execFileSync('pdftotext', ['-bbox-layout', pdfPath, '-'], { encoding: 'utf8' });
        const pages = parsePdfLayout(xml);
        for (const [index, pdfPage] of pages.entries()) {
          expect.soft(Math.abs(pdfPage.width - 595.28), `page ${index + 1} width should be A4`)
            .toBeLessThanOrEqual(1);
          expect.soft(Math.abs(pdfPage.height - 841.89), `page ${index + 1} height should be A4`)
            .toBeLessThanOrEqual(1);
        }
        const pdfLayout = inspectPdfLayout(pages, geometry.headingPairs);
        writeFileSync(join(artifactDir, 'ats.txt'), text);
        writeFileSync(join(artifactDir, 'layout.json'), JSON.stringify({ template: template.name,
          fixture: fixture.id, pageCount: pages.length, geometry, pdfLayout }, null, 2));
        execFileSync('pdftoppm', ['-png', '-r', '72', pdfPath, join(artifactDir, 'page')]);
        await testInfo.attach('Rendered PDF', { path: pdfPath, contentType: 'application/pdf' });
        await testInfo.attach('ATS text', { path: join(artifactDir, 'ats.txt'), contentType: 'text/plain' });
        await testInfo.attach('Layout diagnostics', { path: join(artifactDir, 'layout.json'), contentType: 'application/json' });

        expect.soft(geometry.bodyOverflow).toBe(false);
        expect.soft(geometry.overflowing).toEqual([]);
        expect.soft(geometry.clipped).toEqual([]);
        expect.soft(geometry.photoOverlap).toBe(false);
        expect.soft(geometry.headings).toBeGreaterThanOrEqual(7);
        expect.soft(photoVisible).toBe(true);
        expect.soft(photoCount).toBe(fixture.withPhoto && supportsPhoto ? 1 : 0);
        // A count of two pages must not bless a header-only first page when
        // an over-broad break guard pushes every section to page two.
        expect.soft(normalize(pages[0].words.map(({ text }) => text).join(' ')),
          'the summary must start on the first PDF page').toContain(normalize(fixture.payload.summary));
        for (const pdfPage of pages) expect.soft(pdfPage.words.length, 'empty PDF page').toBeGreaterThan(0);
        expect.soft(pdfLayout.clipped).toEqual([]);
        expect.soft(pdfLayout.orphanHeadings).toEqual([]);
        expect.soft(pdfLayout.missingText).toEqual([]);
        const expectedPageCount = BASELINES[template.name]?.[fixture.id];
        expect(expectedPageCount, `missing numeric page-count baseline for ${template.name}/${fixture.id}`)
          .toEqual(expect.any(Number));
        expect.soft(pages.length, `review the exact page count in baselines.json for ${artifactBase}`)
          .toBe(expectedPageCount);
        expect.soft(text).not.toMatch(/[□�\uFB00-\uFB06]/u);
        expect.soft(text.toLowerCase()).toContain(fixture.payload.candidate.name.toLowerCase());
        expect.soft(text).toContain(fixture.payload.candidate.email);
        expect.soft(missingAtsWords(text, [...atsValues(fixture.payload), ...Object.values(fixture.payload.sections)])).toEqual([]);
        const normalizedText = normalize(text);
        for (const value of atsValues(fixture.payload)) {
          expect.soft(normalizedText, `ATS text lost ${JSON.stringify(value)}`).toContain(normalize(value));
        }
        const previews = readdirSync(artifactDir).filter((file) => /^page-\d+\.png$/.test(file))
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
        expect(previews).toHaveLength(pages.length);
        for (const [index, preview] of previews.entries()) {
          await testInfo.attach(`Page ${index + 1}`, { path: join(artifactDir, preview), contentType: 'image/png' });
          expect.soft(readFileSync(join(artifactDir, preview))).toMatchSnapshot(
            `${artifactBase}-page-${index + 1}.png`, { maxDiffPixelRatio: 0.002 });
        }
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
  }
}
