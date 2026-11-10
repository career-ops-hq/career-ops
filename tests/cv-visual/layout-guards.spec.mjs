import { test, expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDomLayout, inspectPdfLayout, parsePdfLayout } from './layout.mjs';

test('a floated photo can share its header container without covering text', async ({ page }) => {
  await page.setContent(`<style>
    body { margin: 0; font: 16px Arial; }
    .page { padding: 20px; }
    .cv-photo { float: right; width: 80px; height: 80px; margin-left: 12px; }
    h1 { margin: 0; }
  </style><div class="page"><div class="header">
    <div class="cv-photo"></div><h1>Example Candidate</h1>
    <div>candidate@example.com</div></div></div>`);
  expect(await page.evaluate(collectDomLayout)).toMatchObject({
    bodyOverflow: false, overflowing: [], clipped: [], photoOverlap: false,
  });
  await page.addStyleTag({ content: '.cv-photo { position: absolute; float: none; top: 20px; left: 20px; margin: 0; }' });
  const broken = await page.evaluate(collectDomLayout);
  expect(broken.photoOverlap).toBe(true);
  expect(broken.photoCollisions).toContain('Example Candidate');
});

test('geometry catches overflowing text and text vertically clipped by a container', async ({ page }) => {
  await page.setContent(`<style>
    body { margin: 0; font: 16px Arial; }
    .overflow { width: 100px; white-space: nowrap; }
    .clipped { height: 8px; overflow: hidden; }
  </style><div class="page">
    <div class="overflow">An unbreakable line that exceeds its available width</div>
    <div class="clipped">The bottom of this text is hidden</div>
  </div>`);
  const result = await page.evaluate(collectDomLayout);
  expect(result.overflowing).toContain('div.overflow');
  expect(result.clipped).toContain('div.clipped: The bottom of this text is hidden');
});

test('PDF geometry catches a forced orphan even when the heading declares break-after avoid', async ({ page }) => {
  await page.setContent(`<style>
    body { font: 16px Arial; }
    .section-title { break-after: avoid; }
    .body { break-before: page; }
  </style><div class="page"><div class="section">
    <div class="section-title">Experience</div>
    <div class="body">Example Organization</div>
  </div></div>`);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  const { headingPairs } = await page.evaluate(collectDomLayout);
  const dir = mkdtempSync(join(tmpdir(), 'cv-layout-guard-'));
  try {
    const pdf = join(dir, 'orphan.pdf');
    writeFileSync(pdf, await page.pdf({ format: 'A4' }));
    const pages = parsePdfLayout(execFileSync('pdftotext', ['-bbox-layout', pdf, '-'], { encoding: 'utf8' }));
    expect(inspectPdfLayout(pages, headingPairs)).toEqual({
      clipped: [], missingText: [],
      orphanHeadings: [{ heading: 'Experience', headingPage: 1, bodyPage: 2 }],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
