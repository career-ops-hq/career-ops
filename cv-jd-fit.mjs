#!/usr/bin/env node
/**
 * cv-jd-fit.mjs — Zero-LLM JD ↔ tailored-CV fit score.
 *
 * Compares a generated CV (JSON payload or PDF text) against a JD using the
 * same skill extraction + classification as jd-skill-gap.mjs.
 *
 * Usage:
 *   node cv-jd-fit.mjs --report 082 --company AlphaSense --json
 *   node cv-jd-fit.mjs --self-test
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { dirname, join, basename, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { extractJdSkills, classifySkillGaps } from './jd-skill-gap.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
function fitIndexPath(root = ROOT) {
  return join(root, 'data', 'cv-fit-index.tsv');
}

function slugifyCompany(company) {
  return String(company ?? '')
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.join('-') ?? '';
}

function normReportNum(s) {
  return String(s ?? '').trim().replace(/^0+(?=\d)/, '');
}

export function cvPayloadToText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const parts = [
    payload.summary,
    ...(payload.competencies || []),
    ...(payload.experience || []).flatMap((j) => [j.role, j.company, ...(j.bullets || [])]),
    ...(payload.projects || []).flatMap((p) => [p.name, p.badge, p.tech, p.description]),
    ...(payload.education || []).flatMap((e) => [e.title, e.org, e.year, e.description]),
    ...(payload.certifications || []).flatMap((c) => [c.title, c.org, c.year]),
    ...(payload.skills || []).flatMap((s) => [s.category, s.items]),
  ];
  return parts.filter(Boolean).join('\n');
}

function reportNumFromFilename(filename) {
  const m = String(filename).match(/^(\d+)-/);
  return m ? parseInt(m[1], 10) : NaN;
}

export function findReportFile(root, report) {
  const target = parseInt(normReportNum(report), 10);
  if (Number.isNaN(target)) return null;
  const dir = join(root, 'reports');
  try {
    const candidates = readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !/-RESERVED\.md$/i.test(f))
      .filter((f) => reportNumFromFilename(f) === target);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.localeCompare(a));
    return join(dir, candidates[0]);
  } catch {
    return null;
  }
}

function resolveJdPath(root, { report, company } = {}) {
  const jdsDir = join(root, 'jds');
  const slug = slugifyCompany(company);
  if (slug) {
    try {
      const hit = readdirSync(jdsDir).find((f) => f.endsWith('.md') && f.toLowerCase().includes(slug));
      if (hit) return join(jdsDir, hit);
    } catch {
      /* ignore */
    }
  }
  const reportPath = report ? findReportFile(root, report) : null;
  if (reportPath) {
    const base = basename(reportPath).replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
    const exact = join(jdsDir, `${base}.md`);
    if (existsSync(exact)) return exact;
    try {
      const hit = readdirSync(jdsDir).find((f) => {
        if (!f.endsWith('.md')) return false;
        const lower = f.toLowerCase();
        const needle = base.toLowerCase();
        return lower.startsWith(needle) || lower.includes(needle);
      });
      if (hit) return join(jdsDir, hit);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function resolveJdText(root = ROOT, opts = {}) {
  if (opts.jdText) return opts.jdText;
  const jdPath = opts.jdPath || resolveJdPath(root, opts);
  if (jdPath && existsSync(jdPath)) return readFileSync(jdPath, 'utf-8');
  const reportPath = opts.report ? findReportFile(root, opts.report) : null;
  if (!reportPath) return '';
  const report = readFileSync(reportPath, 'utf-8');
  const roleBlock = report.match(/## A\)[\s\S]*?(?=\n## |$)/)?.[0] ?? '';
  const matchBlock = report.match(/## B\)[\s\S]*?(?=\n## |$)/)?.[0] ?? '';
  return `${roleBlock}\n\n${matchBlock}`.trim();
}

function resolveTailoredCvJson(root, { company, report } = {}) {
  const slug = slugifyCompany(company);
  const dirs = [join(root, 'tmp'), join(root, 'output')];
  let best = null;
  for (const dir of dirs) {
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json') || !f.startsWith('cv-')) continue;
        const lower = f.toLowerCase();
        if (slug && !lower.includes(slug)) continue;
        const abs = join(dir, f);
        const mtime = statSync(abs).mtimeMs;
        if (!best || mtime > best.mtime) best = { abs, mtime };
      }
    } catch {
      /* ignore */
    }
  }
  if (!best) return null;
  try {
    return JSON.parse(readFileSync(best.abs, 'utf-8'));
  } catch {
    return null;
  }
}

function extractPdfText(pdfPath) {
  const python = existsSync(join(ROOT, '.venv', 'bin', 'python3'))
    ? join(ROOT, '.venv', 'bin', 'python3')
    : 'python3';
  const code = `
from pypdf import PdfReader
import sys
r = PdfReader(sys.argv[1])
print(''.join((p.extract_text() or '') for p in r.pages))
`;
  const result = spawnSync(python, ['-c', code, pdfPath], { encoding: 'utf-8' });
  if (result.status !== 0) return '';
  return (result.stdout || '').trim();
}

function resolveTailoredCvByReport(root, report) {
  const indexPath = join(root, 'data', 'pdf-index.tsv');
  const n = normReportNum(report);
  if (!n || !existsSync(indexPath)) return null;
  for (const line of readFileSync(indexPath, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [reportCol, pdfCol] = line.split('\t');
    if (normReportNum(reportCol) !== n || !pdfCol?.trim()) continue;
    const rel = pdfCol.trim();
    const abs = isAbsolute(rel) ? rel : join(root, rel);
    return existsSync(abs) ? abs : null;
  }
  return null;
}

function resolveTailoredCvPdf(root, { company, report } = {}) {
  if (report) {
    const fromIndex = resolveTailoredCvByReport(root, report);
    if (fromIndex) return fromIndex;
  }
  const slug = slugifyCompany(company);
  const outDir = join(root, 'output');
  try {
    const files = readdirSync(outDir)
      .filter((f) => f.startsWith('cv-') && f.endsWith('.pdf') && !f.endsWith('-cover.pdf'))
      .filter((f) => !slug || f.toLowerCase().includes(slug))
      .map((f) => ({ abs: join(outDir, f), mtime: statSync(join(outDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.abs ?? null;
  } catch {
    return null;
  }
}

const FIT_TERM_STOPWORDS = new Set([
  'years', 'year', 'experience', 'ability', 'proven', 'strong', 'skill', 'skills', 'familiarity',
  'knowledge', 'with', 'from', 'into', 'using', 'meet', 'setting', 'existing', 'preferred',
  'required', 'internal', 'external', 'third', 'party', 'teams', 'team', 'work', 'role',
  'content', 'data', 'product', 'features', 'feature', 'tools', 'process', 'processes',
]);

/** Significant terms from a requirement phrase (for phrase-level CV matching). */
export function significantTerms(phrase) {
  const raw = String(phrase ?? '')
    .toLowerCase()
    .replace(/[‑–—]/g, '-')
    .split(/[^a-z0-9+/]+/)
    .filter((w) => (w.length >= 4 || /\d/.test(w) || w === 'saas') && !FIT_TERM_STOPWORDS.has(w));
  return [...new Set(raw)];
}

/**
 * How well a requirement phrase is reflected in CV text (0, 0.65, or 1).
 * @param {string} requirement
 * @param {string} cvText
 */
export function requirementMatchStrength(requirement, cvText) {
  const terms = significantTerms(requirement);
  if (!terms.length) return 0;
  const cv = String(cvText ?? '').toLowerCase();
  let hits = 0;
  for (const t of terms) {
    if (cv.includes(t)) hits++;
  }
  const ratio = hits / terms.length;
  if (ratio >= 0.42) return 1;
  if (ratio >= 0.22) return 0.65;
  return 0;
}

export function extractBlockBRequirements(reportText) {
  const block = String(reportText ?? '').match(/## B\)[\s\S]*?(?=\n## |$)/i)?.[0] ?? '';
  const rows = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!m) continue;
    const requirement = m[1].trim();
    const evidence = m[2].trim();
    if (/^requirement$/i.test(requirement)) continue;
    if (/^-+$/.test(requirement)) continue;
    rows.push({ requirement, evidence });
  }
  return rows;
}

export function gapsHintPath(root, report) {
  const n = normReportNum(report);
  return join(root, 'tmp', `cv-fit-gaps-${n}.json`);
}

/** Persist gap hints for the next PDF regeneration (read by pdf mode / web worker). */
export function writeCvFitGapsHint(root, report, fit) {
  const n = normReportNum(report);
  if (!n || !fit) return;
  const path = gapsHintPath(root, n);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        report: n,
        fitScore: fit.fitScore,
        coveragePct: fit.coveragePct,
        gaps: (fit.gaps || []).slice(0, 20),
        requirements: (fit.jdSkills || []).slice(0, 20),
        updatedAt: new Date().toISOString(),
        hint:
          'Weave these JD requirement phrases into summary, competencies, and top experience bullets using ONLY cv.md evidence. Never claim Block B rows marked No direct / No such.',
      },
      null,
      2,
    ) + '\n',
  );
}

export function resolveTailoredCvText(root = ROOT, opts = {}) {
  if (opts.cvText) return opts.cvText;
  if (opts.cvPayload) return cvPayloadToText(opts.cvPayload);
  const payload = resolveTailoredCvJson(root, opts);
  if (payload) return cvPayloadToText(payload);
  const pdfPath = opts.cvPdfPath || resolveTailoredCvPdf(root, opts);
  if (pdfPath && existsSync(pdfPath)) return extractPdfText(pdfPath);
  return '';
}

function scoreRequirementRows(requirementRows, cvText) {
  const existing = [];
  const supported = [];
  const gaps = [];
  const jdSkills = [];

  for (const row of requirementRows) {
    const label = typeof row === 'string' ? row : row.requirement;
    if (!label?.trim()) continue;
    jdSkills.push(label);
    const strength = requirementMatchStrength(label, cvText);
    if (strength >= 1) existing.push(label);
    else if (strength >= 0.65) supported.push(label);
    else gaps.push(label);
  }

  const total = jdSkills.length;
  const addressed = existing.length + supported.length;
  const coveragePct = total ? Math.round((addressed / total) * 100) : 0;
  const weighted = existing.length * 1 + supported.length * 0.65;
  const fitScore = total ? Math.min(5, Math.round((weighted / total) * 5 * 10) / 10) : null;
  return { fitScore, coveragePct, total, existing, supported, gaps, jdSkills, source: 'block-b' };
}

/**
 * @param {string} jdText
 * @param {string} cvText
 * @param {{ reportText?: string }} [opts]
 */
export function computeCvJdFit(jdText, cvText, opts = {}) {
  const cv = String(cvText || '').trim();
  const reportRows = opts.reportText ? extractBlockBRequirements(opts.reportText) : [];
  if (reportRows.length && cv) {
    return scoreRequirementRows(reportRows, cv);
  }

  const jdSkills = extractJdSkills(jdText || '');
  if (!jdSkills.length || !cv) {
    return {
      fitScore: null,
      coveragePct: 0,
      total: jdSkills.length,
      existing: [],
      supported: [],
      gaps: jdSkills,
      jdSkills,
      source: 'jd-tokens',
    };
  }
  const { existing, supportedByResume, gap } = classifySkillGaps(jdSkills, cv);
  const total = jdSkills.length;
  const addressed = existing.length + supportedByResume.length;
  const coveragePct = total ? Math.round((addressed / total) * 100) : 0;
  const weighted = existing.length * 1 + supportedByResume.length * 0.65;
  const fitScore = total ? Math.min(5, Math.round((weighted / total) * 5 * 10) / 10) : null;
  return {
    fitScore,
    coveragePct,
    total,
    existing,
    supported: supportedByResume,
    gaps: gap,
    jdSkills,
    source: 'jd-tokens',
  };
}

export function readCvFitIndex(report, root = ROOT) {
  const path = fitIndexPath(root);
  const n = normReportNum(report);
  if (!n || !existsSync(path)) return null;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [reportCol, fitScore, coveragePct, gapCount, gapsJson, date] = line.split('\t');
    if (normReportNum(reportCol) !== n) continue;
    let gaps = [];
    try {
      gaps = gapsJson ? JSON.parse(gapsJson) : [];
    } catch {
      gaps = [];
    }
    return {
      fitScore: fitScore ? parseFloat(fitScore) : null,
      coveragePct: coveragePct ? parseInt(coveragePct, 10) : 0,
      gapCount: gapCount ? parseInt(gapCount, 10) : gaps.length,
      gaps,
      date: date || '',
      cached: true,
    };
  }
  return null;
}

export function writeCvFitIndex(report, fit, root = ROOT) {
  const n = normReportNum(report);
  if (!n || fit?.fitScore == null) return;
  const path = fitIndexPath(root);
  const date = new Date().toISOString().slice(0, 10);
  const gapsJson = JSON.stringify((fit.gaps || []).slice(0, 12));
  const row = [n, fit.fitScore, fit.coveragePct, (fit.gaps || []).length, gapsJson, date].join('\t');

  let lines = [];
  if (existsSync(path)) {
    lines = readFileSync(path, 'utf-8').split('\n').filter((line) => {
      if (!line.trim() || line.startsWith('#')) return false;
      return normReportNum(line.split('\t')[0]) !== n;
    });
  }
  lines.push(row);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    '# report\tfit_score\tcoverage_pct\tgap_count\tgaps_json\tdate — written by generate-pdf.mjs / cv-jd-fit.mjs\n' +
      lines.join('\n') + '\n',
  );
}

export function computeCvJdFitForReport(root = ROOT, opts = {}) {
  const cached = opts.useCache !== false && opts.report ? readCvFitIndex(opts.report, root) : null;
  if (cached && !opts.force) {
    return {
      ...cached,
      hasCv: true,
      hasJd: true,
      total: cached.gapCount + Math.round((cached.coveragePct / 100) * Math.max(cached.gapCount, 1)),
      existing: [],
      supported: [],
      jdSkills: [],
    };
  }

  const reportPath = opts.report ? findReportFile(root, opts.report) : null;
  const reportText = reportPath && existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';
  const jdText = resolveJdText(root, opts);
  const cvText = resolveTailoredCvText(root, opts);
  const pdfPath = opts.cvPdfPath || resolveTailoredCvPdf(root, opts);
  const jdPath = resolveJdPath(root, opts);
  const fit = computeCvJdFit(jdText, cvText, { reportText });
  const result = {
    ...fit,
    hasCv: Boolean(cvText.trim()),
    hasJd: Boolean(jdText.trim() || reportText.includes('## B)')),
    jdPath: jdPath ? jdPath.replace(root + '/', '') : null,
    cvPdfPath: pdfPath ? pdfPath.replace(root + '/', '') : null,
    cached: false,
  };
  if (opts.report && result.fitScore != null && result.hasCv) {
    writeCvFitIndex(opts.report, result, root);
    writeCvFitGapsHint(root, opts.report, result);
  }
  return result;
}

function selfTest() {
  let failed = 0;
  const ok = (label, cond) => {
    if (cond) console.log(`  ✓ ${label}`);
    else { console.error(`  ✗ ${label}`); failed++; }
  };
  const jd = `## Requirements\n- Python, PostgreSQL, Agile\n- Kubernetes experience`;
  const cv = `Professional Summary\nPython and PostgreSQL delivery.\nSkills\nAgile/Scrum delivery\nExperience\nDeployed on Kubernetes clusters.`;
  const fit = computeCvJdFit(jd, cv);
  ok('fit score computed', fit.fitScore != null && fit.fitScore > 3);
  ok('gaps exclude matched skills', !fit.gaps.includes('Python'));
  ok('payload to text', cvPayloadToText({ summary: 'Hello', experience: [{ bullets: ['Did things'] }] }).includes('Did things'));
  process.exit(failed ? 1 : 0);
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
  } else {
    const json = args.includes('--json');
    const force = args.includes('--force');
    const report = args.find((a, i) => args[i - 1] === '--report');
    const company = args.find((a, i) => args[i - 1] === '--company');
    const root = args.find((a, i) => args[i - 1] === '--root') || ROOT;
    const result = computeCvJdFitForReport(root, { report, company, force });
    if (json) console.log(JSON.stringify(result));
    else {
      console.log(`CV-JD fit: ${result.fitScore ?? '—'}/5 (${result.coveragePct}% coverage)`);
      if (result.gaps?.length) console.log(`Gaps: ${result.gaps.slice(0, 8).join(', ')}`);
    }
  }
}
