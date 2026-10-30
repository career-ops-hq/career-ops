#!/usr/bin/env node
/**
 * Structural coverage of translated modes (#3168). Offline, read-only, Node only.
 * Adapted from alinaqvi1129's initial checker in PR #3228.
 *
 * node i18n-drift.mjs [--lang tr ...] [--json | --summary]
 * Drift is advisory (exit 0); invalid arguments or unreadable inputs exit 1.
 *
 * Compare heading levels IN ORDER, never translated words. Coverage measures
 * structural slots, not translation completeness: equal-shaped replacements,
 * changed prose and empty sections cannot be detected. Fenced report examples
 * are excluded; their contract belongs to the evaluation-template parity gate.
 * Without stable section IDs, repeated levels can have multiple alignments.
 * Report all possible missing locations instead of inventing a missing name.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';
import { isNestedCheckout } from './lib/mjs-files.mjs';
import { walkTree } from './lib/walk-tree.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const LANGUAGE = /^[a-z]{2}(?:-[A-Za-z0-9]{2,8})*$/;

/** Top-level Markdown ATX/setext headings, with one-based source lines. */
export function extractHeadings(text) {
  const headings = [];
  let fence = null;
  let comment = false;
  let paragraph = null;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (fence) {
      const close = raw.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    // Comment-looking text in code is literal, including fence info strings.
    const rawOpen = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!comment && rawOpen && (rawOpen[1][0] !== '`' || !rawOpen[2].includes('`'))) {
      fence = rawOpen[1];
      paragraph = null;
      continue;
    }
    if (!comment && /^(?: {4}|\t)/.test(raw)) { paragraph = null; continue; }
    let line = '';
    let rest = raw;
    while (rest) {
      if (comment) {
        const end = rest.indexOf('-->');
        if (end < 0) break;
        rest = rest.slice(end + 3);
        comment = false;
      } else {
        if (rest.startsWith('\\')) {
          line += rest.slice(0, 2);
          rest = rest.slice(2);
        } else if (rest.startsWith('`')) {
          const ticks = rest.match(/^`+/)[0];
          const close = [...rest.slice(ticks.length).matchAll(/`+/g)].find(match => match[0].length === ticks.length);
          const end = close ? ticks.length + close.index + ticks.length : ticks.length;
          line += rest.slice(0, end);
          rest = rest.slice(end);
        } else if (rest.startsWith('<!--')) {
          rest = rest.slice(4);
          comment = true;
        } else {
          line += rest[0];
          rest = rest.slice(1);
        }
      }
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open && (open[1][0] !== '`' || !open[2].includes('`'))) {
      fence = open[1];
      paragraph = null;
      continue;
    }
    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/);
    if (atx) {
      headings.push({ level: atx[1].length, text: (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim(), line: index + 1 });
      paragraph = null;
      continue;
    }
    const setext = line.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (setext && paragraph) {
      headings.push({ level: setext[1][0] === '=' ? 1 : 2, ...paragraph });
      paragraph = null;
      continue;
    }
    // Indented code, list/quote blocks and thematic breaks are not paragraphs.
    if (!line.trim() || /^(?: {4}|\t| {0,3}(?:>|[-+*] |\d+[.)] |[-*_]{3,}\s*$))/.test(line)) {
      paragraph = null;
    } else {
      paragraph = paragraph ? { ...paragraph, text: `${paragraph.text} ${line.trim()}` } : { text: line.trim(), line: index + 1 };
    }
  }
  return headings;
}

/**
 * Longest common subsequence of heading levels. Prefix/suffix tables let us
 * inspect ALL optimal alignments: an unmatched heading is certain only when
 * none can match it. Candidate count is not the number of missing sections.
 */
export function compareStructure(canonicalText, translatedText) {
  const canonical = extractHeadings(canonicalText);
  const translated = extractHeadings(translatedText);
  const n = canonical.length;
  const m = translated.length;
  const table = () => Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  const prefix = table();
  const suffix = table();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      prefix[i + 1][j + 1] = canonical[i].level === translated[j].level
        ? prefix[i][j] + 1 : Math.max(prefix[i][j + 1], prefix[i + 1][j]);
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      suffix[i][j] = canonical[i].level === translated[j].level
        ? suffix[i + 1][j + 1] + 1 : Math.max(suffix[i + 1][j], suffix[i][j + 1]);
    }
  }
  const covered = suffix[0][0];
  const missing = [];
  const candidates = [];
  for (let i = 0; i < n; i++) {
    let canMatch = false;
    let canSkip = false;
    for (let j = 0; j <= m; j++) {
      if (prefix[i][j] + suffix[i + 1][j] === covered) canSkip = true;
      if (j < m && canonical[i].level === translated[j].level && prefix[i][j] + 1 + suffix[i + 1][j + 1] === covered) canMatch = true;
    }
    if (!canMatch) missing.push(canonical[i]);
    else if (canSkip) candidates.push(canonical[i]);
  }
  return {
    covered, total: n, coverage: n ? covered / n : 1,
    canonicalCount: n, translatedCount: m,
    missingCount: n - covered, extraCount: m - covered, missing, candidates,
  };
}

function modePath(value) {
  return typeof value === 'string' && value.endsWith('.md')
    && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..')
    && !value.startsWith('/') && !value.includes(':')
    && !/^(?:README\.md|_profile(?:\.template)?\.md|_custom(?:\.template)?\.md)$/i.test(posix.basename(value));
}

// Do not follow symlinks or nested checkouts while reading mode sources.
function sourcePath(root, relativePath) {
  let path = root;
  for (const part of ['modes', ...relativePath.split('/')]) {
    path = join(path, part);
    if (!existsSync(path)) return null;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (stat.isDirectory() && isNestedCheckout(path))) return null;
  }
  return path;
}

/** README table: translated filename -> source path relative to modes/. */
export function parseReadmeMapping(readmePath) {
  const map = new Map();
  if (!readmePath || !existsSync(readmePath)) return map;
  for (const line of readFileSync(readmePath, 'utf8').split(/\r?\n/)) {
    const row = line.match(/^\s*\|([^|]+)\|([^|]+)\|/);
    if (!row) continue;
    const translated = row[1].trim().replace(/`/g, '');
    const canonical = row[2].match(/\bmodes\/([^`\s()|]+\.md)/)?.[1];
    if (modePath(translated) && modePath(canonical)) map.set(translated, canonical);
  }
  return map;
}

export function discoverLangs(root = ROOT) {
  const dir = sourcePath(root, '');
  if (!dir || !lstatSync(dir).isDirectory()) throw new Error('modes/ directory not found');
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => LANGUAGE.test(entry.name) && entry.isDirectory() && !isNestedCheckout(join(dir, entry.name)))
    .map(entry => entry.name).sort();
}

function markdownFiles(dir) {
  // The root is vetted here because walkTree deliberately never tests its own
  // root — a language directory that IS a checkout, or a link, is not ours.
  if (!dir || !existsSync(dir) || !lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink() || isNestedCheckout(dir)) return [];
  // Below it, walkTree skips nested checkouts and scratch copies on every
  // descent, and ignores links by default, as the Dirent-based recursion this
  // replaced did.
  return walkTree(dir, { skip: (entry) => entry.name.startsWith('.') })
    .filter((abs) => modePath(basename(abs)))
    .map((abs) => relative(dir, abs).split(sep).join('/'))
    .sort();
}

/** Compare the shipped subset, plus README-promised files that were deleted. */
export function checkLang(lang, root = ROOT) {
  if (!discoverLangs(root).includes(lang)) throw new Error(`language directory not found: modes/${lang}/`);
  const maps = new Map();
  const mapping = (language) => {
    if (!maps.has(language)) maps.set(language, parseReadmeMapping(sourcePath(root, `${language}/README.md`)));
    return maps.get(language);
  };
  const canonicalFor = (language, file, seen = new Set()) => {
    const key = `${language}/${file}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const source = mapping(language).get(file) ?? file;
    const [first, ...tail] = source.split('/');
    // Some languages translate another locale (NL -> FR); follow its declared
    // source to the canonical root rather than measuring two stale mirrors.
    if (tail.length && LANGUAGE.test(first)) return canonicalFor(first, tail.join('/'), seen);
    return modePath(source) ? source : null;
  };
  const names = new Set([...markdownFiles(sourcePath(root, lang)), ...mapping(lang).keys()]);
  const files = [...names].sort().map(translated => {
    const canonical = canonicalFor(lang, translated);
    const canonicalPath = canonical && sourcePath(root, canonical);
    const base = { translated, canonical, result: null, skipped: false };
    if (!canonicalPath || !lstatSync(canonicalPath).isFile()) {
      return { ...base, skipped: true, skipReason: canonical ? `canonical modes/${canonical} not found or excluded` : 'cyclic or invalid canonical mapping' };
    }
    const translatedPath = sourcePath(root, `${lang}/${translated}`);
    const missingFile = !translatedPath || !lstatSync(translatedPath).isFile();
    return {
      ...base, missingFile,
      result: compareStructure(readFileSync(canonicalPath, 'utf8'), missingFile ? '' : readFileSync(translatedPath, 'utf8')),
    };
  });
  return { lang, files };
}

function summarize(files) {
  const checked = files.filter(file => !file.skipped);
  const sum = key => checked.reduce((total, file) => total + file.result[key], 0);
  return {
    filesChecked: checked.length, filesSkipped: files.length - checked.length,
    sectionsCovered: sum('covered'), sectionsTotal: sum('total'),
    missingCount: sum('missingCount'), extraCount: sum('extraCount'),
  };
}

export function toJSON(results) {
  return results.map(result => ({ ...result, summary: summarize(result.files) }));
}

const percent = result => result.total ? `${Math.round(result.coverage * 100)}%` : 'n/a';

export function formatReport(results, { summary = false } = {}) {
  const lines = ['i18n structural coverage (heading levels/order; not translation quality)'];
  for (const { lang, files, summary: stats } of toJSON(results)) {
    lines.push(`\n${lang}: ${stats.sectionsCovered}/${stats.sectionsTotal} sections; ${stats.filesChecked} files checked, ${stats.filesSkipped} skipped`);
    if (summary) continue;
    lines.push('| Translation | Canonical | Covered / total | Structural difference |', '| --- | --- | --- | --- |');
    const cell = value => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
    for (const file of files) {
      const label = `modes/${lang}/${file.translated}`;
      if (file.skipped) {
        lines.push(`| ${cell(label)} | ${cell(file.canonical ?? '—')} | — | skipped: ${cell(file.skipReason)} |`);
        continue;
      }
      const r = file.result;
      const difference = file.missingFile ? 'missing file' : `${r.missingCount} missing slots; ${r.extraCount} extra/unmatched headings`;
      lines.push(`| ${cell(label)} | modes/${cell(file.canonical)} | ${r.covered}/${r.total} (${percent(r)}) | ${difference} |`);
    }
    for (const file of files.filter(file => !file.skipped && file.result.missingCount)) {
      lines.push(`\n${file.translated} — canonical locations to review:`);
      for (const h of file.result.missing) lines.push(`  missing structural slot: modes/${file.canonical}:${h.line} ${'#'.repeat(h.level)} ${h.text}`);
      if (file.result.candidates.length) {
        lines.push(`  ${file.result.missingCount - file.result.missing.length} further slot(s) missing; exact identity is ambiguous among:`);
        for (const h of file.result.candidates) lines.push(`    modes/${file.canonical}:${h.line} ${'#'.repeat(h.level)} ${h.text}`);
      }
    }
  }
  lines.push('\n100% means compatible heading structure only. Same-shaped omissions, prose changes and translation quality are not measured.');
  return lines.join('\n');
}

function main(args) {
  const langs = [];
  let json = false;
  let summary = false;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lang' || args[i].startsWith('--lang=')) {
      const lang = args[i] === '--lang' ? args[++i] : args[i].slice('--lang='.length);
      if (!lang || !LANGUAGE.test(lang)) throw new Error('--lang requires a language code, e.g. tr or zh-TW');
      langs.push(lang);
    } else if (args[i] === '--json') json = true;
    else if (args[i] === '--summary') summary = true;
    else if (args[i] === '--help' || args[i] === '-h') help = true;
    else throw new Error(`unknown argument: ${args[i]}`);
  }
  if (json && summary) throw new Error('choose --json or --summary');
  if (help) {
    console.log('Usage: node i18n-drift.mjs [--lang tr ...] [--json | --summary]\nRead-only, offline. Drift exits 0; invalid arguments or unreadable inputs exit 1.');
    return;
  }
  const selected = [...new Set(langs.length ? langs : discoverLangs())];
  if (!selected.length) throw new Error('no language directories found in modes/');
  const results = selected.map(lang => checkLang(lang));
  console.log(json ? JSON.stringify(toJSON(results), null, 2) : formatReport(results, { summary }));
}

if (isMainModule(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`i18n-drift: ${error.message}`); process.exitCode = 1; }
}
