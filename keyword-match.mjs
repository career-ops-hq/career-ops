#!/usr/bin/env node
/**
 * keyword-match.mjs — ATS keyword coverage check for career-ops
 *
 * Closes the evaluation loop: given a report's `## Keywords extracted` block and
 * a CV, reports which JD keywords the CV actually covers — the way an ATS parser
 * would — so gaps can be closed before applying.
 *
 * DIAGNOSTIC ONLY. Never edits the CV or injects keywords. Upholds the project
 * rule: "Keywords get reformulated, never fabricated" (modes/_shared.md).
 *
 * Run: node keyword-match.mjs <report-file>             (markdown block to stdout)
 *      node keyword-match.mjs <report-file> --cv <path>  (override CV; .html is
 *                                                         text-extracted first —
 *                                                         use the tailored CV to
 *                                                         verify the sent document)
 *      node keyword-match.mjs <report-file> --json        (structured JSON)
 *      node keyword-match.mjs --self-test                 (built-in assertions)
 */

import { readFileSync, existsSync, statSync  } from 'fs';
import { join, isAbsolute, basename } from 'path';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

/**
 * Small, deliberately conservative map of interchangeable ATS surface forms.
 * Each inner array is one equivalence group; matching is bidirectional.
 */
export const SYNONYMS = [
  ['javascript', 'js'],
  ['typescript', 'ts'],
  ['kubernetes', 'k8s'],
  ['machine learning', 'ml'],
  ['ci/cd', 'cicd'],
  ['infrastructure as code', 'iac'],
  ['natural language processing', 'nlp'],
  ['large language model', 'large language models', 'llm'],
  ['amazon web services', 'aws'],
  ['google cloud platform', 'gcp'],
  ['postgresql', 'postgres'],
];

/**
 * Lowercase and collapse internal runs of whitespace to single spaces.
 *
 * @param {string} s - Raw text.
 * @returns {string} Normalized text.
 */
export function normalizeText(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Count boundary-delimited occurrences of `term` in `text`, case-insensitively.
 * A boundary means the term is not flanked by an alphanumeric character, so
 * "java" does not match inside "javascript" yet "c++", "ci/cd" and "node.js"
 * still match around their symbols.
 *
 * @param {string} term - Surface form to find.
 * @param {string} text - Haystack.
 * @returns {number} Occurrence count.
 */
export function countOccurrences(term, text) {
  const t = normalizeText(term);
  if (!t) return 0;
  const hay = normalizeText(text);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g');
  const matches = hay.match(re);
  return matches ? matches.length : 0;
}

/**
 * Conservative singular/plural variants of a term. Skips short tokens and
 * acronyms (length <= 3) because stripping or appending an "s" there yields
 * noisy, meaningless search tokens (aws -> aw, k8s -> k8, js -> j). For longer
 * terms it only ever ADDS a candidate form; boundary-aware counting keeps these
 * from creating false positives (the "kubernete" form never hits "kubernetes").
 *
 * @param {string} term - Keyword or synonym.
 * @returns {string[]} Distinct candidate forms.
 */
export function variantForms(term) {
  const t = normalizeText(term);
  const forms = new Set([t]);
  if (t.length <= 3) return [...forms];
  if (t.endsWith('s')) forms.add(t.slice(0, -1));
  else forms.add(t + 's');
  return [...forms];
}

/**
 * All surface forms to search for a keyword: its own plural variants plus the
 * variants of every member of any synonym group it belongs to.
 *
 * @param {string} keyword - JD keyword.
 * @returns {string[]} Distinct surface forms.
 */
export function expandTerms(keyword) {
  const k = normalizeText(keyword);
  const terms = new Set(variantForms(k));
  for (const group of SYNONYMS) {
    if (!group.includes(k)) continue;
    for (const member of group) {
      if (member === k) continue;
      for (const v of variantForms(member)) terms.add(v);
    }
  }
  return [...terms];
}

/**
 * Total boundary-aware occurrences of a keyword across all its surface forms.
 *
 * @param {string} keyword - JD keyword.
 * @param {string} text - CV text.
 * @returns {number} Occurrence count.
 */
export function keywordCount(keyword, text) {
  let total = 0;
  for (const term of expandTerms(keyword)) total += countOccurrences(term, text);
  return total;
}

/**
 * Core coverage analysis. Pure: no I/O. `thin` is a SUBSET of `present`
 * (keywords mentioned exactly once); coverage counts thin keywords as present.
 *
 * @param {string[]} keywords - JD keywords (order preserved, case-insensitively de-duped).
 * @param {string} cvText - Raw CV text to scan.
 * @returns {{total:number, presentCount:number, coveragePct:number,
 *            present:string[], thin:string[], missing:string[]}}
 */
export function analyzeCoverage(keywords, cvText) {
  const seen = new Set();
  const cleaned = [];
  for (const raw of keywords || []) {
    const k = String(raw).trim();
    if (!k) continue;
    const key = normalizeText(k);
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(k);
  }

  const present = [];
  const thin = [];
  const missing = [];
  for (const k of cleaned) {
    const count = keywordCount(k, cvText || '');
    if (count === 0) {
      missing.push(k);
    } else {
      present.push(k);
      if (count === 1) thin.push(k);
    }
  }

  const total = cleaned.length;
  const presentCount = present.length;
  const coveragePct = total === 0 ? 0 : Math.round((presentCount / total) * 100);
  return { total, presentCount, coveragePct, present, thin, missing };
}

/**
 * Pull keywords out of a report's `## Keywords extracted` block. Liberal:
 * accepts bulleted, comma-separated, or one-per-line entries; stops at the next
 * level-2 heading; skips an empty/placeholder parenthetical line. Returns [] if
 * the block is absent.
 *
 * @param {string} reportText - Full report markdown.
 * @returns {string[]} Extracted keywords in order.
 */
export function extractKeywords(reportText) {
  const lines = String(reportText || '').split(/\r?\n/);
  const out = [];
  let inBlock = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^##\s+keywords\s+extracted\b/i.test(line)) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (/^##\s+/.test(line)) break;
    if (!line) continue;
    if (/^\(.*\)$/.test(line)) continue;
    const body = line.replace(/^[-*]\s+/, '');
    for (const part of body.split(',')) {
      const kw = part.trim().replace(/\.+$/, '').trim();
      if (kw) out.push(kw);
    }
  }
  return out;
}

/**
 * Strip HTML to plain text (zero-dependency) so a tailored CV emitted as HTML
 * (e.g. /tmp/cv-{candidate}-{company}.html from pdf mode) can be scanned as the
 * final, sent document. Removes script/style blocks, drops tags, and decodes
 * the handful of entities that appear in CV templates.
 *
 * @param {string} html - HTML source.
 * @returns {string} Visible text.
 */
export function htmlToText(html) {
  return String(html || '')
    // Strip comments first so a comment can't shelter a tag from the strips below.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Match the full opening tag (incl. attributes) before the lazy body, and
    // tolerate whitespace in the closing tag — a stricter filter CodeQL accepts.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    // Decode &amp; LAST so a nested entity like &amp;lt; resolves to the literal
    // "&lt;" rather than being re-decoded into a "<" tag character.
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render an analyzeCoverage() result as a ready-to-paste report section.
 *
 * @param {ReturnType<typeof analyzeCoverage>} result - Coverage result.
 * @param {string} [sourceLabel] - Human label for the scanned document.
 * @returns {string} Markdown block.
 */
export function formatCoverageMarkdown(result, sourceLabel) {
  const { coveragePct, presentCount, total, present, thin, missing } = result;
  const out = [
    '## Keyword Coverage',
    '',
    `**ATS coverage: ${coveragePct}%** (${presentCount}/${total} keywords present)`,
    '',
  ];
  if (sourceLabel) out.push(`_Scanned: ${sourceLabel}._`, '');
  out.push(`**Present (${present.length}):** ${present.join(', ') || '—'}`, '');
  if (thin.length) {
    out.push(`**Thin — mentioned once, consider reinforcing (${thin.length}):** ${thin.join(', ')}`, '');
  }
  out.push(
    `**Missing (${missing.length}):** ${missing.join(', ') || '—'}`,
    '',
    '> Diagnostic only. Add a missing keyword **only** if it reflects real ' +
      'experience — reformulated from your background, never fabricated.',
    '',
  );
  return out.join('\n');
}

/**
 * Built-in deterministic assertions (no I/O, no network). Exits 0 on success,
 * 1 on failure. Used by CI via `node keyword-match.mjs --self-test`.
 */
function runSelfTest() {
  const cv = [
    'Senior engineer. Built Python services with FastAPI. Python remains my primary language.',
    'Deployed on k8s. Owned CI/CD pipelines. Wrote C++ modules and some JavaScript.',
    'Strong in machine  learning and PostgreSQL. Set up observability once.',
  ].join('\n');
  const keywords = ['Python', 'FastAPI', 'Kubernetes', 'CI/CD', 'C++',
    'Machine Learning', 'Postgres', 'observability', 'Java', 'gRPC'];
  const r = analyzeCoverage(keywords, cv);

  const failures = [];
  if (!r.present.includes('Python')) failures.push('exact hit (Python)');
  if (r.thin.includes('Python')) failures.push('Python (count 2) must not be thin');
  if (!r.present.includes('Kubernetes')) failures.push('synonym k8s->Kubernetes');
  if (!r.present.includes('Machine Learning')) failures.push('case/space variant');
  if (!r.present.includes('C++')) failures.push('symbol keyword C++');
  if (!r.present.includes('CI/CD')) failures.push('symbol keyword CI/CD');
  if (!r.present.includes('Postgres')) failures.push('synonym postgresql->Postgres');
  if (r.present.includes('Java')) failures.push('word boundary (Java matched JavaScript)');
  if (!r.missing.includes('Java')) failures.push('Java should be missing');
  if (!r.missing.includes('gRPC')) failures.push('gRPC should be missing');
  if (!r.thin.includes('observability')) failures.push('observability should be thin');
  if (r.coveragePct !== 80) failures.push(`coverage % = ${r.coveragePct} (expected 80)`);
  if (variantForms('aws').includes('aw')) failures.push('variantForms truncated acronym aws->aw');
  if (htmlToText('<style>.x{}</style><p>Python &amp; <b>gRPC</b></p>') !== 'Python & gRPC') {
    failures.push('htmlToText strip/decode');
  }

  if (failures.length) {
    console.error(`keyword-match self-test FAILED: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('keyword-match self-test OK');
  process.exit(0);
}

// --- CLI (guarded so importing this module never runs it) ---
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes('--self-test')) {
    runSelfTest();
  } else {
    let jsonMode = false;
    let cvArg = null;
    let reportArg = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];

      if (a === '--json') {
        jsonMode = true;
      } 
      else if (a === '--cv') {
        const next = args[i + 1];

        if (!next || next.startsWith('--')) {
          console.error('Missing value for --cv');
          process.exit(1);
        }

        cvArg = next;
        i++;
      } 
      else if (a.startsWith('--')) {
        console.error(`Unknown option: ${a}`);
        process.exit(1);
      }
      else if (reportArg === null) {
        reportArg = a;
      }
      else {
        console.error(`Unexpected argument: ${a}`);
        process.exit(1);
      }
    }

    if (!reportArg) {
      console.error('Usage: node keyword-match.mjs <report-file> [--cv <path>] [--json]');
      process.exit(1);
    }

    const reportPath = isAbsolute(reportArg) ? reportArg : join(process.cwd(), reportArg);

    if (!existsSync(reportPath) || !statSync(reportPath).isFile()) {
      console.error(`Report not found: ${reportArg}`);
      process.exit(1);
    }

    let reportText;
    try {
      reportText = readFileSync(reportPath, 'utf-8');
    } catch {
      console.error(`Unable to read report: ${reportArg}`);
      process.exit(1);
    }

    const keywords = extractKeywords(reportText);

    if (keywords.length === 0) {
      console.error('No "## Keywords extracted" block found (or it is empty).');
      process.exit(1);
    }

    const cvPath = cvArg
      ? (isAbsolute(cvArg) ? cvArg : join(process.cwd(), cvArg))
      : join(getCareerOpsRoot(), 'cv.md');

    if (!existsSync(cvPath) || !statSync(cvPath).isFile()) {
      console.error(`CV not found: ${cvPath}. Pass --cv <path> to point at your CV.`);
      process.exit(1);
    }

    let rawCv;
    try {
      rawCv = readFileSync(cvPath, 'utf-8');
    } catch {
      console.error(`Unable to read CV: ${cvPath}`);
      process.exit(1);
    }
    const cvText = /\.html?$/i.test(cvPath) ? htmlToText(rawCv) : rawCv;
    const sourceLabel = cvArg ? basename(cvPath) : 'cv.md (base CV, before per-role tailoring)';

    const result = analyzeCoverage(keywords, cvText);
    console.log(jsonMode ? JSON.stringify(result, null, 2) : formatCoverageMarkdown(result, sourceLabel));
  }
}
