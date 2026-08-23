#!/usr/bin/env node
/**
 * i18n-drift.mjs — Structural drift checker for translated modes
 *
 * Compares each modes/{lang}/X.md against its canonical modes/X.md by
 * section-heading presence (not prose quality). Reports per-language,
 * per-file coverage: sections present / total, and which headings are missing.
 *
 * Usage:
 *   node i18n-drift.mjs                         # full scan, all languages
 *   node i18n-drift.mjs --lang tr               # single language
 *   node i18n-drift.mjs --lang tr --lang ru     # multiple languages
 *   node i18n-drift.mjs --json                  # machine-readable output
 *   node i18n-drift.mjs --threshold 0.8         # warn when coverage < 80 %
 *   node i18n-drift.mjs <canonical> <translated> # two-file comparison (legacy)
 *
 * Exit codes:
 *   0  all checked files meet the threshold (default 0 — CI warn mode)
 *   1  one or more files are below the threshold (only when --threshold is set)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------------------
// Heading / section extraction
// ---------------------------------------------------------------------------

/**
 * Extract all ATX headings from markdown text.
 * Returns `{ level, text, line }[]` in document order.
 *
 * @param {string} text
 * @returns {{ level: number, text: string, line: number }[]}
 */
export function extractHeadings(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (!match) return null;
      return {
        level: match[1].length,
        text: match[2].trim(),
        line: index,
      };
    })
    .filter(Boolean);
}

/**
 * Extract sections (headings annotated with their line-count span).
 *
 * @param {string} text
 * @returns {{ level: number, text: string, line: number, startLine: number, endLine: number, lineCount: number }[]}
 */
export function extractSections(text) {
  const headings = extractHeadings(text);
  const totalLines = text.split(/\r?\n/).length;

  return headings.map((heading, index) => {
    const nextHeading = headings[index + 1];
    const endLine = nextHeading ? nextHeading.line : totalLines;
    return {
      ...heading,
      startLine: heading.line,
      endLine,
      lineCount: endLine - heading.line,
    };
  });
}

// ---------------------------------------------------------------------------
// Structural comparison
// ---------------------------------------------------------------------------

/**
 * Compare the structure of a translated document against its canonical source.
 *
 * Matching strategy:
 *   - Canonical headings are matched positionally against translated headings
 *     at the same heading level, in order. A canonical heading is considered
 *     "covered" if a translated heading exists at the same ordinal position
 *     within its level group.
 *   - "Missing" = canonical headings that have no corresponding translated
 *     heading at the same ordinal + level position.
 *
 * This catches trailing drift (sections added to canonical that weren't
 * back-ported to the translation) — exactly the issue described in #1666.
 *
 * @param {string} canonicalText
 * @param {string} translatedText
 * @returns {{
 *   covered: number,
 *   total: number,
 *   coverage: number,
 *   canonicalCount: number,
 *   translatedCount: number,
 *   missing: { text: string, level: number }[]
 * }}
 */
export function compareStructure(canonicalText, translatedText) {
  const canonical = extractSections(canonicalText);
  const translated = extractSections(translatedText);

  if (canonical.length === 0) {
    return {
      covered: 0,
      total: 0,
      coverage: 1,
      canonicalCount: 0,
      translatedCount: translated.length,
      missing: [],
    };
  }

  // Build per-level ordinal counters for translated headings.
  // translatedByLevel[level] = array of translated headings at that level (in order).
  const translatedByLevel = new Map();
  for (const s of translated) {
    if (!translatedByLevel.has(s.level)) translatedByLevel.set(s.level, []);
    translatedByLevel.get(s.level).push(s);
  }

  // For each canonical heading, consume the corresponding ordinal slot in the
  // translated document. If no slot exists → missing.
  const canonicalByLevel = new Map();
  const missing = [];

  for (const section of canonical) {
    if (!canonicalByLevel.has(section.level)) {
      canonicalByLevel.set(section.level, 0);
    }
    const idx = canonicalByLevel.get(section.level);
    canonicalByLevel.set(section.level, idx + 1);

    const translatedAtLevel = translatedByLevel.get(section.level) ?? [];
    if (idx >= translatedAtLevel.length) {
      missing.push({ text: section.text, level: section.level });
    }
  }

  const total = canonical.length;
  const covered = total - missing.length;

  return {
    covered,
    total,
    coverage: total === 0 ? 1 : covered / total,
    canonicalCount: canonical.length,
    translatedCount: translated.length,
    missing,
  };
}

// ---------------------------------------------------------------------------
// README-based canonical mapping
// ---------------------------------------------------------------------------

/**
 * Parse a lang-dir README.md to discover which translated filename maps to
 * which canonical modes/*.md file.
 *
 * READMEs contain a markdown table like:
 *   | `is-ilani.md` | `modes/oferta.md` (ES) | … |
 *   | `fursah.md`   | `modes/oferta.md` (ES) | … |
 *
 * Returns a Map<translatedBasename, canonicalBasename>.
 *
 * @param {string} readmePath  absolute path to the lang README.md
 * @returns {Map<string, string>}
 */
export function parseReadmeMapping(readmePath) {
  const map = new Map();
  if (!existsSync(readmePath)) return map;

  const lines = readFileSync(readmePath, 'utf-8').split(/\r?\n/);

  for (const line of lines) {
    // Match table rows that contain at least two pipe-delimited cells.
    // Cell 1: translated file (e.g. `is-ilani.md` or is-ilani.md)
    // Cell 2: canonical reference (e.g. `modes/oferta.md` (ES))
    const rowMatch = line.match(/^\s*\|([^|]+)\|([^|]+)\|/);
    if (!rowMatch) continue;

    const cell1 = rowMatch[1].trim().replace(/`/g, '');
    const cell2 = rowMatch[2].trim().replace(/`/g, '');

    // cell1 must look like a markdown filename
    if (!cell1.endsWith('.md')) continue;

    // cell2 must contain a modes/ reference
    const canonicalMatch = cell2.match(/modes\/([^/\s(]+\.md)/);
    if (!canonicalMatch) continue;

    const translatedBase = basename(cell1);
    const canonicalBase = canonicalMatch[1];

    // Skip self-referential mappings (e.g. README mapping itself)
    if (translatedBase === 'README.md') continue;

    map.set(translatedBase, canonicalBase);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Language-directory scanning
// ---------------------------------------------------------------------------

/** Directories inside modes/ that are NOT language directories. */
const MODES_NON_LANG_DIRS = new Set([
  'heuristics',
  'interview',
  'pdf',
  'regional',
]);

/**
 * Discover all language directories under modes/.
 * Returns string[] of language codes (e.g. ['ar', 'de', 'tr', ...]).
 *
 * @returns {string[]}
 */
export function discoverLangs() {
  const modesDir = join(ROOT, 'modes');
  return readdirSync(modesDir)
    .filter(entry => {
      if (MODES_NON_LANG_DIRS.has(entry)) return false;
      try {
        return statSync(join(modesDir, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Resolve the canonical modes/*.md path for a translated file.
 *
 * Resolution order:
 *   1. README-declared mapping for this lang dir.
 *   2. Identical filename exists in canonical modes/ root.
 *   3. No mapping found → returns null.
 *
 * @param {string} translatedBase  basename of the translated file
 * @param {Map<string, string>} readmeMap  parsed from README.md
 * @returns {string|null}  basename of the canonical file, or null
 */
export function resolveCanonical(translatedBase, readmeMap) {
  // Skip non-content files
  if (translatedBase === 'README.md') return null;

  // README-declared mapping
  if (readmeMap.has(translatedBase)) {
    return readmeMap.get(translatedBase);
  }

  // Same-name file in canonical root
  const candidatePath = join(ROOT, 'modes', translatedBase);
  if (existsSync(candidatePath)) {
    return translatedBase;
  }

  return null;
}

/**
 * Run the drift check for a single language directory.
 *
 * @param {string} lang  language code
 * @returns {{
 *   lang: string,
 *   files: Array<{
 *     translated: string,
 *     canonical: string|null,
 *     result: object|null,
 *     skipped: boolean,
 *     skipReason?: string
 *   }>
 * }}
 */
export function checkLang(lang) {
  const langDir = join(ROOT, 'modes', lang);
  const readmeMap = parseReadmeMapping(join(langDir, 'README.md'));

  const entries = readdirSync(langDir)
    .filter(f => {
      try {
        return !statSync(join(langDir, f)).isDirectory() && f.endsWith('.md');
      } catch {
        return false;
      }
    })
    .sort();

  const files = [];

  for (const translatedBase of entries) {
    if (translatedBase === 'README.md') continue;

    const canonicalBase = resolveCanonical(translatedBase, readmeMap);

    if (!canonicalBase) {
      files.push({
        translated: translatedBase,
        canonical: null,
        result: null,
        skipped: true,
        skipReason: 'no canonical mapping found',
      });
      continue;
    }

    const canonicalPath = join(ROOT, 'modes', canonicalBase);
    if (!existsSync(canonicalPath)) {
      files.push({
        translated: translatedBase,
        canonical: canonicalBase,
        result: null,
        skipped: true,
        skipReason: `canonical modes/${canonicalBase} not found`,
      });
      continue;
    }

    const canonicalText = readFileSync(canonicalPath, 'utf-8');
    const translatedText = readFileSync(join(langDir, translatedBase), 'utf-8');
    const result = compareStructure(canonicalText, translatedText);

    files.push({
      translated: translatedBase,
      canonical: canonicalBase,
      result,
      skipped: false,
    });
  }

  return { lang, files };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const PCT = (n) => `${Math.round(n * 100)}%`;

/**
 * Render the per-language, per-file coverage table as a human-readable string.
 *
 * @param {ReturnType<typeof checkLang>[]} langResults
 * @param {object} opts
 * @param {number} [opts.threshold]  coverage threshold (0–1) for marking failures
 * @returns {string}
 */
export function formatReport(langResults, { threshold = 0 } = {}) {
  const lines = [];

  for (const { lang, files } of langResults) {
    const checked = files.filter(f => !f.skipped);
    if (checked.length === 0) {
      lines.push(`\n── ${lang.toUpperCase()} ──────────────────────────────`);
      lines.push('  (no files with a known canonical mapping)');
      continue;
    }

    const langTotal = checked.reduce((s, f) => s + f.result.total, 0);
    const langCovered = checked.reduce((s, f) => s + f.result.covered, 0);
    const langPct = langTotal === 0 ? 1 : langCovered / langTotal;

    lines.push(
      `\n── ${lang.toUpperCase()} ─────────────────────────────── ` +
      `${langCovered}/${langTotal} sections (${PCT(langPct)})`
    );

    for (const f of files) {
      if (f.skipped) {
        lines.push(`  ${f.translated.padEnd(25)} [skipped: ${f.skipReason}]`);
        continue;
      }
      const { covered, total, coverage, missing } = f.result;
      const bar = coverage >= threshold ? '✓' : '✗';
      lines.push(
        `  ${bar} ${f.translated.padEnd(25)} → modes/${f.canonical.padEnd(25)} ` +
        `${covered}/${total} (${PCT(coverage)})`
      );
      if (missing.length > 0) {
        for (const m of missing) {
          const hashes = '#'.repeat(m.level);
          lines.push(`      missing: ${hashes} ${m.text}`);
        }
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

/**
 * Render coverage results as a JSON-serialisable object.
 *
 * @param {ReturnType<typeof checkLang>[]} langResults
 * @returns {object}
 */
export function toJSON(langResults) {
  return langResults.map(({ lang, files }) => ({
    lang,
    files: files.map(f => ({
      translated: f.translated,
      canonical: f.canonical,
      skipped: f.skipped,
      skipReason: f.skipReason ?? null,
      covered: f.result?.covered ?? null,
      total: f.result?.total ?? null,
      coveragePct: f.result ? Math.round(f.result.coverage * 100) : null,
      missing: f.result?.missing ?? [],
    })),
    summary: (() => {
      const checked = files.filter(f => !f.skipped);
      const total = checked.reduce((s, f) => s + f.result.total, 0);
      const covered = checked.reduce((s, f) => s + f.result.covered, 0);
      return {
        filesChecked: checked.length,
        sectionsTotal: total,
        sectionsCovered: covered,
        coveragePct: total === 0 ? 100 : Math.round((covered / total) * 100),
      };
    })(),
  }));
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function printUsage() {
  console.error([
    'Usage:',
    '  node i18n-drift.mjs                     # full scan, all languages',
    '  node i18n-drift.mjs --lang tr           # single language',
    '  node i18n-drift.mjs --lang tr --lang ru # multiple languages',
    '  node i18n-drift.mjs --json              # machine-readable output',
    '  node i18n-drift.mjs --threshold 0.8     # exit 1 if any file < 80%',
    '  node i18n-drift.mjs <canonical> <translated>  # two-file comparison',
  ].join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);

  // ── Legacy two-file comparison mode ────────────────────────────────────
  // Detect when both positional args look like file paths (not flags).
  const positional = args.filter(a => !a.startsWith('--'));
  if (positional.length >= 2 && !args.includes('--lang')) {
    const [canonicalFile, translatedFile] = positional;

    const canonicalPath = resolve(ROOT, canonicalFile);
    const translatedPath = resolve(ROOT, translatedFile);

    if (!existsSync(canonicalPath)) {
      console.error(`Error: canonical file not found: ${canonicalFile}`);
      process.exit(1);
    }
    if (!existsSync(translatedPath)) {
      console.error(`Error: translated file not found: ${translatedFile}`);
      process.exit(1);
    }

    const result = compareStructure(
      readFileSync(canonicalPath, 'utf-8'),
      readFileSync(translatedPath, 'utf-8')
    );

    console.log(
      `${translatedFile}: ${result.covered}/${result.total} sections ` +
      `(${PCT(result.coverage)})`
    );

    if (result.missing.length > 0) {
      console.log('Missing sections:');
      for (const section of result.missing) {
        console.log(`  - ${'#'.repeat(section.level)} ${section.text}`);
      }
    }
    process.exit(0);
  }

  // ── Full / per-lang scan mode ───────────────────────────────────────────
  const wantsJson = args.includes('--json');
  const wantsSummary = args.includes('--summary');

  // Collect --lang values
  const requestedLangs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lang' && args[i + 1]) {
      requestedLangs.push(args[i + 1]);
      i++;
    }
  }

  // --threshold <float>
  let threshold = 0;
  const thIdx = args.indexOf('--threshold');
  if (thIdx !== -1 && args[thIdx + 1]) {
    const parsed = parseFloat(args[thIdx + 1]);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      threshold = parsed;
    } else {
      console.error(`Error: --threshold must be a number between 0 and 1, got: ${args[thIdx + 1]}`);
      process.exit(1);
    }
  }

  const langs = requestedLangs.length > 0 ? requestedLangs : discoverLangs();

  // Validate requested langs
  const allLangs = new Set(discoverLangs());
  for (const l of langs) {
    if (!allLangs.has(l)) {
      console.error(`Error: language directory not found: modes/${l}/`);
      process.exit(1);
    }
  }

  const results = langs.map(checkLang);

  if (wantsJson) {
    console.log(JSON.stringify(toJSON(results), null, 2));
  } else if (wantsSummary) {
    // One-line-per-lang summary
    for (const { lang, files } of results) {
      const checked = files.filter(f => !f.skipped);
      const total = checked.reduce((s, f) => s + f.result.total, 0);
      const covered = checked.reduce((s, f) => s + f.result.covered, 0);
      const pct = total === 0 ? 100 : Math.round((covered / total) * 100);
      console.log(`${lang.padEnd(6)} ${covered}/${total} (${pct}%)`);
    }
  } else {
    console.log('i18n drift report — career-ops modes/');
    console.log('======================================');
    console.log(formatReport(results, { threshold }));
    console.log('');
  }

  // Exit non-zero only when a threshold is set and any file is below it
  if (threshold > 0) {
    let anyBelow = false;
    for (const { files } of results) {
      for (const f of files) {
        if (!f.skipped && f.result.coverage < threshold) {
          anyBelow = true;
          break;
        }
      }
    }
    if (anyBelow) {
      if (!wantsJson && !wantsSummary) {
        console.error(
          `\nFAIL: one or more files are below the coverage threshold of ${PCT(threshold)}`
        );
      }
      process.exit(1);
    }
  }
}