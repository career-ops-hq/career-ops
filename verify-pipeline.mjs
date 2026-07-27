#!/usr/bin/env node
/**
 * verify-pipeline.mjs — Health check for career-ops pipeline integrity
 *
 * Checks:
 * 1. All statuses are canonical (per states.yml)
 * 2. No duplicate company+role entries
 * 3. All report links point to existing files
 * 4. Scores match format X.XX/5 or N/A or DUP
 * 5. All rows have proper pipe-delimited format
 * 6. No pending TSVs in tracker-additions/ (only in merged/ or archived/)
 * 7. states.yml canonical IDs for cross-system consistency
 * 8. Stale report-number reservation sentinels are garbage-collected
 * 9. No two report files cover the same company+role (warning — see #1425)
 * 10. Every report file has a tracker row referencing it (warning — see #1425)
 * 11. Via channel consistency (see #1596)
 * 12. No # value reused across 2+ tracker rows (error — see #1704)
 *
 * Run: node career-ops/verify-pipeline.mjs
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { looksLikeScoreCell } from './tracker-parse.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
// Support both layouts: data/applications.md (boilerplate) and applications.md (original).
// CAREER_OPS_TRACKER overrides the path (used by tests and non-standard layouts).
const APPS_FILE = process.env.CAREER_OPS_TRACKER
  ? process.env.CAREER_OPS_TRACKER
  : existsSync(join(CAREER_OPS, 'data/applications.md'))
    ? join(CAREER_OPS, 'data/applications.md')
    : join(CAREER_OPS, 'applications.md');
const ADDITIONS_DIR = join(CAREER_OPS, 'batch/tracker-additions');
// CAREER_OPS_REPORTS overrides the reports dir (used by tests, mirrors CAREER_OPS_TRACKER).
const REPORTS_DIR = process.env.CAREER_OPS_REPORTS || join(CAREER_OPS, 'reports');
const STATES_FILE = existsSync(join(CAREER_OPS, 'templates/states.yml'))
  ? join(CAREER_OPS, 'templates/states.yml')
  : join(CAREER_OPS, 'states.yml');

// Ensure required directories exist (fresh setup)
mkdirSync(join(CAREER_OPS, 'data'), { recursive: true });
mkdirSync(REPORTS_DIR, { recursive: true });

const CANONICAL_STATUSES = [
  'evaluated', 'applied', 'responded', 'interview',
  'offer', 'rejected', 'discarded', 'skip', 'hired',
];

const ALIASES = {
  'evaluada': 'evaluated', 'condicional': 'evaluated', 'hold': 'evaluated', 'evaluar': 'evaluated', 'verificar': 'evaluated',
  'aplicado': 'applied', 'enviada': 'applied', 'aplicada': 'applied', 'applied': 'applied', 'sent': 'applied',
  'respondido': 'responded',
  'entrevista': 'interview',
  'oferta': 'offer',
  'rechazado': 'rejected', 'rechazada': 'rejected',
  'descartado': 'discarded', 'descartada': 'discarded', 'cerrada': 'discarded', 'cancelada': 'discarded',
  'no aplicar': 'skip', 'no_aplicar': 'skip', 'monitor': 'skip', 'geo blocker': 'skip',
  'contratado': 'hired', 'contratada': 'hired', 'hired': 'hired', 'accepted': 'hired', 'accept': 'hired',
};

let errors = 0;
let warnings = 0;

function error(msg) { console.log(`❌ ${msg}`); errors++; }
function warn(msg) { console.log(`⚠️  ${msg}`); warnings++; }
function ok(msg) { console.log(`✅ ${msg}`); }

// --- Read applications.md ---
if (!existsSync(APPS_FILE)) {
  console.log('\n📊 No applications.md found. This is normal for a fresh setup.');
  console.log('   The file will be created when you evaluate your first offer.\n');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

// Map columns by header name so the checks work whether the tracker uses the
// original 9-column layout or a customized one with an extra column (e.g. a
// Location column after Role). Fixed-position indexing would otherwise read
// Location where Score is expected and flag false errors. Falls back to the
// legacy fixed layout when no recognizable header row is found.
const LEGACY_COLMAP = { num: 1, date: 2, company: 3, role: 4, score: 5, status: 6, pdf: 7, report: 8, notes: 9 };
const HEADER_ALIASES = {
  '#': 'num', 'num': 'num', 'date': 'date', 'company': 'company', 'empresa': 'company',
  'via': 'via', 'role': 'role', 'puesto': 'role', 'location': 'location', 'score': 'score',
  'status': 'status', 'pdf': 'pdf', 'report': 'report', 'notes': 'notes',
};
function detectColumns(allLines) {
  for (const line of allLines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(s => s.trim().toLowerCase());
    if (!cells.includes('company') || !cells.includes('role')) continue;
    const map = {};
    cells.forEach((c, i) => { if (HEADER_ALIASES[c] != null) map[HEADER_ALIASES[c]] = i; });
    if (['num', 'company', 'role', 'score', 'status'].every(k => map[k] != null)) return map;
  }
  return null;
}
const COLMAP = detectColumns(lines) || LEGACY_COLMAP;
const MAX_IDX = Math.max(...Object.values(COLMAP));

const entries = [];
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|').map(s => s.trim());
  if (parts.length <= MAX_IDX) continue;
  const num = parseInt(parts[COLMAP.num]);
  if (isNaN(num)) continue;
  entries.push({
    num,
    date: parts[COLMAP.date],
    company: parts[COLMAP.company],
    via: COLMAP.via != null ? parts[COLMAP.via] : '',
    role: parts[COLMAP.role],
    location: COLMAP.location != null ? parts[COLMAP.location] : '',
    score: parts[COLMAP.score],
    status: parts[COLMAP.status],
    pdf: parts[COLMAP.pdf],
    report: parts[COLMAP.report],
    notes: COLMAP.notes != null ? (parts[COLMAP.notes] || '') : '',
  });
}

console.log(`\n📊 Checking ${entries.length} entries in applications.md\n`);

// --- Check 1: Canonical statuses ---
let badStatuses = 0;
for (const e of entries) {
  const clean = e.status.replace(/\*\*/g, '').trim().toLowerCase();
  // Strip trailing dates
  const statusOnly = clean.replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();

  if (!CANONICAL_STATUSES.includes(statusOnly) && !ALIASES[statusOnly]) {
    error(`#${e.num}: Non-canonical status "${e.status}"`);
    badStatuses++;
  }

  // Check for markdown bold in status
  if (e.status.includes('**')) {
    error(`#${e.num}: Status contains markdown bold: "${e.status}"`);
    badStatuses++;
  }

  // Check for dates in status
  if (/\d{4}-\d{2}-\d{2}/.test(e.status)) {
    error(`#${e.num}: Status contains date: "${e.status}" — dates go in date column`);
    badStatuses++;
  }
}
if (badStatuses === 0) ok('All statuses are canonical');

// --- Check 2: Duplicates ---
const companyRoleMap = new Map();
let dupes = 0;
for (const e of entries) {
  const key = e.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '::' +
    e.role.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  if (!companyRoleMap.has(key)) companyRoleMap.set(key, []);
  companyRoleMap.get(key).push(e);
}
for (const [key, group] of companyRoleMap) {
  if (group.length > 1) {
    warn(`Possible duplicates: ${group.map(e => `#${e.num}`).join(', ')} (${group[0].company} — ${group[0].role})`);
    dupes++;
  }
}
if (dupes === 0) ok('No exact duplicates found');

// --- Check 3: Report links ---
// Markdown links resolve relative to the file that contains them, so report
// links must resolve against the tracker's own directory (see #760). For the
// transition we also accept legacy root-relative links: try the tracker dir
// first, then fall back to the repo root before flagging a link broken.
const TRACKER_DIR = dirname(APPS_FILE);
let brokenReports = 0;
for (const e of entries) {
  const match = e.report.match(/\]\(([^)]+)\)/);
  if (!match) continue;
  const link = match[1];
  if (!existsSync(join(TRACKER_DIR, link)) && !existsSync(join(CAREER_OPS, link))) {
    error(`#${e.num}: Report not found: ${link}`);
    brokenReports++;
  }
}
if (brokenReports === 0) ok('All report links valid');

// --- Check 4: Score format ---
let badScores = 0;
for (const e of entries) {
  if (!looksLikeScoreCell(e.score)) {
    error(`#${e.num}: Invalid score format: "${e.score}"`);
    badScores++;
  }
}
if (badScores === 0) ok('All scores valid');

// --- Check 5: Row format ---
let badRows = 0;
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  if (line.includes('---') || line.includes('Empresa')) continue;
  const parts = line.split('|');
  if (parts.length <= MAX_IDX) {
    error(`Row with too few columns (need ${MAX_IDX} data cols): ${line.substring(0, 80)}...`);
    badRows++;
  }
}
if (badRows === 0) ok('All rows properly formatted');

// --- Check 6: Pending TSVs ---
let pendingTsvs = 0;
if (existsSync(ADDITIONS_DIR)) {
  const files = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
  pendingTsvs = files.length;
  if (pendingTsvs > 0) {
    warn(`${pendingTsvs} pending TSVs in tracker-additions/ (not merged)`);
  }
}
if (pendingTsvs === 0) ok('No pending TSVs');

// --- Check 7: Bold in scores ---
let boldScores = 0;
for (const e of entries) {
  if (e.score.includes('**')) {
    warn(`#${e.num}: Score has markdown bold: "${e.score}"`);
    boldScores++;
  }
}
if (boldScores === 0) ok('No bold in scores');

// --- Check 8: Stale report-number sentinels (GC) ---
// reserve-report-num.mjs drops NNN-RESERVED.md files in reports/ when a
// number is claimed.  If the process crashed before writing the real report
// and deleting the sentinel it will linger.  Sentinels older than 4 h are
// stale; remove them here so they don't skew the next slot allocation.
const SENTINEL_MAX_AGE_MS = 4 * 60 * 60 * 1000;
let staleSentinels = 0;
if (existsSync(REPORTS_DIR)) {
  const now = Date.now();
  for (const name of readdirSync(REPORTS_DIR)) {
    if (!name.endsWith('-RESERVED.md')) continue;
    const full = join(REPORTS_DIR, name);
    try {
      const { mtimeMs } = statSync(full);
      if (now - mtimeMs > SENTINEL_MAX_AGE_MS) {
        unlinkSync(full);
        warn(`Removed stale reservation sentinel: ${name}`);
        staleSentinels++;
      }
    } catch {
      // Already gone between readdir and stat — fine.
    }
  }
}
if (staleSentinels === 0) ok('No stale reservation sentinels');

// --- Check 9: Duplicate reports for the same company+role (#1425) ---
// Two concurrent evaluators can each write a report for the same role.
// merge-tracker dedups the TRACKER, but nothing watched reports/ itself.
// Warning-level, not error: duplicates can be legitimate (re-evaluation
// after a JD change).
const REPORT_FILE_RE = /^(\d+)-(.+)-\d{4}-\d{2}-\d{2}\.md$/;
const normalizeKey = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Role comes from the report body: the Machine Summary YAML fence when
// present (field names are exact by contract), else the title line
// "# Evaluación: {Company} — {Role}". Reports where neither parses are
// skipped rather than grouped by company alone, which would false-positive
// on two different roles at the same company.
function extractRole(reportContent) {
  const fence = reportContent.match(/##\s*Machine Summary\s*\n+```(?:yaml|yml|json)?\s*\n([\s\S]*?)\n```/i);
  if (fence) {
    const m = fence[1].match(/^role:\s*["']?(.+?)["']?\s*$/m);
    if (m && m[1].trim()) return m[1].trim();
  }
  const title = reportContent.split('\n').find(l => l.startsWith('# '));
  if (title) {
    const parts = title.split(/[—–]/);
    if (parts.length >= 2 && parts[parts.length - 1].trim()) return parts[parts.length - 1].trim();
  }
  return null;
}

const reportFiles = existsSync(REPORTS_DIR)
  ? readdirSync(REPORTS_DIR).filter(f => REPORT_FILE_RE.test(f))
  : [];

let dupReports = 0;
const reportsByRole = new Map();
for (const name of reportFiles) {
  const companySlug = name.match(REPORT_FILE_RE)[2];
  let role = null;
  try {
    role = extractRole(readFileSync(join(REPORTS_DIR, name), 'utf-8'));
  } catch {
    // Unreadable report — the orphan check below still sees it.
  }
  if (!role) continue;
  const key = normalizeKey(companySlug) + '::' + normalizeKey(role);
  if (!reportsByRole.has(key)) reportsByRole.set(key, []);
  reportsByRole.get(key).push(name);
}
for (const group of reportsByRole.values()) {
  if (group.length > 1) {
    warn(`Duplicate reports for same company+role: ${group.join(', ')}`);
    dupReports++;
  }
}
if (dupReports === 0) ok('No duplicate reports for the same company+role');

// --- Check 10: Orphan reports with no tracker row (#1425) ---
// Every reports/NNN-*.md should be referenced by a tracker row — by the row's
// own number, the [NNN] link text, or the NNN- prefix of the linked filename.
// A report none of them reference is usually the loser of a tracker dedup.
const referencedNums = new Set();
for (const e of entries) {
  referencedNums.add(e.num);
  const linkText = e.report.match(/\[(\d+)\]/);
  if (linkText) referencedNums.add(parseInt(linkText[1], 10));
  const linkTarget = e.report.match(/\]\(([^)]+)\)/);
  if (linkTarget) {
    const m = linkTarget[1].split('/').pop().match(/^(\d+)-/);
    if (m) referencedNums.add(parseInt(m[1], 10));
  }
}

let orphanReports = 0;
for (const name of reportFiles) {
  const num = parseInt(name.match(REPORT_FILE_RE)[1], 10);
  if (!referencedNums.has(num)) {
    warn(`Orphan report — no tracker row references #${num}: reports/${name}`);
    orphanReports++;
  }
}
if (orphanReports === 0) ok('No orphan reports');

// --- Check 11: Via channel consistency (#1596) ---
// The Via column records the intermediary (agency/recruiter firm; `—` when the
// application was direct). Unknown employers use the structural marker `?` in
// Company — never a word like "Confidential", which is locale-dependent and can
// collide with a real firm name.
let viaIssues = 0;
const CONFIDENTIAL_WORD_RE = /^(confidential|vertraulich|confidentiel|confidencial|riservato|gizli|機密|سري)$/i;
for (const e of entries) {
  const company = String(e.company || '').trim();
  const via = String(e.via || '').trim();
  if (company === '?') {
    if (COLMAP.via == null) {
      warn(`#${e.num}: unknown employer (?) but the tracker has no Via column — add it with: node merge-tracker.mjs --migrate-via`);
      viaIssues++;
    } else if (!via || via === '—') {
      error(`#${e.num}: unknown employer (?) with no Via channel — record the agency/recruiter firm`);
      viaIssues++;
    }
  }
  if (CONFIDENTIAL_WORD_RE.test(company)) {
    warn(`#${e.num}: company "${company}" looks like a confidentiality placeholder — use the structural marker ? (locale-invariant, can't collide with a real firm)`);
    viaIssues++;
  }
}
// Same company+role reached through different channels: both submissions are
// real, so this is a warning to the human (double-submission risk), never an
// auto-merge. Channel identity is normalized the same way merge-tracker.mjs
// normalizes companies (strip non-alphanumerics, lowercase), so "Hays" and
// "HAYS " read as one channel; the raw spelling is kept for the message.
const normalizeChannel = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'direct';
const channelsByRole = new Map();
for (const e of entries) {
  const company = String(e.company || '').trim();
  if (!company || company === '?') continue;
  const key = `${company.toLowerCase()}::${String(e.role || '').trim().toLowerCase()}`;
  if (!channelsByRole.has(key)) channelsByRole.set(key, new Map());
  const channels = channelsByRole.get(key);
  const norm = normalizeChannel(e.via);
  if (!channels.has(norm)) channels.set(norm, { raw: String(e.via || '').trim() || '—', num: e.num });
}
for (const [key, vias] of channelsByRole) {
  if (vias.size > 1) {
    const list = [...vias.values()];
    warn(`Cross-channel duplicate — ${key.replace('::', ' / ')} reached via ${list.map(v => v.raw).join(' AND ')} (rows ${list.map(v => `#${v.num}`).join(', ')}) — double-submission risk, resolve by hand`);
    viaIssues++;
  }
}
if (viaIssues === 0) ok('Via channels consistent');

// --- Check 12: Duplicate tracker numbers (#1704) ---
// The # column is a row id and must be unique. Unlike Check 2 (company+role
// dedup, which can false-positive on a legitimate re-application), the SAME
// number appearing on 2+ rows is never legitimate: it means set-status.mjs
// can't tell the rows apart, and any external reference to "application #N"
// (interview-prep notes, memory, cross-links) becomes ambiguous. Pure
// addition, no existing check covers this — see #1704 for the 124-row sweep
// that found this in the wild (merge-tracker.mjs trusted a stale TSV number
// as-is whenever it exceeded that run's max, without checking it wasn't
// already used by an unrelated row merged in a separate, earlier invocation).
const numGroups = new Map();
for (const e of entries) {
  if (!numGroups.has(e.num)) numGroups.set(e.num, []);
  numGroups.get(e.num).push(e);
}
let dupeNums = 0;
for (const [num, group] of numGroups) {
  if (group.length > 1) {
    error(`Duplicate tracker number #${num} used by ${group.length} rows: ${group.map(e => `${e.company} — ${e.role}`).join(' | ')}`);
    dupeNums++;
  }
}
if (dupeNums === 0) ok('No duplicate tracker numbers');

// --- Summary ---
console.log('\n' + '='.repeat(50));
console.log(`📊 Pipeline Health: ${errors} errors, ${warnings} warnings`);
if (errors === 0 && warnings === 0) {
  console.log('🟢 Pipeline is clean!');
} else if (errors === 0) {
  console.log('🟡 Pipeline OK with warnings');
} else {
  console.log('🔴 Pipeline has errors — fix before proceeding');
}

process.exit(errors > 0 ? 1 : 0);
