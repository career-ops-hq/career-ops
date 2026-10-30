#!/usr/bin/env node

/**
 * generate-latex.mjs — Validate and compile a generated .tex CV file to PDF
 *
 * Usage:
 *   node generate-latex.mjs <input.tex> [output.pdf]
 *   node generate-latex.mjs <input.tex> [output.pdf] --compile-only
 *
 * Default: validates career-ops template structure (from templates/cv-template.tex).
 * --compile-only: skip template validation; compile any user-owned .tex (latex-tex mode).
 * --source <path>: an extra fact-gate source, repeatable (latex-tex passes the user's own .tex).
 * --skip-fact-check: compile without the fact gate.
 *
 * Both modes run the CV fact gate (verify-cv-facts.mjs) on the .tex before
 * compiling, when the data root has a cv.md to check against — the same
 * condition generate-pdf.mjs uses. A blocked document is not compiled.
 *
 * Requires: a repo-local tectonic (`node install-latex-engine.mjs`, see
 * install-latex-engine.mjs), or tectonic / pdflatex on PATH.
 */

import { readFile, writeFile, stat, copyFile, rm } from 'fs/promises';
import { resolve, basename, dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

const INSTALL_HINT = 'node install-latex-engine.mjs';

const MIN_SECTIONS = 4;

const REQUIRED_COMMANDS = [
  '\\\\resumeSubheading',
  '\\\\resumeItem',
  '\\\\resumeProjectHeading',
];

// Proper Unicode script test (not a hand-picked codepoint range) so
// supplementary-plane ideographs (CJK Unified Ideographs Extension B and
// later, e.g. U+20000+) are covered, not just the BMP. Needs the `u` flag --
// without it, \p{Script=...} throws, and a bare codepoint-range class only
// ever sees UTF-16 surrogate halves for anything above U+FFFF, never the
// real character.
const CJK_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

// xeCJK (Latin-doc CJK) or ctex (Chinese-doc-class CJK) means the .tex
// already loads a CJK-capable font setup (see templates/cv-template.cjk.tex).
// Matches xeCJK/ctex anywhere in a \usepackage package list (not just as the
// sole argument, e.g. `\usepackage{fontspec,xeCJK}`), and ctex's own document
// classes (`\documentclass{ctexart}` and friends), which auto-configure
// xeCJK/LuaTeX-ja/CJK depending on engine without a separate \usepackage.
const CJK_PACKAGE_RE = /\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:xeCJK|ctex)\b[^}]*\}|\\documentclass(?:\[[^\]]*\])?\{ctex(?:art|rep|book)?\}/;

/**
 * Where install-latex-engine.mjs puts tectonic: next to the scripts.
 * @param {string} [root]
 * @param {string} [platform]
 * @returns {string}
 */
export function localTectonicPath(root = ROOT, platform = process.platform) {
  return join(root, platform === 'win32' ? 'tectonic.exe' : 'tectonic');
}

// The binary resolveLatexEngine() last succeeded with, so the compile runs the
// executable it probed (the repo-local path, not whatever is on PATH).
let resolvedEngineBin = null;

/**
 * Resolve the LaTeX engine, preferring tectonic (XeTeX backend, supports CJK
 * via fontspec/xeCJK) over pdflatex (no CJK support). A repo-local tectonic
 * from install-latex-engine.mjs is tried before PATH.
 * @returns {string|null}
 */
export function resolveLatexEngine() {
  const local = localTectonicPath();
  const candidates = [
    ...(existsSync(local) ? [{ name: 'tectonic', bin: local }] : []),
    { name: 'tectonic', bin: 'tectonic' },
    { name: 'pdflatex', bin: 'pdflatex' },
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate.bin, ['--version'], { stdio: 'pipe' });
      resolvedEngineBin = candidate.bin;
      return candidate.name;
    } catch { /* not found */ }
  }
  resolvedEngineBin = null;
  return null;
}

/**
 * @param {string} content
 * @param {boolean} compileOnly
 * @param {string|null} [engine] - resolved LaTeX engine ('tectonic'/'pdflatex'/null); affects CJK handling
 * @returns {{ issues: string[], counts: object }}
 */
export function validateLatexContent(content, compileOnly, engine = null) {
  const issues = [];
  let resumeItemCount = 0;
  let subheadingCount = 0;
  let projectHeadingCount = 0;

  if (!content.includes('\\begin{document}')) {
    issues.push('Missing \\begin{document}');
  }
  if (!content.includes('\\end{document}')) {
    issues.push('Missing \\end{document}');
  }

  if (compileOnly) {
    return {
      issues,
      counts: { resumeItems: 0, subheadings: 0, projectHeadings: 0 },
    };
  }

  const sectionCount = (content.match(/\\section\{/g) || []).length;
  if (sectionCount < MIN_SECTIONS) {
    issues.push(`Expected at least ${MIN_SECTIONS} \\section{} blocks (Education, Work Experience, Projects, Skills — or localized equivalents), found ${sectionCount}`);
  }

  if (CJK_RE.test(content)) {
    const hasCjkPackage = CJK_PACKAGE_RE.test(content);
    if (engine === 'tectonic' && hasCjkPackage) {
      // tectonic's backend is XeTeX, so fontspec/xeCJK (loaded by
      // templates/cv-template.cjk.tex) can render CJK glyphs — no issue.
    } else if (engine === 'tectonic') {
      issues.push('CJK characters detected but no CJK package (xeCJK/ctex) is loaded. Generate from the CJK-aware template instead: `node build-cv-latex.mjs <input.json> <output.tex> --template=cjk` (templates/cv-template.cjk.tex), or use `pdf` mode (HTML to PDF, which renders CJK) for these CVs.');
    } else {
      issues.push(`CJK characters detected. This CJK-aware LaTeX path needs a XeTeX-based engine (fontspec/xeCJK) — pdfLaTeX cannot compile it. Install tectonic (\`${INSTALL_HINT}\`, one-time download) and regenerate from the CJK-aware template (\`--template=cjk\`), or use \`pdf\` mode (HTML to PDF, which renders CJK) for these CVs.`);
    }
  }

  for (const cmd of REQUIRED_COMMANDS) {
    if (!new RegExp(cmd).test(content)) {
      issues.push(`Missing command: ${cmd}`);
    }
  }

  const unresolvedMatch = content.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolvedMatch) {
    issues.push(`Unresolved placeholders: ${[...new Set(unresolvedMatch)].join(', ')}`);
  }

  const lines = content.split('\n');
  for (const line of lines) {
    if (/\\resumeItem\{/.test(line)) resumeItemCount++;
    if (/\\resumeSubheading(?!Continue)/.test(line)) subheadingCount++;
    if (/\\resumeProjectHeading/.test(line)) projectHeadingCount++;
  }

  if (!content.includes('\\pdfgentounicode=1')) {
    issues.push('Missing \\pdfgentounicode=1 (ATS compatibility)');
  }

  return {
    issues,
    counts: {
      resumeItems: resumeItemCount,
      subheadings: subheadingCount,
      projectHeadings: projectHeadingCount,
    },
  };
}

/**
 * @param {string} absPath
 * @param {string} content
 * @param {string|null} outputPath
 * @param {boolean} compileOnly
 * @returns {Promise<object>}
 */
export async function compileLatexFile(absPath, content, outputPath, compileOnly) {
  const engine = resolveLatexEngine();
  const { issues, counts } = validateLatexContent(content, compileOnly, engine);
  const fileInfo = await stat(absPath);
  const sizeKB = (fileInfo.size / 1024).toFixed(1);

  const report = {
    file: basename(absPath),
    path: absPath,
    sizeKB: parseFloat(sizeKB),
    counts,
    issues,
    valid: issues.length === 0,
    compileOnly,
  };

  if (issues.length > 0) {
    return report;
  }

  const texDir = dirname(absPath);
  const texBase = basename(absPath, '.tex');
  const defaultPdf = join(texDir, `${texBase}.pdf`);
  const targetPdf = outputPath ? resolve(outputPath) : defaultPdf;

  const targetDir = dirname(targetPdf);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  if (!engine) {
    report.compiled = false;
    report.compileError = `No LaTeX engine found. Run \`${INSTALL_HINT}\` (downloads tectonic once, ~10-22 MB) or install tectonic/pdflatex yourself.`;
    report.installHint = INSTALL_HINT;
    return report;
  }

  report.engine = engine;

  let compilePath = absPath;
  if (engine === 'tectonic') {
    const patched = content
      .replace(/\\pdfgentounicode\s*=\s*\d+[^\n]*\n?/g, '')
      .replace(/\\input\{glyphtounicode\}[^\n]*\n?/g, '');
    compilePath = join(texDir, `${texBase}._tectonic.tex`);
    await writeFile(compilePath, patched, 'utf-8');
  }

  try {
    if (engine === 'tectonic') {
      execFileSync(resolvedEngineBin || 'tectonic', ['--outdir', texDir, compilePath], {
        cwd: texDir,
        stdio: 'pipe',
        timeout: 120_000,
      });
    } else {
      const pdflatexArgs = [
        '-no-shell-escape',
        '-interaction=nonstopmode',
        '-halt-on-error',
        `-output-directory=${texDir}`,
        absPath,
      ];
      execFileSync('pdflatex', pdflatexArgs, { cwd: texDir, stdio: 'pipe', timeout: 120_000 });
      execFileSync('pdflatex', pdflatexArgs, { cwd: texDir, stdio: 'pipe', timeout: 120_000 });
    }

    report.compiled = true;
  } catch (err) {
    const logPath = join(texDir, `${texBase}.log`);
    let latexError = err.message;
    try {
      const log = await readFile(logPath, 'utf-8');
      const errorLines = log.split('\n').filter(l => l.startsWith('!'));
      if (errorLines.length > 0) {
        latexError = errorLines.join('\n');
      }
    } catch { /* no log */ }

    report.compiled = false;
    report.compileError = latexError;
  }

  if (report.compiled) {
    const compileBase = basename(compilePath, '.tex');
    const compiledPdf = join(texDir, `${compileBase}.pdf`);

    try {
      await copyFile(compiledPdf, targetPdf);
      if (resolve(compiledPdf) !== resolve(targetPdf)) {
        await rm(compiledPdf).catch(() => {});
      }

      const pdfStat = await stat(targetPdf);
      report.pdf = {
        path: targetPdf,
        sizeKB: parseFloat((pdfStat.size / 1024).toFixed(1)),
      };
    } catch (err) {
      report.postCompileError = `Failed to finalize PDF: ${err.message}`;
    }

    const auxExts = ['.aux', '.log', '.out', '.fls', '.fdb_latexmk', '.synctex.gz'];
    for (const ext of auxExts) {
      await rm(join(texDir, `${compileBase}${ext}`)).catch(() => {});
    }
    if (engine === 'tectonic') {
      await rm(compilePath).catch(() => {});
    }
  }

  return report;
}

/**
 * Run the CV fact gate on a .tex document before it is compiled (#5348).
 *
 * The latex and latex-tex modes hand the user a CV as sendable as the one
 * pdf mode renders, and until this ran here neither path checked it at all:
 * generate-pdf.mjs gates in code, this compiler did not. Same condition as
 * generate-pdf: no cv.md in the data root means there is nothing to check
 * against, so the gate is skipped rather than failing every claim.
 *
 * @param {string} content - the .tex source
 * @param {{root?: string, extraSources?: string[], label?: string}} [options]
 *   extraSources: further evidence files, such as the user's own source .tex in
 *   latex-tex mode, which is user-authored and may hold facts cv.md lacks.
 * @returns {Promise<{verdict: 'pass'|'warn'|'block'|'skipped', reason?: string, result?: object}>}
 */
export async function runLatexFactGate(content, { root = getCareerOpsRoot(), extraSources = [], label } = {}) {
  const cvPath = join(root, 'cv.md');
  if (!existsSync(cvPath)) return { verdict: 'skipped', reason: `no cv.md in ${root}` };
  // Imported lazily, as generate-pdf.mjs does: a test that copies this script
  // alone into a temp workspace has no cv.md and never reaches the import.
  const { assertFacts } = await import('./verify-cv-facts.mjs');
  // An explicit --source that does not exist is a mistyped path, not an empty
  // source. Read as empty, it would leave the claims it was passed to back
  // unsupported and blame the CV instead of the path.
  const extraPaths = extraSources.map(p => resolve(p));
  const missing = extraPaths.filter(p => !existsSync(p));
  if (missing.length) return { verdict: 'block', reason: `--source file not found: ${missing.join(', ')}` };
  const sourcePaths = [cvPath, join(root, 'article-digest.md'), ...extraPaths];
  try {
    const result = assertFacts(content, { sourcePaths, configPath: join(root, 'config', 'cv-facts.json'), label });
    return { verdict: result.verdict, result };
  } catch (err) {
    return { verdict: 'block', reason: err.message };
  }
}

// ── CLI flags + help ──────────────────────────────────────

const KNOWN_FLAGS = ['--compile-only', '--skip-fact-check', '--source', '--help', '-h'];
const VALUE_FLAGS = ['--source'];

const USAGE = `Usage:
  node generate-latex.mjs <input.tex> [output.pdf]                 # fact-check, validate career-ops template structure, then compile
  node generate-latex.mjs <input.tex> [output.pdf] --compile-only  # skip template validation; compile any user-owned .tex (latex-tex mode)
  node generate-latex.mjs <input.tex> [output.pdf] --source <path> # add a fact-gate source (repeatable), e.g. the user's own .tex
  node generate-latex.mjs <input.tex> [output.pdf] --skip-fact-check
  node generate-latex.mjs --help|-h                                # print this usage block and exit

The fact gate runs when the data root has a cv.md; a blocked document is not compiled.
Requires a repo-local tectonic (${INSTALL_HINT}) or tectonic/pdflatex on PATH.`;

/**
 * Split argv into positionals, --source values and boolean flags.
 *
 * @param {string[]} rawArgs
 * @returns {{positionals: string[], sources: string[], compileOnly: boolean, skipFactCheck: boolean}}
 */
export function parseLatexArgs(rawArgs) {
  const positionals = [];
  const sources = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--source') {
      if (rawArgs[i + 1] !== undefined) sources.push(rawArgs[++i]);
    } else if (arg.startsWith('--source=')) {
      sources.push(arg.slice('--source='.length));
    } else if (arg !== '--compile-only' && arg !== '--skip-fact-check') {
      positionals.push(arg);
    }
  }
  return {
    positionals,
    sources,
    compileOnly: rawArgs.includes('--compile-only'),
    skipFactCheck: rawArgs.includes('--skip-fact-check'),
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);

  // Before the positional reads below: every argv token that is not
  // --compile-only is consumed as a PATH, so an unrecognized flag does not
  // fall through to a default, it silently becomes a filename. `--help`
  // landed in args[0] and was resolved as the input .tex ("Error reading
  // /…/--help: ENOENT"), and a mistyped `--compileonly` landed in args[1]
  // as the OUTPUT path while template validation it meant to skip ran anyway.
  // This is the defect lib/cli-flags.mjs was written for; see its header.
  validateFlags(rawArgs, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  const { positionals, sources, compileOnly, skipFactCheck } = parseLatexArgs(rawArgs);
  const inputPath = positionals[0];
  const outputPath = positionals[1];

  if (!inputPath) {
    console.error(USAGE);
    process.exit(1);
  }

  const absPath = resolve(inputPath);
  let content;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch (err) {
    console.error(`Error reading ${absPath}: ${err.message}`);
    process.exit(1);
  }

  const factCheck = skipFactCheck
    ? { verdict: 'skipped', reason: '--skip-fact-check' }
    : await runLatexFactGate(content, { extraSources: sources, label: basename(absPath) });
  if (factCheck.verdict === 'block') {
    // Nothing is compiled. A fact gate that let the PDF through and reported
    // afterwards would leave the sendable artifact on disk.
    console.error(factCheck.reason);
    console.log(JSON.stringify({
      file: basename(absPath),
      path: absPath,
      issues: [factCheck.reason],
      valid: false,
      compileOnly,
      compiled: false,
      factCheck: { verdict: 'block', reason: factCheck.reason },
    }, null, 2));
    process.exit(1);
  }
  if (factCheck.result?.configMissing) {
    console.error('⚠️  No config/cv-facts.json — forbidden/advisory phrase checks did not run.');
  }
  if (factCheck.verdict === 'warn') {
    const { printFactWarnings } = await import('./verify-cv-facts.mjs');
    console.error(`⚠️  CV fact check warning: ${basename(absPath)}`);
    printFactWarnings(factCheck.result, console.error);
  }

  const report = await compileLatexFile(absPath, content, outputPath || null, compileOnly);
  report.factCheck = factCheck.result
    ? { verdict: factCheck.verdict, configMissing: factCheck.result.configMissing }
    : { verdict: factCheck.verdict, reason: factCheck.reason };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.compiled ? 0 : (report.valid ? 1 : 1));
}

if (isMainModule(import.meta.url)) {
  main();
}
