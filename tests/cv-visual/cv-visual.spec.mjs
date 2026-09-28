import { test, expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolveTemplate } from '../../cv-templates.mjs';
import { fixtures } from './fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ARTIFACTS = join(ROOT, 'test-results', 'cv-visual-artifacts');
const BASELINES = JSON.parse(readFileSync(join(ROOT, 'tests/cv-visual/baselines.json'), 'utf8'));
const TEMPLATE = { name: 'standard', path: resolveTemplate('cv', 'standard') };

/** Count concrete page objects in a generated PDF buffer. */
function countPdfPages(pdf) {
  const matches = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

/** Extract layout-preserving text for the ATS readability assertion. */
function extractedPdfText(pdfPath) {
  try {
    return execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`pdftotext is required for the CV ATS extraction gate: ${error.message}`);
  }
}

for (const fixture of fixtures) {
  test(`${TEMPLATE.name} / ${fixture.id}`, async ({ page }) => {
      const temp = mkdtempSync(join(tmpdir(), 'cv-visual-'));
      const input = join(temp, 'payload.json');
      const html = join(temp, 'cv.html');
      const artifactBase = `${TEMPLATE.name}-${fixture.id}`;
      const pdfPath = join(ARTIFACTS, `${artifactBase}.pdf`);
      const pngPath = join(ARTIFACTS, `${artifactBase}.png`);
      mkdirSync(ARTIFACTS, { recursive: true });
      writeFileSync(input, JSON.stringify(fixture.payload));
      execFileSync(process.execPath, ['build-cv-html.mjs', input, html, TEMPLATE.path], { cwd: ROOT });

      await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready);

      const geometry = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        const overflowing = [...document.querySelectorAll('body *')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
        const clipped = [...document.querySelectorAll('.page *')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.left < -1 || r.right > root.clientWidth + 1;
          })
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
        const photo = document.querySelector('.cv-photo')?.getBoundingClientRect();
        // The floated image intentionally overlaps the contact-row *container*
        // so text can wrap around it. Check concrete text/link boxes instead.
        const headerParts = [...document.querySelectorAll('.header h1, .contact-row > *')].flatMap((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return [...range.getClientRects()];
        });
        const intersects = (a, b) => a && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          bodyOverflow: body.scrollWidth > root.clientWidth + 1,
          overflowing,
          clipped,
          photoOverlap: photo ? headerParts.some((part) => intersects(photo, part)) : false,
          headings: document.querySelectorAll('.section-title').length,
          orphanGuardMissing: [...document.querySelectorAll('.section-title')]
            .filter((el) => !['avoid', 'avoid-page'].includes(getComputedStyle(el).breakAfter))
            .map((el) => el.textContent.trim()),
        };
      });

      expect(geometry.bodyOverflow).toBe(false);
      expect(geometry.overflowing).toEqual([]);
      expect(geometry.clipped).toEqual([]);
      expect(geometry.photoOverlap).toBe(false);
      expect(geometry.headings).toBeGreaterThanOrEqual(6);
      expect(geometry.orphanGuardMissing).toEqual([]);

      await page.screenshot({ path: pngPath, fullPage: true, animations: 'disabled' });
      await expect(page).toHaveScreenshot(`${artifactBase}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.04,
      });

      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0.6in', right: '0.6in', bottom: '0.6in', left: '0.6in' } });
      writeFileSync(pdfPath, pdf);
      const pages = countPdfPages(pdf);
      const expected = BASELINES[TEMPLATE.name]?.[fixture.id];
      expect(expected, `missing page-count baseline for ${artifactBase}`).toBeTruthy();
      expect(pages).toBeGreaterThanOrEqual(expected.minPages);
      expect(pages).toBeLessThanOrEqual(expected.maxPages);

      const text = extractedPdfText(pdfPath);
      expect(text).toContain(fixture.payload.candidate.name);
      expect(text).toContain(fixture.payload.skills[0].items[0]);
      expect(text).not.toMatch(/[□�]/);
  });
}
