#!/usr/bin/env node

/**
 * generate-pdf.mjs — HTML → PDF via Playwright
 *
 * Usage:
 *   node career-ops/generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4] [--report=NNN] [--allow-reorder] [--max-pages=N] [--strict-pages]
 *
 * --report links the generated PDF to its tracker/report number and records
 * the linkage in data/pdf-index.tsv so downstream tools (e.g. the TUI
 * dashboard's `d`/`D` hotkeys) can locate the exact PDF for an application.
 * Without --report a manifest row is still written, just unkeyed.
 *
 * --allow-reorder downgrades the CV section-order guard from a thrown error
 * to a console warning, for JDs where the section order was deliberately
 * tailored (e.g. Projects moved ahead of Education for a technical-heavy
 * role) rather than accidentally scrambled by an agent. Without this flag,
 * any divergence from cv.md's section order still fails generation.
 *
 * --max-pages=N sets the preferred rendered CV length (default: 2 pages).
 * The actual page count is checked after Chromium writes the PDF; overflow
 * warns with trimming guidance by default. --strict-pages turns that warning
 * into a hard rejection without publishing the render as successful.
 *
 * Requires: @playwright/test (or playwright) installed.
 * Uses Chromium headless to render the HTML and produce a clean, ATS-parseable PDF.
 */

import { chromium } from 'playwright';
import { resolve, dirname, relative, sep, isAbsolute } from 'path';
import { readFile } from 'fs/promises';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PAGE_MARGIN = '0.6in';

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
    // Markdown bold from tailored CV builders (SUMMARY_TEXT uses **…**).
    t = t.replace(/\*\*([^*]+?)\*\*/g, (_, inner) => {
      bump('markdown-bold', 1);
      return `<strong>${inner}</strong>`;
    });
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

/**
 * @param {string} html
 * @param {string} cvMarkdown
 * @param {{ allowReorder?: boolean }} [options] - `allowReorder` downgrades a
 *   detected divergence from a thrown error to a console warning, for JDs
 *   where the section order was deliberately tailored (e.g. Projects moved
 *   ahead of Education for a technical-heavy role) rather than accidentally
 *   scrambled by an agent. See #1646.
 */
export function validateCvSectionOrder(html, cvMarkdown, { allowReorder = false } = {}) {
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
      const message = `CV section order diverges from cv.md: rendered ${renderedOrder}; cv.md ${sourceOrder}`;
      if (allowReorder) {
        console.warn(`⚠️  ${message} (proceeding — --allow-reorder set)`);
        return;
      }
      throw new Error(message);
    }
  }
}

/**
 * Decide whether a rendered CV fits its configured page budget.
 *
 * This is deliberately separate from rendering: page count comes from the
 * PDF Chromium actually produced, and the renderer never changes layout to
 * force content under the limit.
 *
 * @param {number} pageCount - Actual pages in the rendered PDF.
 * @param {{ maxPages?: number, strictPages?: boolean }} [options]
 * @returns {void}
 */
export function enforcePageBudget(pageCount, { maxPages = 2, strictPages = false } = {}) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`Could not determine the rendered PDF page count (received ${pageCount}).`);
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error(`Invalid page budget "${maxPages}". Use a positive integer.`);
  }
  if (pageCount <= maxPages) return;

  const actualLabel = 'pages';
  const allowedLabel = maxPages === 1 ? 'page' : 'pages';
  const message =
    `CV is ${pageCount} ${actualLabel}; the allowed maximum is ${maxPages} ${allowedLabel}. ` +
    'Trim lower-priority bullets, older roles, secondary projects, or the competencies strip, then regenerate.';

  if (strictPages) {
    throw new Error(`${message} (--strict-pages requested)`);
  }

  console.warn(`⚠️  ${message} Continuing because overflow is warning-only by default; use --strict-pages to reject it.`);
}

/**
 * Read the page count from the PDF catalog's root /Pages dictionary.
 *
 * Following the catalog reference keeps page-like text in content streams or
 * metadata from being mistaken for an actual page object.
 *
 * @param {Buffer} pdfBuffer - PDF bytes returned by Chromium.
 * @returns {number}
 */
function countRenderedPdfPages(pdfBuffer) {
  const pdf = pdfBuffer.toString('latin1');
  const objects = new Map();
  const objectPattern = /(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g;

  for (const match of pdf.matchAll(objectPattern)) {
    const streamIndex = match[3].search(/\bstream(?:\r?\n|\r)/);
    const dictionary = streamIndex === -1 ? match[3] : match[3].slice(0, streamIndex);
    objects.set(`${match[1]} ${match[2]}`, dictionary);
  }

  const catalog = [...objects.values()].find((body) => /\/Type\s*\/Catalog\b/.test(body));
  const pagesRef = catalog?.match(/\/Pages\s+(\d+)\s+(\d+)\s+R\b/);
  const pages = pagesRef ? objects.get(`${pagesRef[1]} ${pagesRef[2]}`) : null;
  const count = pages && /\/Type\s*\/Pages\b/.test(pages)
    ? pages.match(/\/Count\s+(\d+)\b/)
    : null;
  const pageCount = count ? Number(count[1]) : 0;

  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('Could not determine the rendered PDF page count from its page tree.');
  }
  return pageCount;
}

/**
 * Convert a path to a repo-relative manifest entry, or blank if it is unknown
 * or outside the career-ops repository.
 *
 * @param {string} pathValue - Absolute or cwd-relative filesystem path.
 * @returns {string} Repo-relative path using forward slashes, or an empty string.
 */
export function repoRelativeManifestPath(pathValue) {
  if (!pathValue) return '';
  const rel = relative(__dirname, resolve(pathValue));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return '';
  return rel.split(sep).join('/');
}

export function injectPrintPageCss(html, format = 'a4') {
  const normalizedFormat = String(format || 'a4').toLowerCase();
  const pageSize = normalizedFormat === 'letter' ? 'Letter' : 'A4';
  const pageStyle = `<style id="career-ops-page-setup">\n@page { size: ${pageSize}; margin: ${PDF_PAGE_MARGIN}; }\n</style>`;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${pageStyle}\n</head>`);
  }

  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, match => `${match}\n<head>\n${pageStyle}\n</head>`);
  }

  return `${pageStyle}\n${html}`;
}

/**
 * Record a generated PDF in data/pdf-index.tsv so tools can map a tracker
 * report number to the exact PDF (and its source HTML for regeneration).
 *
 * Columns: report \t pdf \t html \t format \t date — paths relative to the
 * career-ops root with forward slashes. One row per PDF path; when a report
 * number is given, older rows for that report are dropped too (regenerated
 * CVs supersede stale entries). The file is gitignored: it references
 * gitignored output/ artifacts and is meaningless on another machine.
 */
function updatePDFManifest(reportNum, pdfPath, htmlPath, format) {
  const manifestPath = resolve(__dirname, 'data', 'pdf-index.tsv');
  const toRel = (p) => relative(__dirname, p).split(sep).join('/');
  const relPDF = toRel(pdfPath);
  const relHTML = repoRelativeManifestPath(htmlPath);
  const date = new Date().toISOString().slice(0, 10);
  // "008" and "8" are the same report — zero-padded report-link form vs
  // unpadded tracker-# form. Normalize so replacement rows match.
  const normKey = (s) => (s || '').trim().replace(/^0+(?=\d)/, '');

  let lines = [];
  if (existsSync(manifestPath)) {
    lines = readFileSync(manifestPath, 'utf-8').split('\n').filter((line) => {
      if (!line.trim() || line.startsWith('#')) return false;
      const fields = line.split('\t');
      if (fields[1] === relPDF) return false;
      if (reportNum && normKey(fields[0]) === normKey(reportNum)) return false;
      return true;
    });
  }

  lines.push([reportNum || '', relPDF, relHTML, format, date].join('\t'));

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    '# report\tpdf\thtml\tformat\tdate — written by generate-pdf.mjs, do not edit\n' +
      lines.join('\n') + '\n'
  );
  return relPDF;
}

/**
 * CLI entrypoint that reads an HTML file, applies ATS-safe normalization, and
 * renders the PDF while preserving report/source metadata for the manifest.
 *
 * @returns {Promise<{outputPath: string, pageCount: number, size: number}>}
 */
async function generatePDF() {
  const args = process.argv.slice(2);

  // Parse arguments
  let inputPath, outputPath, format = 'a4', reportNum = '', allowReorder = false;
  let maxPages = 2, maxPagesInput = '2', strictPages = false;

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--report=')) {
      reportNum = arg.split('=')[1].trim();
    } else if (arg.startsWith('--max-pages=')) {
      maxPagesInput = arg.slice('--max-pages='.length);
      maxPages = Number(maxPagesInput);
    } else if (arg === '--allow-reorder') {
      allowReorder = true;
    } else if (arg === '--strict-pages') {
      strictPages = true;
    } else if (!inputPath) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    }
  }

  if (!inputPath || !outputPath) {
    console.error('Usage: node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4] [--report=NNN] [--allow-reorder] [--max-pages=N] [--strict-pages]');
    console.error('');
    console.error('This script only converts an already-built HTML file to PDF.');
    console.error('The input HTML is produced by the pdf mode: the agent fills cv-template.html');
    console.error('with content tailored to the specific job (see modes/pdf.md) — there is no');
    console.error('mechanical markdown-to-HTML step by design. Run `/career-ops pdf` in your AI');
    console.error('CLI to drive the full flow end to end.');
    process.exit(1);
  }

  if (reportNum && !/^\d+$/.test(reportNum)) {
    console.error(`Invalid --report "${reportNum}". Use the numeric tracker/report number, e.g. --report=018`);
    process.exit(1);
  }

  if (!Number.isInteger(maxPages) || maxPages < 1) {
    console.error(`Invalid --max-pages "${maxPagesInput}". Use a positive integer, e.g. --max-pages=1 or --max-pages=2.`);
    process.exit(1);
  }

  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  // Path-traversal guard: keep the PDF write inside the project directory so a
  // crafted output argument (e.g. "../../etc/cron.d/x") can't escape the repo.
  // Anchored to the repo root (__dirname), not process.cwd(): running the script
  // from outside the repo used to falsely refuse in-repo outputs — and, worse,
  // would have allowed writes anywhere under an arbitrary cwd.
  const relOut = relative(__dirname, outputPath);
  if (relOut === '' || relOut.startsWith('..') || isAbsolute(relOut)) {
    console.error(`Refusing to write the PDF outside the project directory: ${outputPath}`);
    process.exit(1);
  }

  // Validate format
  const validFormats = ['a4', 'letter'];
  if (!validFormats.includes(format)) {
    console.error(`Invalid format "${format}". Use: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  console.log(`📄 Input:  ${inputPath}`);
  console.log(`📁 Output: ${outputPath}`);
  console.log(`📏 Format: ${format.toUpperCase()}`);
  console.log(`📐 Page budget: ${maxPages}${strictPages ? ' (strict)' : ' (warning only)'}`);

  let html = await readFile(inputPath, 'utf-8');
  let cvMarkdown = '';
  try {
    cvMarkdown = await readFile(resolve(__dirname, 'cv.md'), 'utf-8');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  validateCvSectionOrder(html, cvMarkdown, { allowReorder });

  // Normalize text for ATS compatibility (issue #1)
  const normalized = normalizeTextForATS(html);
  html = normalized.html;
  const totalReplacements = Object.values(normalized.replacements).reduce((a, b) => a + b, 0);
  if (totalReplacements > 0) {
    const breakdown = Object.entries(normalized.replacements).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`🧹 ATS normalization: ${totalReplacements} replacements (${breakdown})`);
  }

  return renderHtmlToPdf(html, outputPath, {
    format,
    baseDir: dirname(inputPath),
    reportNum,
    inputPath,
    maxPages,
    strictPages,
  });
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
 * Writes the HTML to a temporary file in the baseDir and loads it via
 * page.goto() to give the page a file:// origin. This allows relative
 * resources (images, fonts) to load — setContent() runs from about:blank
 * and Chromium blocks file:// subresource loads from non-file origins.
 *
 * Local url('./fonts/...') references are inlined as data: URLs first so
 * fonts also survive the ATS normalization pass (which may strip font refs).
 *
 * @param {string} html - Full HTML document to render.
 * @param {string} outputPath - Absolute path to write the PDF to.
 * @param {{
 *   format?: 'a4'|'letter',
 *   baseDir?: string,
 *   reportNum?: string,
 *   inputPath?: string,
 *   maxPages?: number,
 *   strictPages?: boolean,
 *   launchBrowser?: (options: {headless: boolean}) => Promise<import('playwright').Browser>
 * }} [opts]
 * @returns {Promise<{outputPath: string, pageCount: number, size: number}>}
 */
export async function renderHtmlToPdf(html, outputPath, opts = {}) {
  const format = opts.format || 'a4';
  const baseDir = opts.baseDir || process.cwd();
  const reportNum = opts.reportNum || '';
  const inputPath = opts.inputPath || '';

  mkdirSync(dirname(outputPath), { recursive: true });

  html = injectPrintPageCss(html, format);
  html = await inlineLocalFonts(html);

  // Write HTML to a temp file in baseDir so page.goto() gives a file://
  // origin that can load local images, fonts, and other resources.
  const tmpHtmlPath = resolve(baseDir, `.career-ops-render-${randomUUID()}.html`);
  const { writeFile, unlink } = await import('fs/promises');
  await writeFile(tmpHtmlPath, html, 'utf-8');

  const launchBrowser = opts.launchBrowser || ((options) => chromium.launch(options));
  let browser = null;
  try {
    browser = await launchBrowser({ headless: true });
    const page = await browser.newPage();

    // Load from file:// so the page origin allows local subresources
    await page.goto(pathToFileURL(tmpHtmlPath).href, {
      waitUntil: 'load',
    });

    // Wait for fonts and images to settle
    await page.evaluate(() => document.fonts.ready);

    // Generate PDF
    const pdfBuffer = await page.pdf({
      printBackground: true,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
      },
      preferCSSPageSize: true,
    });

    // Write PDF
    await writeFile(outputPath, pdfBuffer);

    // Read the root page-tree count so page-like text in streams is ignored.
    const pageCount = countRenderedPdfPages(pdfBuffer);

    // Strict overflow leaves the draft on disk but stops before success logs
    // and manifest publication. Default overflow warns and continues.
    enforcePageBudget(pageCount, {
      maxPages: opts.maxPages ?? 2,
      strictPages: opts.strictPages ?? false,
    });

    console.log(`✅ PDF generated: ${outputPath}`);
    console.log(`📊 Pages: ${pageCount}`);
    console.log(`📦 Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    try {
      updatePDFManifest(reportNum, outputPath, inputPath, format);
      console.log(`🔗 Manifest: data/pdf-index.tsv updated${reportNum ? ` (report ${reportNum})` : ' (no --report given)'}`);
    } catch (err) {
      // The PDF itself succeeded — never fail the run over manifest bookkeeping.
      console.error(`⚠️  Manifest update failed: ${err.message}`);
    }

    return { outputPath, pageCount, size: pdfBuffer.length };
  } finally {
    if (browser) {
      await browser.close().catch((err) => {
        console.warn(`⚠️  Browser cleanup failed: ${err.message}`);
      });
    }
    // Clean up temp file
    await unlink(tmpHtmlPath).catch((err) => {
      if (err?.code !== 'ENOENT') {
        console.warn(`⚠️  Temporary HTML cleanup failed: ${err.message}`);
      }
    });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  generatePDF().catch((err) => {
    console.error('❌ PDF generation failed:', err.message);
    process.exit(1);
  });
}

export { normalizeTextForATS };
