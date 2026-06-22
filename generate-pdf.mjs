#!/usr/bin/env node

/**
 * generate-pdf.mjs — HTML → PDF via Playwright
 *
 * Usage:
 *   node career-ops/generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]
 *
 * Requires: @playwright/test (or playwright) installed.
 * Uses Chromium headless to render the HTML and produce a clean, ATS-parseable PDF.
 */

import { chromium } from 'playwright';
import { resolve, dirname, relative, isAbsolute } from 'path';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ensure output directory exists (fresh setup)
mkdirSync(resolve(__dirname, 'output'), { recursive: true });

/**
 * Normalize text for ATS compatibility by converting problematic Unicode.
 *
 * ATS parsers and legacy systems often fail on em-dashes, smart quotes,
 * zero-width characters, and non-breaking spaces. These cause mojibake,
 * parsing errors, or display issues. See issue #1.
 *
 * Only touches body text — preserves CSS, JS, tag attributes, and URLs.
 * Returns { html, replacements } so the caller can log what was changed.
 */
function normalizeTextForATS(html) {
  const replacements = {};
  const bump = (key, n) => { replacements[key] = (replacements[key] || 0) + n; };

  const masks = [];
  const masked = html.replace(
    /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (match) => {
      const token = `\u0000MASK${masks.length}\u0000`;
      masks.push(match);
      return token;
    }
  );

  let out = '';
  let i = 0;
  while (i < masked.length) {
    const lt = masked.indexOf('<', i);
    if (lt === -1) { out += sanitizeText(masked.slice(i)); break; }
    out += sanitizeText(masked.slice(i, lt));
    const gt = masked.indexOf('>', lt);
    if (gt === -1) { out += masked.slice(lt); break; }
    out += masked.slice(lt, gt + 1);
    i = gt + 1;
  }

  const restored = out.replace(/\u0000MASK(\d+)\u0000/g, (_, n) => masks[Number(n)]);
  return { html: restored, replacements };

  function sanitizeText(text) {
    if (!text) return text;
    let t = text;
    t = t.replace(/\u2014/g, () => { bump('em-dash', 1); return '-'; });
    t = t.replace(/\u2013/g, () => { bump('en-dash', 1); return '-'; });
    t = t.replace(/[\u201C\u201D\u201E\u201F]/g, () => { bump('smart-double-quote', 1); return '"'; });
    t = t.replace(/[\u2018\u2019\u201A\u201B]/g, () => { bump('smart-single-quote', 1); return "'"; });
    t = t.replace(/\u2026/g, () => { bump('ellipsis', 1); return '...'; });
    t = t.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, () => { bump('zero-width', 1); return ''; });
    t = t.replace(/\u00A0/g, () => { bump('nbsp', 1); return ' '; });
    // Arrows often stripped by PDF text extractors \u2014 replace with ASCII for ATS safety.
    // Consume surrounding whitespace to avoid double-spacing in output.
    t = t.replace(/\s*\u2192\s*/g, () => { bump('right-arrow', 1); return ' to '; });
    t = t.replace(/\s*\u2190\s*/g, () => { bump('left-arrow', 1); return ' from '; });
    t = t.replace(/\s*[\u2191\u2193]\s*/g, () => { bump('vert-arrow', 1); return ' '; });
    // Middle dot and bullet glyphs garble in some extractors \u2014 replace with pipe.
    t = t.replace(/\s*\u00B7\s*/g, () => { bump('middot', 1); return ' | '; });
    t = t.replace(/\s*\u2022\s*/g, () => { bump('bullet', 1); return ' | '; });
    // Currency symbols sometimes stripped by font-subsetted PDFs \u2014 spell out
    // the unambiguous ones. \u00A5 is intentionally NOT converted: it maps to both
    // Japanese Yen (JPY) and Chinese Yuan (CNY), so any spelled-out code would be
    // wrong for half of users \u2014 better to leave the glyph than emit bad data.
    t = t.replace(/\u20AC/g, () => { bump('euro', 1); return 'EUR '; });
    t = t.replace(/\u00A3/g, () => { bump('pound', 1); return 'GBP '; });
    return t;
  }
}

const SECTION_ALIASES = new Map([
  ['summary', 'summary'],
  ['professional summary', 'summary'],
  ['competencies', 'competencies'],
  ['core competencies', 'competencies'],
  ['experience', 'experience'],
  ['work experience', 'experience'],
  ['professional experience', 'experience'],
  ['projects', 'projects'],
  ['selected projects', 'projects'],
  ['personal projects', 'projects'],
  ['education', 'education'],
  ['education & certifications', 'education'],
  ['certifications', 'certifications'],
  ['skills', 'skills'],
  ['technical skills', 'skills'],
]);

function normalizeSectionTitle(text) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sectionKey(text) {
  const normalized = normalizeSectionTitle(text);
  return SECTION_ALIASES.get(normalized) ?? normalized;
}

function extractRenderedSectionOrder(html) {
  const titleMatches = [...html.matchAll(/class=["'][^"']*\bsection-title\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const sections = [];

  for (const match of titleMatches) {
    const text = normalizeSectionTitle(match[1]);
    if (!text) continue;
    sections.push({ key: sectionKey(text), title: text });
  }

  return sections;
}

function extractSourceSectionOrder(markdown) {
  const sections = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const text = normalizeSectionTitle(heading[2]);
    if (!text) continue;
    sections.push({ key: sectionKey(text), title: text });
  }

  return sections;
}

function validateCvSectionOrder(html, cvMarkdown) {
  const rendered = extractRenderedSectionOrder(html);
  const source = extractSourceSectionOrder(cvMarkdown);
  if (rendered.length < 2 || source.length < 2) return;

  const sourcePositions = new Map(source.map((section, index) => [section.key, index]));
  const renderedComparable = rendered.filter(section => sourcePositions.has(section.key));
  if (renderedComparable.length < 2) return;

  for (let i = 1; i < renderedComparable.length; i++) {
    const previous = renderedComparable[i - 1];
    const current = renderedComparable[i];
    if (sourcePositions.get(current.key) < sourcePositions.get(previous.key)) {
      const renderedOrder = renderedComparable.map(section => section.title).join(' -> ');
      const sourceOrder = source
        .filter(section => renderedComparable.some(renderedSection => renderedSection.key === section.key))
        .map(section => section.title)
        .join(' -> ');
      throw new Error(`CV section order diverges from cv.md: rendered ${renderedOrder}; cv.md ${sourceOrder}`);
    }
  }
}

async function generatePDF() {
  const args = process.argv.slice(2);

  // Parse arguments
  let inputPath, outputPath, format = 'a4';

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1].toLowerCase();
    } else if (!inputPath) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    }
  }

  if (!inputPath || !outputPath) {
    console.error('Usage: node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]');
    process.exit(1);
  }

  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  // Validate format
  const validFormats = ['a4', 'letter'];
  if (!validFormats.includes(format)) {
    console.error(`Invalid format "${format}". Use: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  console.log(`📄 Input:  ${inputPath}`);
  console.log(`📁 Output: ${outputPath}`);
  console.log(`📏 Format: ${format.toUpperCase()}`);

  let html = await readFile(inputPath, 'utf-8');
  let cvMarkdown = '';
  try {
    cvMarkdown = await readFile(resolve(__dirname, 'cv.md'), 'utf-8');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  validateCvSectionOrder(html, cvMarkdown);

  // Normalize text for ATS compatibility (issue #1)
  const normalized = normalizeTextForATS(html);
  html = normalized.html;
  const totalReplacements = Object.values(normalized.replacements).reduce((a, b) => a + b, 0);
  if (totalReplacements > 0) {
    const breakdown = Object.entries(normalized.replacements).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`🧹 ATS normalization: ${totalReplacements} replacements (${breakdown})`);
  }

  return renderHtmlToPdf(html, outputPath, { format, baseDir: dirname(inputPath) });
}

/**
 * Inline url('./fonts/...') references as base64 data: URLs.
 *
 * Chromium refuses to load file:// subresources from a setContent() page
 * (the document stays at about:blank), so fonts referenced by path are
 * silently dropped and PDFs fall back to system fonts. data: URLs carry
 * no origin restriction, so they load from any page. See #951.
 *
 * Missing font files keep their original reference and log a warning.
 *
 * @param {string} html - HTML that may reference url('./fonts/<file>').
 * @returns {Promise<string>} HTML with local font references inlined.
 */
export async function inlineLocalFonts(html) {
  const FONT_REF = /url\(\s*(['"]?)\.\/fonts\/([^'")\s]+)\1\s*\)/g;
  const MIME = { woff2: 'font/woff2', woff: 'font/woff', otf: 'font/otf', ttf: 'font/ttf' };
  const fontsDir = resolve(__dirname, 'fonts');
  const names = [...new Set([...html.matchAll(FONT_REF)].map((m) => m[2]))];
  const dataUrls = new Map();
  for (const name of names) {
    // Containment check: ".." segments and absolute names (./fonts//etc/passwd)
    // would otherwise resolve outside fonts/.
    const fontPath = resolve(fontsDir, name);
    const rel = relative(fontsDir, fontPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      console.warn(`⚠️  Font reference escapes fonts/, keeping original reference: ${name}`);
      continue;
    }
    try {
      const buf = await readFile(fontPath);
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      dataUrls.set(name, `url('data:${MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}')`);
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      console.warn(`⚠️  Font file not found, keeping original reference: fonts/${name}`);
    }
  }
  return html.replace(FONT_REF, (match, _quote, name) => dataUrls.get(name) || match);
}

/**
 * Render an HTML string to a PDF file via headless Chromium.
 *
 * Local url('./fonts/...') references are inlined as data: URLs first so
 * fonts render regardless of page origin (see inlineLocalFonts).
 *
 * @param {string} html - Full HTML document to render.
 * @param {string} outputPath - Absolute path to write the PDF to.
 * @param {{format?: 'a4'|'letter', baseDir?: string}} [opts]
 * @returns {Promise<{outputPath: string, pageCount: number, size: number}>}
 */
export async function renderHtmlToPdf(html, outputPath, opts = {}) {
  const format = opts.format || 'a4';
  const baseDir = opts.baseDir || process.cwd();

  mkdirSync(dirname(outputPath), { recursive: true });

  html = await inlineLocalFonts(html);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    // Set content with file base URL for any relative resources
    await page.setContent(html, {
      waitUntil: 'load',
      baseURL: `${pathToFileURL(baseDir).href}/`,
    });

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: format,
      printBackground: true,
      margin: {
        top: '0.6in',
        right: '0.6in',
        bottom: '0.6in',
        left: '0.6in',
      },
      preferCSSPageSize: false,
    });

    // Write PDF
    const { writeFile } = await import('fs/promises');
    await writeFile(outputPath, pdfBuffer);

    // Count pages (approximate from PDF structure)
    const pdfString = pdfBuffer.toString('latin1');
    const pageCount = (pdfString.match(/\/Type\s*\/Page[^s]/g) || []).length;

    console.log(`✅ PDF generated: ${outputPath}`);
    console.log(`📊 Pages: ${pageCount}`);
    console.log(`📦 Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    return { outputPath, pageCount, size: pdfBuffer.length };
  } finally {
    await browser.close();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  generatePDF().catch((err) => {
    console.error('❌ PDF generation failed:', err.message);
    process.exit(1);
  });
}

export { normalizeTextForATS };
