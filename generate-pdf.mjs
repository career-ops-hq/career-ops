#!/usr/bin/env node

/**
 * generate-pdf.mjs — HTML → PDF via Playwright
 *
 * Usage:
 *   node career-ops/generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4] [--report=NNN] [--allow-reorder] [--max-pages=N] [--strict-pages]
 *   node career-ops/generate-pdf.mjs --batch=<manifest.json> [--format=letter|a4] [--allow-reorder] [--max-pages=N] [--strict-pages]
 *
 * --batch renders every document in a JSON manifest (an array of
 * {input, output, format?, reportNum?}) through ONE shared Chromium instead of
 * relaunching per document. One failing document is isolated and recorded; the
 * rest still render. Results are written to <manifest>.results.json and the
 * process exits non-zero if any document failed (#2384).
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
import { resolve, dirname, relative, sep, isAbsolute, basename } from 'path';
import { readFile } from 'fs/promises';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { randomUUID } from 'node:crypto';
import { readStyleTokens, injectThemeStyle } from './theme-style.mjs';
import { resolvePdfIndexPath, resolveTrackerPath, resolveWorkspaceRoot } from './tracker-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const trackerPath = resolveTrackerPath(__dirname);
const workspaceRoot = resolveWorkspaceRoot(trackerPath);
const PDF_PAGE_MARGIN = '0.6in';

// Canonical tracker workspace: realpath so a symlinked ancestor (e.g. macOS
// /var -> /private/var) is compared like-for-like by assertInsideWorkspace.
// When CAREER_OPS_TRACKER points at another workspace, that workspace—not the
// installed script directory—is the safe boundary for input and output.
const __workspaceRoot = realpathSync(workspaceRoot);

/**
 * Assert that an already-resolved absolute path stays inside the tracker workspace,
 * resolving symlinks first.
 *
 * A lexical relative(workspaceRoot, p) check accepts a path that stays lexically
 * inside the repo but whose ancestor is a symlink escaping it. This canonicalizes
 * p through realpath — the path itself when it exists, otherwise its nearest
 * existing ancestor with the not-yet-created tail re-appended (the output PDF and
 * its directory may not exist yet) — then checks containment against the
 * realpathed workspace root (mirrors canonicalizeTrackerPath in tracker-utils.mjs).
 *
 * @param {string} absPath - Already-resolved absolute candidate path.
 * @param {string} label - 'input' | 'output', used in the thrown message.
 * @returns {string} absPath unchanged when contained.
 * @throws {Error} when the canonical path escapes the tracker workspace.
 */
function assertInsideWorkspace(absPath, label) {
  let probe = absPath;
  const tail = [];
  while (!existsSync(probe)) {
    tail.unshift(basename(probe));
    const parent = dirname(probe);
    if (parent === probe) break; // reached the filesystem root
    probe = parent;
  }
  let canonical;
  try {
    canonical = existsSync(probe) ? resolve(realpathSync(probe), ...tail) : absPath;
  } catch {
    // Canonicalization failed (realpath raced away, permission error): containment
    // is unprovable, so fail closed rather than fall back to a lexical form that a
    // symlinked ancestor could slip past.
    throw new Error(`${label} escapes the tracker workspace: ${absPath}`);
  }
  const rel = relative(__workspaceRoot, canonical);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} escapes the tracker workspace: ${absPath}`);
  }
  return absPath;
}

// Ensure output directory exists (fresh setup)
mkdirSync(resolve(workspaceRoot, 'output'), { recursive: true });

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

/**
 * Strip diacritics so a heading is recognized regardless of how it was typed.
 *
 * Rendered Polish headings are not always spelled with their diacritics —
 * "Wykształcenie" and "Wyksztalcenie" both occur in already-generated CVs.
 * NFD splits most Polish letters into a base plus a combining mark we drop;
 * ł (U+0142) has no canonical decomposition, so it needs its own pass.
 *
 * Only used for alias lookup — display titles keep their diacritics.
 */
function foldDiacritics(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

/**
 * Heading spelling -> canonical section key.
 *
 * Polish (modes/pl) is here because without these aliases the rendered Polish
 * titles match nothing derived from the English cv.md: validateCvSectionOrder()
 * finds fewer than two comparable sections and silently returns, leaving the
 * section-order guard disabled on every CV rendered in that mode.
 *
 * Keys are folded on construction so authored diacritics match stripped input.
 */
const SECTION_ALIASES = new Map([
  // English — cv.md is the source of truth and is written in English.
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
  ['awards', 'awards'],
  ['honors', 'awards'],
  ['honours', 'awards'],
  ['awards & honors', 'awards'],
  ['awards and honors', 'awards'],
  ['honors & awards', 'awards'],
  ['awards & honours', 'awards'],
  ['skills', 'skills'],
  ['technical skills', 'skills'],
  // Polish — the vocabulary documented in modes/pl/README.md, plus the word-order
  // variants that turn up in practice (both "Kompetencje kluczowe" and
  // "Kluczowe kompetencje" are used for the same section).
  ['podsumowanie', 'summary'],
  ['podsumowanie zawodowe', 'summary'],
  ['profil zawodowy', 'summary'],
  ['kompetencje', 'competencies'],
  ['kompetencje kluczowe', 'competencies'],
  ['kluczowe kompetencje', 'competencies'],
  ['doświadczenie', 'experience'],
  ['doświadczenie zawodowe', 'experience'],
  ['przebieg kariery', 'experience'],
  ['projekty', 'projects'],
  ['kluczowe projekty', 'projects'],
  ['wybrane projekty', 'projects'],
  ['wykształcenie', 'education'],
  ['edukacja', 'education'],
  ['wykształcenie i certyfikaty', 'education'],
  ['certyfikaty', 'certifications'],
  ['certyfikaty i szkolenia', 'certifications'],
  ['szkolenia i certyfikaty', 'certifications'],
  ['nagrody', 'awards'],
  ['wyróżnienia', 'awards'],
  ['nagrody i wyróżnienia', 'awards'],
  ['umiejętności', 'skills'],
  ['umiejętności techniczne', 'skills'],
].map(([alias, key]) => [foldDiacritics(alias), key]));

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
  const normalized = foldDiacritics(normalizeSectionTitle(text));
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
 * Convert a path to a workspace-relative manifest entry, or blank if it is
 * unknown or outside the tracker-owned workspace.
 *
 * @param {string} pathValue - Absolute or cwd-relative filesystem path.
 * @param {string} [rootDir] - Workspace root used as the manifest base.
 * @returns {string} Workspace-relative path using forward slashes, or an empty string.
 */
export function workspaceRelativeManifestPath(pathValue, rootDir = workspaceRoot) {
  if (!pathValue) return '';
  const rel = relative(rootDir, resolve(pathValue));
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return '';
  return rel.split(sep).join('/');
}

/** @deprecated Use workspaceRelativeManifestPath. */
export function repoRelativeManifestPath(pathValue, rootDir = workspaceRoot) {
  return workspaceRelativeManifestPath(pathValue, rootDir);
}

function nearestExistingPath(pathValue) {
  let candidate = pathValue;
  while (true) {
    try {
      lstatSync(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

/**
 * Confirm a PDF destination is lexically and canonically inside its workspace.
 * Resolving the nearest existing ancestor catches output directories that are
 * symlinks to another location before Chromium writes through them.
 */
export function isWorkspaceOutputPath(pathValue, rootDir = workspaceRoot) {
  const root = resolve(rootDir);
  const candidate = resolve(pathValue);
  const lexical = relative(root, candidate);
  if (lexical === '' || lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    return false;
  }

  try {
    const canonicalRoot = realpathSync(root);
    const canonicalAnchor = realpathSync(nearestExistingPath(candidate));
    const canonical = relative(canonicalRoot, canonicalAnchor);
    return canonical === '' || (canonical !== '..' && !canonical.startsWith(`..${sep}`) && !isAbsolute(canonical));
  } catch {
    return false;
  }
}

export function injectPrintPageCss(html, format = 'a4') {
  const normalizedFormat = String(format || 'a4').toLowerCase();
  const pageSize = normalizedFormat === 'letter' ? 'Letter' : 'A4';
  // Read --page-margin (set by the template's own :root default, and overridden
  // by injectThemeStyle's block when style.margin is configured) instead of
  // hardcoding PDF_PAGE_MARGIN outright — this @page rule is injected last, so a
  // hardcoded value would silently win the cascade and make style.margin
  // ineffective (#1837 review). PDF_PAGE_MARGIN is only the fallback for a
  // template that never declares --page-margin at all.
  const pageStyle = `<style id="career-ops-page-setup">\n@page { size: ${pageSize}; margin: var(--page-margin, ${PDF_PAGE_MARGIN}); }\n</style>`;

  if (/<\/head>/i.test(html)) {
    // Replacer function, matching the <html> branch just below. `pageStyle`
    // interpolates only internal constants today, so this is hardening rather
    // than a live bug — but the two branches sat in one function disagreeing
    // about it, and the safe spelling is the one that stays correct if a
    // configurable value is ever interpolated here (#2596).
    return html.replace(/<\/head>/i, () => `${pageStyle}\n</head>`);
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
 * tracker workspace with forward slashes. One row per PDF path; when a report
 * number is given, older rows for that report are dropped too (regenerated
 * CVs supersede stale entries). The file is gitignored: it references
 * gitignored output/ artifacts and is meaningless on another machine.
 */
function updatePDFManifest(reportNum, pdfPath, htmlPath, format) {
  const manifestPath = resolvePdfIndexPath(trackerPath);
  const toRel = (p) => relative(workspaceRoot, p).split(sep).join('/');
  const relPDF = toRel(pdfPath);
  const relHTML = workspaceRelativeManifestPath(htmlPath, workspaceRoot);
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
  let maxPages = 2, maxPagesInput = '2', strictPages = false, batchManifestPath = null;

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--report=')) {
      reportNum = arg.split('=')[1].trim();
    } else if (arg.startsWith('--batch=')) {
      batchManifestPath = arg.slice('--batch='.length);
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

  if (!Number.isInteger(maxPages) || maxPages < 1) {
    console.error(`Invalid --max-pages "${maxPagesInput}". Use a positive integer, e.g. --max-pages=1 or --max-pages=2.`);
    process.exit(1);
  }

  // Batch mode (#2384): render every document in the manifest through one
  // Chromium. Applies the global --max-pages/--strict-pages/--allow-reorder to
  // all entries; each entry supplies its own input/output and may override
  // format/reportNum. Takes no positional input/output.
  if (batchManifestPath) {
    // --report keys a single PDF to one tracker row; a batch renders N distinct
    // CVs, so one global --report would mislabel them all. Per-entry "reportNum"
    // in the manifest is the correct channel — reject the global flag here rather
    // than silently ignore it (fails before the batch path returns).
    if (reportNum) {
      console.error('--report is not valid with --batch. Set "reportNum" per entry in the manifest instead.');
      process.exit(1);
    }
    return runBatchFromManifest(batchManifestPath, { format, maxPages, strictPages, allowReorder });
  }

  if (!inputPath || !outputPath) {
    console.error('Usage: node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4] [--report=NNN] [--allow-reorder] [--max-pages=N] [--strict-pages]');
    console.error('   or: node generate-pdf.mjs --batch=<manifest.json> [--format=letter|a4] [--allow-reorder] [--max-pages=N] [--strict-pages]');
    console.error('');
    console.error('Batch mode renders every document in the JSON manifest (an array of');
    console.error('{input, output, format?, reportNum?}) through one shared Chromium and writes');
    console.error('<manifest>.results.json; it exits non-zero if any document fails.');
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

  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  // Path-traversal guard: keep the PDF write inside the tracker-owned workspace
  // so a crafted output argument cannot escape into another user's directory.
  // Anchored to the workspace root, not process.cwd(): running the script
  // from outside the repo used to falsely refuse in-repo outputs — and, worse,
  // would have allowed writes anywhere under an arbitrary cwd.
  try {
    assertInsideWorkspace(inputPath, 'input');
  } catch (err) {
    console.error(`Refusing to write the PDF outside the tracker workspace: ${err.message}`);
    process.exit(1);
  }
  if (!isWorkspaceOutputPath(outputPath, workspaceRoot)) {
    console.error(`Refusing to write the PDF outside the tracker workspace: ${outputPath}`);
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
    cvMarkdown = await readFile(resolve(workspaceRoot, 'cv.md'), 'utf-8');
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
    styleTokens: readStyleTokens(resolve(workspaceRoot, 'config', 'profile.yml')),
  });
}

/**
 * Drive batch mode (#2384) from a JSON manifest.
 *
 * The manifest is a JSON array of {input, output, format?, reportNum?}. Each
 * entry is validated and its HTML read + ATS-normalized independently: a bad
 * entry (missing file, bad format, escaping output path, scrambled section
 * order) is recorded as a failure and skipped so it can never sink the rest of
 * the batch. Surviving entries render through one shared Chromium (renderBatch).
 *
 * A results manifest is always written next to the input manifest as
 * `<manifest>.results.json` — an ordered array mirroring the input, each item
 * `{outputPath, ok, ...}`. The process exits non-zero if ANY entry failed (or
 * the browser died), so cron/batch-tailor callers never mistake a partial run
 * for success; it exits zero only when every document rendered.
 *
 * @param {string} manifestPath - Path to the JSON manifest.
 * @param {{format: string, maxPages: number, strictPages: boolean, allowReorder: boolean}} globals
 * @returns {Promise<{ok: number, failed: number, results: Array}>}
 */
async function runBatchFromManifest(manifestPath, globals) {
  const resolvedManifest = resolve(manifestPath);
  const manifestDir = dirname(resolvedManifest);

  // Contain the manifest itself before any filesystem access: batch manifests are
  // machine-generated workspace-internal artifacts, so a --batch path pointing outside
  // the project marks a malformed/tampered invocation. Reject before reading the
  // manifest or writing its <manifest>.results.json sibling below.
  try {
    assertInsideWorkspace(resolvedManifest, 'batch manifest');
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = await readFile(resolvedManifest, 'utf-8');
  } catch (err) {
    console.error(`❌ Cannot read batch manifest: ${resolvedManifest} (${err.message})`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Batch manifest is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(manifest) || manifest.length === 0) {
    console.error('❌ Batch manifest must be a non-empty JSON array of {input, output, format?, reportNum?}.');
    process.exit(1);
  }

  const validFormats = ['a4', 'letter'];
  const results = new Array(manifest.length).fill(null);
  const entries = [];

  // Prepare each entry. Preserve input order in the results by carrying the
  // manifest index through renderBatch; prep failures land at their own index.
  let cvMarkdown = '';
  try {
    cvMarkdown = await readFile(resolve(workspaceRoot, 'cv.md'), 'utf-8');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }

  for (let i = 0; i < manifest.length; i++) {
    const spec = manifest[i];
    try {
      if (!spec || typeof spec.input !== 'string' || typeof spec.output !== 'string') {
        throw new Error('each entry needs a string "input" and "output"');
      }

      const entryFormat = (spec.format || globals.format).toLowerCase();
      if (!validFormats.includes(entryFormat)) {
        throw new Error(`invalid format "${entryFormat}" (use: ${validFormats.join(', ')})`);
      }

      const entryReport = (spec.reportNum ?? '').toString().trim();
      if (entryReport && !/^\d+$/.test(entryReport)) {
        throw new Error(`invalid reportNum "${entryReport}" (use the numeric report number)`);
      }

      // Resolve manifest-supplied input/output relative to the manifest's own
      // directory, not process.cwd(), so a manifest renders identically wherever
      // the batch is launched from. Absolute paths in the manifest still win
      // (resolve() ignores the base when the tail is absolute).
      const entryInput = resolve(manifestDir, spec.input);
      const entryOutput = resolve(manifestDir, spec.output);

      // Path-containment guards (realpath-based): keep the read and write inside
      // the tracker workspace even through a symlinked ancestor. A batch
      // manifest that escapes the workspace is malformed/tampered and is
      // recorded as a per-entry failure rather than read or written.
      assertInsideWorkspace(entryInput, 'input');
      if (!isWorkspaceOutputPath(entryOutput, workspaceRoot)) {
        throw new Error(`output escapes the tracker workspace: ${entryOutput}`);
      }

      let html = await readFile(entryInput, 'utf-8');
      validateCvSectionOrder(html, cvMarkdown, { allowReorder: globals.allowReorder });
      html = normalizeTextForATS(html).html;

      entries.push({
        _idx: i,
        html,
        outputPath: entryOutput,
        format: entryFormat,
        baseDir: dirname(entryInput),
        reportNum: entryReport,
        inputPath: entryInput,
        maxPages: globals.maxPages,
        strictPages: globals.strictPages,
      });
    } catch (err) {
      console.error(`❌ Skipping batch entry ${i} (${spec?.output ?? '?'}): ${err.message}`);
      // Record outputPath with the same manifest-dir-resolved absolute convention
      // successful entries use, so consumers see one path shape across ok/failed
      // results; null stays null when the entry named no output.
      const failedOutput = spec && typeof spec.output === 'string' ? resolve(manifestDir, spec.output) : null;
      results[i] = { outputPath: failedOutput, ok: false, error: err.message };
    }
  }

  if (entries.length > 0) {
    console.log(`📦 Batch: rendering ${entries.length} document(s) in one Chromium…`);
    const rendered = await renderBatch(entries);
    rendered.forEach((r, k) => { results[entries[k]._idx] = r; });
  }

  const ok = results.filter((r) => r && r.ok).length;
  const failed = results.length - ok;

  const resultsPath = `${resolvedManifest}.results.json`;
  try {
    // resolvedManifest is already contained, so this sibling is too; assert
    // explicitly so the write can never land outside the workspace.
    assertInsideWorkspace(resultsPath, 'batch results');
    writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n');
    console.log(`🔗 Batch results: ${resultsPath}`);
  } catch (err) {
    console.error(`⚠️  Could not write batch results manifest: ${err.message}`);
    // A failed results write is itself a batch failure: consumers rely on the
    // manifest, so exit non-zero even when every entry rendered fine.
    process.exitCode = 1;
  }

  console.log(`📦 Batch complete: ${ok} ok, ${failed} failed`);
  // Signal failure via exitCode, not process.exit(1): the latter can truncate
  // buffered stdout (the summary + results-path logs above) before it flushes.
  // Returning normally lets in-process callers read the full breakdown and the
  // process still exits non-zero once the event loop drains.
  if (failed > 0) process.exitCode = 1;
  return { ok, failed, results };
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
 * Encoded font data: URLs are memoized across calls (keyed by resolved absolute
 * path, not name — two fonts can share a display name but not a path) so a
 * batch render does not re-read and re-base64 the same font once per document.
 * The cache holds only successful encodings; a missing font is re-checked each
 * call so a font added mid-run is picked up. The bytes are deterministic, so a
 * cache hit returns the exact same data: URL — output stays byte-identical.
 *
 * Cache lifetime and invalidation: the cache lives only for the duration of a
 * single CLI run (a module-level Map, never persisted). It is keyed by path and
 * is deliberately NOT invalidated when a font file changes or is deleted mid-run
 * — once a path is cached, that path serves the first-read bytes for the rest of
 * the run even if the file is later edited or removed on disk (no mtime/size
 * stat check). This is intentional: a batch renders from a fixed set of fonts and
 * relies on the stale-on-deletion behavior to stay byte-identical; the next CLI
 * run starts with an empty cache and re-reads from disk.
 *
 * @param {string} html - HTML that may reference url('./fonts/<file>').
 * @returns {Promise<string>} HTML with local font references inlined.
 */
const _fontDataUrlCache = new Map();

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
    if (_fontDataUrlCache.has(fontPath)) {
      dataUrls.set(name, _fontDataUrlCache.get(fontPath));
      continue;
    }
    try {
      const buf = await readFile(fontPath);
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      const dataUrl = `url('data:${MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}')`;
      _fontDataUrlCache.set(fontPath, dataUrl);
      dataUrls.set(name, dataUrl);
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
  const launchBrowser = opts.launchBrowser || ((options) => chromium.launch(options));
  let browser = null;
  try {
    browser = await launchBrowser({ headless: true });
    return await renderInPage(browser, html, outputPath, opts);
  } finally {
    if (browser) {
      await browser.close().catch((err) => {
        console.warn(`⚠️  Browser cleanup failed: ${err.message}`);
      });
    }
  }
}

/**
 * Render one already-normalized HTML document to a PDF on an already-launched
 * browser. This is the page-level half of the render — it owns the per-document
 * work (theme/print/font injection, temp file, page, PDF, page-budget, manifest)
 * but NOT the browser lifecycle. Both the single-CV path (renderHtmlToPdf) and
 * the batch path (renderBatch) call this exact function, which is what keeps a
 * single-CV render byte-identical whether it runs alone or inside a batch (#2384).
 *
 * The page and the temp HTML file are always cleaned up in a finally, so a
 * throw here (e.g. a strict page-budget overflow) never leaks a page into the
 * shared browser — the caller's remaining documents keep their own fresh pages.
 *
 * @param {import('playwright').Browser} browser - An open browser to render on.
 * @param {string} html - Full HTML document to render.
 * @param {string} outputPath - Absolute path to write the PDF to.
 * @param {{
 *   format?: 'a4'|'letter',
 *   baseDir?: string,
 *   reportNum?: string,
 *   inputPath?: string,
 *   maxPages?: number,
 *   strictPages?: boolean,
 *   styleTokens?: object
 * }} [opts]
 * @returns {Promise<{outputPath: string, pageCount: number, size: number}>}
 */
async function renderInPage(browser, html, outputPath, opts = {}) {
  const format = opts.format || 'a4';
  const baseDir = opts.baseDir || process.cwd();
  const reportNum = opts.reportNum || '';
  const inputPath = opts.inputPath || '';

  mkdirSync(dirname(outputPath), { recursive: true });

  // Inject the user's theme tokens (config/profile.yml `style:`) as CSS custom
  // properties so the templates' var(--x, <default>) reads pick them up (#1837).
  // No `style:` block → no tokens → byte-identical output. Both the CV path and
  // the cover-letter path flow through here, so both are themed from one place.
  const styleTokens = opts.styleTokens ?? readStyleTokens();
  html = injectThemeStyle(html, styleTokens);

  html = injectPrintPageCss(html, format);
  html = await inlineLocalFonts(html);

  // Write HTML to a temp file in baseDir so page.goto() gives a file://
  // origin that can load local images, fonts, and other resources.
  const tmpHtmlPath = resolve(baseDir, `.career-ops-render-${randomUUID()}.html`);
  const { writeFile, unlink } = await import('fs/promises');
  await writeFile(tmpHtmlPath, html, 'utf-8');

  let page = null;
  let context = null;
  try {
    // A CV is static markup, so the renderer needs neither scripts nor the network.
    // Both are denied because this HTML is not fully trusted: it is built from
    // cv.md, the job posting and the evaluation report, and postings are untrusted
    // input (AGENTS.md). With JS off an injected <script> cannot run; with
    // non-local requests aborted an injected <img src="https://…"> cannot beacon
    // out. file:/data: subresources still load, which is all a template needs.
    //
    // newContext(), not newPage(): javaScriptEnabled is a Playwright context
    // option with no per-page equivalent, and a fresh context per document also
    // keeps each render isolated from its siblings within one shared browser
    // (#2384). Guarded so an injected test double that only implements newPage()
    // still works.
    context = browser.newContext
      ? await browser.newContext({ javaScriptEnabled: false })
      : null;
    page = context ? await context.newPage() : await browser.newPage();
    if (page.route) {
      await page.route('**/*', (route) => {
        const url = route.request().url();
        return url.startsWith('file:') || url.startsWith('data:')
          ? route.continue()
          : route.abort();
      });
    }

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
    // Close the page so a batch does not accumulate pages into the shared
    // browser (leak → OOM). Optional-chained: the single path's browser.close()
    // already reclaims the page, and minimal test doubles may omit close().
    if (page && typeof page.close === 'function') {
      await page.close().catch((err) => {
        console.warn(`⚠️  Page cleanup failed: ${err.message}`);
      });
    }
    // Close the per-document context too, so the JS-disabled context created
    // above does not accumulate in the shared browser across a batch (#2384).
    if (context && typeof context.close === 'function') {
      await context.close().catch((err) => {
        console.warn(`⚠️  Context cleanup failed: ${err.message}`);
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

/**
 * Render many already-normalized HTML documents through ONE shared Chromium.
 *
 * Maintainer conditions (#2384): the browser is launched once via the same
 * opts.launchBrowser seam the single path uses, and closed in a finally at the
 * batch boundary — it never outlives the batch and is torn down even if a
 * document throws. Each entry renders on its own page (renderInPage), and a
 * failing entry is captured as `{ok:false, error}` without stopping the rest.
 *
 * The browser is owned here: renderBatch closes whatever launchBrowser returns.
 * launchBrowser is a launch *factory*, not a caller-owned handle, so this does
 * not break test injection — the stub returns a fresh browser to be closed.
 *
 * Rendering is intentionally serial: a shared module-level font cache and one
 * long-lived browser make parallel rendering a determinism/memory hazard that
 * this change does not take on.
 *
 * @param {Array<{html: string, outputPath: string, format?: string, baseDir?: string,
 *   reportNum?: string, inputPath?: string, maxPages?: number, strictPages?: boolean}>} entries
 * @param {{launchBrowser?: (options: {headless: boolean}) => Promise<import('playwright').Browser>}} [opts]
 * @returns {Promise<Array<{outputPath: string, ok: boolean, pageCount?: number, size?: number, error?: string}>>}
 */
export async function renderBatch(entries, opts = {}) {
  const launchBrowser = opts.launchBrowser || ((options) => chromium.launch(options));
  const results = [];
  let browser = null;
  try {
    try {
      browser = await launchBrowser({ headless: true });
    } catch (err) {
      // A shared-browser launch failure is fatal to every document, but it must
      // NOT escape as an uncaught throw: record a failed result for each entry so
      // runBatchFromManifest still writes a complete results manifest and takes
      // the existing non-zero exit path, instead of crashing before either (#2384).
      console.error(`❌ Batch browser launch failed: ${err.message}`);
      for (const entry of entries) {
        results.push({ outputPath: entry.outputPath, ok: false, error: `browser launch failed: ${err.message}` });
      }
      return results;
    }
    for (const entry of entries) {
      try {
        const r = await renderInPage(browser, entry.html, entry.outputPath, entry);
        results.push({ outputPath: entry.outputPath, ok: true, pageCount: r.pageCount, size: r.size });
      } catch (err) {
        console.error(`❌ Batch entry failed (${entry.outputPath}): ${err.message}`);
        results.push({ outputPath: entry.outputPath, ok: false, error: err.message });
      }
    }
    return results;
  } finally {
    if (browser) {
      await browser.close().catch((err) => {
        console.warn(`⚠️  Browser cleanup failed: ${err.message}`);
      });
    }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  generatePDF().catch((err) => {
    console.error('❌ PDF generation failed:', err.message);
    process.exit(1);
  });
}

export { normalizeTextForATS, sectionKey };
