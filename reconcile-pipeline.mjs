#!/usr/bin/env node
/**
 * reconcile-pipeline.mjs — Sync pipeline.md "Pendientes" with batch-state.tsv
 *
 * THE PROBLEM
 * batch-runner.sh records every evaluated offer in batch/batch-state.tsv, but
 * it never writes back to data/pipeline.md. Offers processed via batch mode
 * therefore stay in the "Pendientes" section forever — the next scan and the
 * next `/career-ops pipeline` run both re-surface them, and they get evaluated
 * again (duplicate reports, duplicate tracker rows).
 *
 * WHAT THIS DOES
 * For each `completed` / `skipped` entry in batch-state.tsv whose URL is still
 * sitting in pipeline.md "Pendientes", move that line to "Procesadas" with its
 * report link, score and PDF flag.
 *
 * Idempotent: an entry already moved (no longer in Pendientes) is a no-op, and
 * an entry already present in Procesadas is dropped from Pendientes without a
 * second copy. Safe to run after every batch.
 *
 * Run: node reconcile-pipeline.mjs [--dry-run] [--state <path>] [--pipeline <path>]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, realpathSync, statSync } from 'fs';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { normalizeReportLink } from './tracker-links.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log('Usage: node reconcile-pipeline.mjs [--dry-run] [--state <path>] [--pipeline <path>]');
  console.log('  Moves batch-processed offers out of pipeline.md "Pendientes" into "Procesadas".');
  process.exit(0);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

// Constrain user-supplied --state/--pipeline paths to the repository tree, so a
// crafted path cannot read from or overwrite files outside the project.
// Symlinks are resolved first (realpathSync) so an in-repo symlink cannot
// smuggle the real target outside the tree past a purely lexical check.
function resolveInsideRepo(inputPath, fallbackPath, flag) {
  const abs = resolve(inputPath || fallbackPath);
  let repoReal, targetReal;
  try {
    repoReal = realpathSync(CAREER_OPS);
    // The target may not exist yet (e.g. a fresh --pipeline path); fall back to
    // its parent directory so the symlink-resolved boundary check still applies.
    targetReal = existsSync(abs) ? realpathSync(abs) : realpathSync(dirname(abs));
  } catch {
    console.error(`Invalid ${flag}: cannot resolve path (${abs})`);
    process.exit(1);
  }
  const rel = relative(repoReal, targetReal);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    console.error(`Invalid ${flag}: path must stay inside the repository (${abs})`);
    process.exit(1);
  }
  // Reject a directory target early — otherwise readFileSync/copyFileSync would
  // throw an unhandled EISDIR later instead of failing with a clear message.
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    console.error(`Invalid ${flag}: expected a file, not a directory (${abs})`);
    process.exit(1);
  }
  return abs;
}

const defaultPipeline = existsSync(join(CAREER_OPS, 'data/pipeline.md'))
  ? join(CAREER_OPS, 'data/pipeline.md')
  : join(CAREER_OPS, 'pipeline.md');
const PIPELINE_FILE = resolveInsideRepo(argValue('--pipeline'), defaultPipeline, '--pipeline');
const STATE_FILE = resolveInsideRepo(argValue('--state'), join(CAREER_OPS, 'batch/batch-state.tsv'), '--state');
const REPORTS_DIR = join(CAREER_OPS, 'reports');

// ---- guards ----
if (!existsSync(STATE_FILE)) {
  console.log('No batch-state.tsv found — nothing to reconcile.');
  process.exit(0);
}
if (!existsSync(PIPELINE_FILE)) {
  console.log('No pipeline.md found — nothing to reconcile.');
  process.exit(0);
}

// ---- parse batch-state.tsv ----
// columns: id  url  status  started_at  completed_at  report_num  score  error  retries
const DONE = new Map(); // url -> { reportNum, score }
for (const line of readFileSync(STATE_FILE, 'utf-8').split(/\r?\n/)) {
  if (!line.trim() || line.startsWith('id\t')) continue;
  const c = line.split('\t');
  if (c.length < 7) continue;
  const [, url, status, , , reportNum, score] = c;
  // "completed" and "skipped" (below --min-score) both produced a report.
  if (status !== 'completed' && status !== 'skipped') continue;
  if (!url || !url.trim()) continue;
  DONE.set(url.trim(), { reportNum: (reportNum || '').trim(), score: (score || '').trim() });
}

if (DONE.size === 0) {
  console.log('No completed batch entries in batch-state.tsv — nothing to reconcile.');
  process.exit(0);
}

// ---- report lookup ----
let reportFiles = [];
try { reportFiles = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md')); } catch { /* no reports dir */ }

function findReportFile(reportNum) {
  if (!reportNum || reportNum === '-') return null;
  const n = parseInt(reportNum, 10);
  if (Number.isNaN(n)) return null;
  return reportFiles.find(f => {
    const m = f.match(/^(\d+)-/);
    return m && parseInt(m[1], 10) === n;
  }) || null;
}

function readReportField(reportFile, field) {
  if (!reportFile) return null;
  try {
    const txt = readFileSync(join(REPORTS_DIR, reportFile), 'utf-8');
    const m = txt.match(new RegExp(`^\\*\\*${field}:\\*\\*\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  } catch { return null; }
}

// State score is authoritative when numeric; otherwise fall back to the report.
function resolveScore(stateScore, reportFile) {
  if (/^\d+(?:\.\d+)?$/.test(stateScore)) return `${stateScore}/5`;
  const rep = readReportField(reportFile, 'Score');
  if (rep) {
    const num = rep.match(/(\d+(?:\.\d+)?)/);
    if (num) return `${num[1]}/5`;
    if (/n\/?a/i.test(rep)) return 'N/A';
  }
  return 'N/A';
}

function resolvePdf(reportFile) {
  const rep = readReportField(reportFile, 'PDF');
  if (!rep) return '❌';
  return /not generated/i.test(rep) ? '❌' : '✅';
}

// ---- parse pipeline.md ----
const lines = readFileSync(PIPELINE_FILE, 'utf-8').split(/\r?\n/);

const PENDING_RE = /^##\s+(Pendientes|Pending)\s*$/i;
const PROCESSED_RE = /^##\s+(Procesadas|Processed)\s*$/i;
const SECTION_RE = /^##\s+/;
const PENDING_ITEM_RE = /^- \[ \]\s+/;

function lineUrl(body) {
  // "{url} | company | role"  ->  "{url}"
  const i = body.indexOf(' |');
  return (i >= 0 ? body.slice(0, i) : body).trim();
}

let pendStart = -1, procStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (pendStart < 0 && PENDING_RE.test(lines[i])) pendStart = i;
  else if (procStart < 0 && PROCESSED_RE.test(lines[i])) procStart = i;
}

if (pendStart < 0) {
  console.log('No "Pendientes" section in pipeline.md — nothing to reconcile.');
  process.exit(0);
}

function sectionEnd(start) {
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i])) return i;
  }
  return lines.length;
}
const pendEnd = sectionEnd(pendStart);
const procEnd = procStart >= 0 ? sectionEnd(procStart) : -1;

// URLs already in Procesadas — guards against a double copy on re-runs.
const procUrls = new Set();
if (procStart >= 0) {
  for (let i = procStart + 1; i < procEnd; i++) {
    const m = lines[i].match(/^- \[x\]\s+(.+)$/i);
    if (!m) continue;
    // "[num](path) | url | company | role | score | PDF x" — url is field 2
    const parts = m[1].split('|').map(s => s.trim());
    if (parts[1]) procUrls.add(parts[1]);
  }
}

// ---- walk Pendientes, decide keep vs. move ----
const removeIdx = new Set();
const movedProcLines = [];
const moved = [];
const skippedNoReport = [];

for (let i = pendStart + 1; i < pendEnd; i++) {
  if (!PENDING_ITEM_RE.test(lines[i])) continue; // blank lines, "- [!]" errors → keep
  const body = lines[i].replace(PENDING_ITEM_RE, '');
  const url = lineUrl(body);
  const done = DONE.get(url);
  if (!done) continue; // not processed → keep in Pendientes

  if (procUrls.has(url)) {
    // Already recorded in Procesadas — just drop the stale Pendientes copy.
    removeIdx.add(i);
    moved.push({ url, role: '(already in Procesadas)', dup: true });
    continue;
  }

  const reportFile = findReportFile(done.reportNum);
  if (!reportFile) {
    // No report on disk — leave it in Pendientes rather than write a dead link.
    skippedNoReport.push({ url, reportNum: done.reportNum || '?' });
    continue;
  }

  const parts = body.split('|').map(s => s.trim());
  const company = parts[1] || '';
  const role = parts[2] || '';
  const score = resolveScore(done.score, reportFile);
  const pdf = resolvePdf(reportFile);
  const num = parseInt(done.reportNum, 10);

  const reportLink = normalizeReportLink(`[${num}](reports/${reportFile})`, dirname(PIPELINE_FILE), CAREER_OPS);
  movedProcLines.push(`- [x] ${reportLink} | ${url} | ${company} | ${role} | ${score} | PDF ${pdf}`);
  moved.push({ url, company, role, num, score });
  procUrls.add(url);
  removeIdx.add(i);
}

// ---- report & exit early if nothing changed ----
console.log('=== Reconcile pipeline.md ===');
for (const s of skippedNoReport) {
  console.warn(`⚠️  ${s.url} — batch reports report #${s.reportNum} but no reports/${s.reportNum}-*.md found; left in Pendientes.`);
}

if (removeIdx.size === 0) {
  console.log('✅ pipeline.md already in sync — nothing to reconcile.');
  process.exit(0);
}

// ---- rebuild the file ----
const out = [];
let skipBlankAfterProc = false;
for (let i = 0; i < lines.length; i++) {
  if (removeIdx.has(i)) continue;
  if (skipBlankAfterProc) {
    skipBlankAfterProc = false;
    if (lines[i].trim() === '') continue; // drop the original blank after "## Procesadas"
  }
  out.push(lines[i]);
  if (i === procStart && movedProcLines.length > 0) {
    out.push('', ...movedProcLines);
    skipBlankAfterProc = true;
  }
}
// No Procesadas section yet — create one at the end of the file, matching the
// language the pending section header already uses.
if (procStart < 0 && movedProcLines.length > 0) {
  const processedHeader = /Pending/i.test(lines[pendStart]) ? '## Processed' : '## Procesadas';
  if (out.length && out[out.length - 1].trim() !== '') out.push('');
  out.push(processedHeader, '', ...movedProcLines);
}

const newContent = out.join('\n');

const newCount = (() => {
  let n = 0, inPend = false;
  for (const l of out) {
    if (PENDING_RE.test(l)) { inPend = true; continue; }
    if (SECTION_RE.test(l)) { inPend = false; continue; }
    if (inPend && PENDING_ITEM_RE.test(l)) n++;
  }
  return n;
})();

const realMoves = moved.filter(m => !m.dup);
console.log(`🔄 ${realMoves.length} processed entr${realMoves.length === 1 ? 'y' : 'ies'} moved Pendientes → Procesadas:`);
for (const m of realMoves) console.log(`   + #${m.num} ${m.company} — ${m.role} (${m.score})`);
const dups = moved.filter(m => m.dup);
if (dups.length) console.log(`🧹 ${dups.length} stale Pendientes entr${dups.length === 1 ? 'y' : 'ies'} dropped (already in Procesadas).`);
console.log(`📋 Pendientes now: ${newCount} entr${newCount === 1 ? 'y' : 'ies'}`);

if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
  process.exit(0);
}

copyFileSync(PIPELINE_FILE, `${PIPELINE_FILE}.pre-reconcile.bak`);
writeFileSync(PIPELINE_FILE, newContent);
console.log(`✅ pipeline.md updated (backup: ${PIPELINE_FILE}.pre-reconcile.bak)`);
