#!/usr/bin/env node
/**
 * merge-tracker.mjs — Merge batch tracker additions into applications.md
 *
 * Handles multiple TSV formats:
 * - 9-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes
 * - 8-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport (no notes)
 * - Pipe-delimited (markdown table row): | col | col | ... |
 *
 * Dedup: company normalized + role fuzzy match + report number match
 * If duplicate with higher score → update in-place, update report link
 * Validates status against states.yml (rejects non-canonical, logs warning)
 *
 * Run: node career-ops/merge-tracker.mjs [--dry-run] [--verify]
 */

import { readFileSync, readdirSync, mkdirSync, renameSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { normalizeReportLink as normalizeLink } from './tracker-links.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { LEGACY_COLMAP, detectColumns, resolveScoreStatus, normalizeVia } from './tracker-parse.mjs';
import { resolveTrackerPath, trackerLockDirFor, acquireTrackerLock, writeFileAtomic, normalizeCompany, cell } from './tracker-utils.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
// Support both layouts: data/applications.md (boilerplate) and applications.md
// (original). CAREER_OPS_TRACKER overrides the path (used by tests and
// non-standard layouts). Resolution lives in tracker-utils.mjs so every tracker
// writer agrees on the same canonical path (and therefore the same lock).
const APPS_FILE = resolveTrackerPath(CAREER_OPS);
const TRACKER_DIR = dirname(APPS_FILE);
// CAREER_OPS_ADDITIONS overrides the additions dir (used by tests, mirrors CAREER_OPS_TRACKER).
const ADDITIONS_DIR = process.env.CAREER_OPS_ADDITIONS
  ? process.env.CAREER_OPS_ADDITIONS
  : join(CAREER_OPS, 'batch/tracker-additions');
const MERGED_DIR = join(ADDITIONS_DIR, 'merged');
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');
const MIGRATE = process.argv.includes('--migrate');
const MIGRATE_VIA = process.argv.includes('--migrate-via');
const MERGE_HOLD_MS = Number(process.env.CAREER_OPS_MERGE_HOLD_MS) || 0;
const MERGE_READY_IPC = process.env.CAREER_OPS_MERGE_READY_IPC === '1';

const TRACKER_LOCK_DIR = trackerLockDirFor(APPS_FILE);

// The reports/ dir sits at the repo root, which is the tracker's parent in the
// data/ layout (data/applications.md) and the tracker's own dir at root layout.
const REPORTS_ROOT = basename(TRACKER_DIR) === 'data' ? dirname(TRACKER_DIR) : TRACKER_DIR;

/**
 * Normalize report links before writing them into the tracker file.
 *
 * TSV additions use root-relative report links so they are easy for agents to
 * generate. The tracker may live either at `data/applications.md` or at the
 * repository root, so this wrapper binds the correct tracker and reports
 * directories before delegating to the shared link normalizer.
 *
 * @param {string} reportField - Raw report cell from a TSV addition.
 * @returns {string} Markdown report link relative to the tracker file.
 */
const normalizeReportLink = (reportField) => normalizeLink(reportField, TRACKER_DIR, REPORTS_ROOT);

// Ensure required directories exist (fresh setup)
mkdirSync(join(CAREER_OPS, 'data'), { recursive: true });
mkdirSync(ADDITIONS_DIR, { recursive: true });

/**
 * Pause the async merge flow for a fixed number of milliseconds.
 *
 * Used by the regression test hook (`CAREER_OPS_MERGE_HOLD_MS`), which
 * deliberately holds the first merge after it reads `applications.md` so a
 * second merge can try to enter the same critical section. (The lock retry
 * loop's own sleep lives in tracker-utils.mjs with the lock.)
 *
 * @param {number} ms - Milliseconds to wait before resolving.
 * @returns {Promise<void>} Resolves after the requested delay.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let trackerLock;
try {
  trackerLock = await acquireTrackerLock(TRACKER_LOCK_DIR, {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: APPS_FILE,
  });
  process.once('exit', () => trackerLock?.release());
  if (trackerLock.waitMs > 0 || trackerLock.staleRecovered) {
    console.log(`🔒 Tracker merge lock acquired (wait_ms=${trackerLock.waitMs} | attempts=${trackerLock.attempts} | stale_recovered=${trackerLock.staleRecovered})`);
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

// Canonical states and aliases
const CANONICAL_STATES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];

/**
 * Convert raw addition status text into one canonical tracker state.
 *
 * Batch workers and older tracker additions may emit Spanish labels, bold
 * Markdown, legacy date suffixes, or repost markers. The merge script normalizes
 * all of those variants here so applications.md keeps the states defined by
 * templates/states.yml.
 *
 * @param {string} status - Raw status string from a TSV or pipe-delimited row.
 * @returns {string} Canonical tracker status.
 */
function validateStatus(status) {
  const clean = status.replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const lower = clean.toLowerCase();

  for (const valid of CANONICAL_STATES) {
    if (valid.toLowerCase() === lower) return valid;
  }

  // Aliases
  const aliases = {
    // Spanish → English
    'evaluada': 'Evaluated', 'condicional': 'Evaluated', 'hold': 'Evaluated', 'evaluar': 'Evaluated', 'verificar': 'Evaluated',
    'aplicado': 'Applied', 'enviada': 'Applied', 'aplicada': 'Applied', 'applied': 'Applied', 'sent': 'Applied',
    'respondido': 'Responded',
    'entrevista': 'Interview',
    'oferta': 'Offer',
    'rechazado': 'Rejected', 'rechazada': 'Rejected',
    'descartado': 'Discarded', 'descartada': 'Discarded', 'cerrada': 'Discarded', 'cancelada': 'Discarded',
    'no aplicar': 'SKIP', 'no_aplicar': 'SKIP', 'skip': 'SKIP', 'monitor': 'SKIP',
    'geo blocker': 'SKIP',
  };

  if (aliases[lower]) return aliases[lower];

  // DUPLICADO/Repost → Discarded
  if (/^(duplicado|dup|repost)/i.test(lower)) return 'Discarded';

  console.warn(`⚠️  Non-canonical status "${status}" → defaulting to "Evaluated"`);
  return 'Evaluated';
}

// normalizeVia (Unicode-aware Via/agency key, #1596/#1603) lives in
// tracker-parse.mjs so merge-tracker and analyze-patterns share ONE normalizer
// and agency identity can't drift between scripts. (normalizeCompany lives in
// tracker-utils.mjs since #1460 so every tracker writer shares one company key.)

/**
 * Extract the bracketed report number from a Markdown report link.
 *
 * Report-number equality is an exact duplicate signal, but only after company
 * equality is confirmed by the caller. This helper reads links such as
 * `[123](../reports/123-company-role-date.md)` and returns the numeric id.
 *
 * @param {string} reportStr - Raw report cell from applications.md or TSV input.
 * @returns {number|null} Parsed report number, or null when absent.
 */
function extractReportNum(reportStr) {
  const m = reportStr.match(/\[(\d+)\]/);
  return m ? parseInt(m[1]) : null;
}

// Matches the req/job-number labels actually seen in this tracker's free-text
// Notes column: `R_1488728`, `Req PRACT011038`, `Req #1311`, `REQ-2026-32061`,
// `Job 202606-116491`, `Job ID 65136`, `Posting ID 5340`, `JR00124259`,
// `Ref R2857957`. The label is required so we don't grab an unrelated number
// (a salary figure, a date fragment) — only text explicitly tagged as a
// req/job/posting/reference id counts.
const REQ_NUMBER_RE = /\b(?:job\s*id|posting\s*id|requisition|req|jr|job|posting|ref(?:erence)?|r_)[\s:#_-]*([a-z][a-z0-9-]*\d[a-z0-9-]*|\d[a-z0-9-]*)\b/i;

/**
 * Extract a req/job/posting number from a tracker Notes cell, if present.
 *
 * Tier-3 duplicate detection (company + fuzzy role match) has no awareness of
 * req numbers on its own, which lets two distinct postings at the same company
 * with similarly-worded titles collapse into one row (#1524 — e.g. two TD Bank
 * L&D postings distinguished only by `R_1494379` vs `R_1488728`). This helper
 * pulls out that number so the caller can treat a confirmed mismatch as proof
 * the rows are NOT duplicates, without touching cases where no number is
 * present on either side.
 *
 * @param {string} notes - Raw Notes cell from a tracker row or TSV addition.
 * @returns {string|null} Uppercased req/job number, or null when none is found.
 */
function extractReqNumber(notes) {
  if (!notes) return null;
  const m = String(notes).match(REQ_NUMBER_RE);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Parse a score cell into a numeric value for score-upgrade decisions.
 *
 * The merge path compares old and new scores to decide whether to update an
 * existing duplicate row. Markdown bolding and `/5` suffixes are presentation
 * details, so only the first numeric value is used.
 *
 * @param {string} s - Raw score cell such as `4.2/5`.
 * @returns {number} Parsed score, or 0 when no numeric value is present.
 */
function parseScore(s) {
  const m = s.replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

// Column layout for the applications.md table. The tracker may use the original
// 9-column layout, or a customized one with an extra/reordered column (e.g. a
// Location column after Role). We map columns by header NAME rather than fixed
// position so both work — fixed-position indexing would otherwise read, say,
// Location where it expects Score. Falls back to the legacy layout when no
// recognizable header row is found.
// LEGACY_COLMAP, HEADER_ALIASES and detectColumns are the shared header-name
// mapping, now sourced from tracker-parse.mjs so every tracker reader stays in
// lockstep (see imports above). COLMAP stays mutable here — it is reassigned to
// the detected layout once the table is read (below).
let COLMAP = LEGACY_COLMAP;

// Build a tracker row string matching the detected layout (with or without the
// optional Via and Location columns) so writes round-trip through the same
// schema. Optional columns follow the documented positions: Via after Company
// (#1596), Location after Role (#946).
function buildRow(o) {
  const cells = [o.num, o.date, cell(o.company)];
  if (COLMAP.via != null) cells.push(cell(o.via) || '—');
  cells.push(cell(o.role));
  if (COLMAP.location != null) cells.push(cell(o.location) || '—');
  cells.push(o.score, o.status, o.pdf, o.report, cell(o.notes));
  return `| ${cells.join(' | ')} |`;
}

/**
 * Parse one Markdown applications.md table row into a tracker object.
 *
 * Header/separator rows and malformed rows return null. Valid rows preserve the
 * original raw line so the merge logic can locate and replace the exact tracker
 * line when a higher-scored re-evaluation arrives.
 *
 * @param {string} line - One line from applications.md.
 * @returns {object|null} Parsed tracker row, or null for non-data rows.
 */
function parseAppLine(line) {
  const parts = line.split('|').map(s => s.trim());
  const maxIdx = Math.max(...Object.values(COLMAP));
  if (parts.length <= maxIdx) return null;
  const num = parseInt(parts[COLMAP.num]);
  if (isNaN(num) || num === 0) return null;
  return {
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
    raw: line,
  };
}

/**
 * Parse a TSV file content into a structured addition object.
 *
 * Handles 9-column TSV, 8-column TSV, and pipe-delimited Markdown rows. The
 * parser also tolerates old score/status column ordering, validates status, and
 * rejects additions without a usable tracker number so malformed batch output
 * cannot corrupt applications.md.
 *
 * @param {string} content - Raw file content from batch/tracker-additions.
 * @param {string} filename - Source filename used in warning messages.
 * @returns {object|null} Parsed tracker addition, or null when malformed.
 */
/**
 * Resolve the optional trailing TSV fields (index ≥ 9) into { via, location }.
 *
 * Via travels as a TAGGED field (`via=Hays`) rather than another positional
 * slot: TSV writers are LLM agents following prompt instructions, and a writer
 * that skips an empty padding field would silently shift a positional Via into
 * the Location slot (#1596). A single untagged extra remains the legacy
 * positional location (stale prompts stay valid forever). Anything ambiguous —
 * two untagged extras, duplicate via= tags — returns null so the row is
 * rejected loudly instead of merged with scrambled columns.
 *
 * @param {string[]} parts - All fields of the TSV/pipe row.
 * @param {string} filename - Source filename used in warning messages.
 * @returns {{via: string, location: string}|null}
 */
function parseTsvExtras(parts, filename) {
  const extras = parts.slice(9).map(s => String(s).trim()).filter(s => s !== '');
  const viaTags = extras.filter(s => /^via=/i.test(s));
  const untagged = extras.filter(s => !/^via=/i.test(s));
  if (viaTags.length > 1 || untagged.length > 1) {
    console.warn(`⚠️  Skipping ${filename}: ambiguous extra fields [${extras.join(', ')}] — expected at most one "via=Firm" tag and one location`);
    return null;
  }
  return {
    via: viaTags.length ? viaTags[0].replace(/^via=/i, '').trim() : '',
    location: untagged[0] || '',
  };
}

function parseTsvContent(content, filename) {
  content = content.trim();
  if (!content) return null;

  let parts;
  let addition;

  // Detect pipe-delimited (markdown table row)
  if (content.startsWith('|')) {
    parts = content.split('|').map(s => s.trim());
    if (parts[0] === '') parts.shift();
    if (parts[parts.length - 1] === '') parts.pop();
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed pipe-delimited ${filename}: ${parts.length} fields`);
      return null;
    }
    // Format: num | date | company | role | score | status | pdf | report | notes [| location]
    // Identify score vs status by content, not position, so a swapped row can't
    // merge silently (#1427).
    const resolved = resolveScoreStatus(parts[4], parts[5]);
    if (!resolved) {
      console.warn(`⚠️  Skipping ${filename}: cannot tell score from status in columns 5–6 ("${parts[4]}" | "${parts[5]}") — refusing to merge a possible column swap`);
      return null;
    }
    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      // Write-canonical: the tracker stores scores unbolded (verify-pipeline
      // rejects bold scores), so strip any markdown bold from the incoming cell.
      score: resolved.score.replace(/\*\*/g, '').trim(),
      status: validateStatus(resolved.status),
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
    };
    const extras = parseTsvExtras(parts, filename);
    if (!extras) return null;
    Object.assign(addition, extras);
  } else {
    // Tab-separated
    parts = content.split('\t');
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed TSV ${filename}: ${parts.length} fields`);
      return null;
    }

    // Column order varies: batch TSVs write (status, score), applications.md is
    // (score, status). Identify each by content — the score cell is recognizable
    // by pattern, a status never is — so a reordered TSV merges correctly and an
    // undecidable row is skipped loudly instead of merging swapped data (#1427).
    const resolved = resolveScoreStatus(parts[4].trim(), parts[5].trim());
    if (!resolved) {
      console.warn(`⚠️  Skipping ${filename}: cannot tell score from status in columns 5–6 ("${parts[4].trim()}" | "${parts[5].trim()}") — refusing to merge a possible column swap`);
      return null;
    }

    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      status: validateStatus(resolved.status),
      // Write-canonical: strip any markdown bold so the stored score stays
      // unbolded (verify-pipeline rejects bold scores).
      score: resolved.score.replace(/\*\*/g, '').trim(),
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
    };
    const extras = parseTsvExtras(parts, filename);
    if (!extras) return null;
    Object.assign(addition, extras);
  }

  if (isNaN(addition.num) || addition.num === 0) {
    console.warn(`⚠️  Skipping ${filename}: invalid entry number`);
    return null;
  }

  return addition;
}

// ---- Main ----

// Read applications.md
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to merge into.');
  process.exit(0);
}
const appContent = readFileSync(APPS_FILE, 'utf-8');
// Test-only synchronization hook: the concurrent merge test waits for the
// first worker to read the tracker while still holding the lock, then starts a
// second worker to prove the lock prevents the old lost-update race.
if (MERGE_READY_IPC && typeof process.send === 'function') {
  process.send({ type: 'merge-tracker-ready' });
}
if (MERGE_HOLD_MS > 0) {
  await sleep(MERGE_HOLD_MS);
}

// One-time migration: rewrite existing report links so they resolve relative
// to the tracker file's directory (see #760). Run with: node merge-tracker.mjs --migrate
if (MIGRATE) {
  const migrated = appContent
    .split('\n')
    .map(line => (line.startsWith('|') ? normalizeReportLink(line) : line));
  const before = appContent.split('\n');
  const changed = migrated.filter((l, i) => l !== before[i]).length;

  if (DRY_RUN) {
    console.log(`🔎 Migration (dry-run): ${changed} row(s) would be rewritten in ${basename(APPS_FILE)}`);
  } else {
    writeFileAtomic(APPS_FILE, migrated.join('\n'));
    console.log(`✅ Migration: rewrote ${changed} report link(s) in ${basename(APPS_FILE)} relative to ${TRACKER_DIR === CAREER_OPS ? 'repo root' : 'data/'}`);
  }
  process.exit(0);
}

// Opt-in migration (#1596): insert a Via column (intermediary channel) after
// Company. Header-aware readers auto-detect both layouts, so this is optional —
// it exists for users who want the column added to an existing tracker.
// Idempotent: a tracker that already has a Via column is left untouched.
// Run with: node merge-tracker.mjs --migrate-via [--dry-run]
if (MIGRATE_VIA) {
  const lines = appContent.split('\n');
  const colmap = detectColumns(lines) || LEGACY_COLMAP;
  if (colmap.via != null) {
    console.log('✅ Via column already present — nothing to migrate.');
    process.exit(0);
  }
  const companyIdx = colmap.company;
  let changed = 0;
  const migrated = lines.map(line => {
    if (!line.startsWith('|')) return line;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length <= companyIdx) return line;
    const isHeader = parts[colmap.num] === '#';
    const isSeparator = /^[-: ]*$/.test(parts.join(''));
    const insert = isHeader ? 'Via' : isSeparator ? '-----' : '—';
    const cells = [...parts.slice(1, companyIdx + 1), insert, ...parts.slice(companyIdx + 1, parts.length - 1)];
    changed++;
    return isSeparator
      ? `|${cells.map(c => c || '---').join('|')}|`
      : `| ${cells.join(' | ')} |`;
  });
  if (DRY_RUN) {
    console.log(`🔎 Migration (dry-run): Via column would be inserted after Company (${changed} table line(s) rewritten)`);
  } else {
    writeFileAtomic(APPS_FILE, migrated.join('\n'));
    console.log(`✅ Migration: inserted Via column after Company (${changed} table line(s) rewritten). Direct applications are marked —.`);
  }
  process.exit(0);
}

const appLines = appContent.split('\n');
// Detect the tracker's column layout via header names so parsing and writing
// both work whether the table uses the original 9-column layout or a customized
// one (e.g. with a Location column after Role). Falls back to the legacy layout.
COLMAP = detectColumns(appLines) || LEGACY_COLMAP;
if (COLMAP.location != null) console.log('🧭 Detected Location column.');
if (COLMAP.via != null) console.log('🧭 Detected Via column.');
const existingApps = [];
let maxNum = 0;

for (const line of appLines) {
  if (line.startsWith('|') && !line.includes('---') && !line.includes('Empresa')) {
    const app = parseAppLine(line);
    if (app) {
      existingApps.push(app);
      if (app.num > maxNum) maxNum = app.num;
    }
  }
}

// Full set of numbers already on the tracker (#1704). This is a separate,
// deliberately narrower pass than the existingApps loop above: it reads only
// the numeric # cell and skips a row via the same NaN check verify-pipeline.mjs
// uses, instead of the `.includes('---') / .includes('Empresa')` heuristic —
// so a company or role field that happens to CONTAIN "Empresa" or "---" (e.g.
// a Spanish-market company name, or an em-dash-style separator in a title)
// can't hide that row's number the way it can hide the row from existingApps
// (which stays as-is; it drives duplicate detection, not numbering). Used
// below so a new entry's number is checked against every number actually on
// the tracker, not just the largest one the existingApps loop happened to see.
const usedNumbers = new Set();
const MAX_COL_IDX = Math.max(...Object.values(COLMAP));
for (const line of appLines) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|').map(s => s.trim());
  if (parts.length <= MAX_COL_IDX) continue;
  const n = parseInt(parts[COLMAP.num]);
  if (!isNaN(n) && n !== 0) {
    usedNumbers.add(n);
    if (n > maxNum) maxNum = n;
  }
}

console.log(`📊 Existing: ${existingApps.length} entries, max #${maxNum}`);

// Read tracker additions
if (!existsSync(ADDITIONS_DIR)) {
  console.log('No tracker-additions directory found.');
  process.exit(0);
}

const tsvFiles = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
if (tsvFiles.length === 0) {
  console.log('✅ No pending additions to merge.');
  process.exit(0);
}

// Sort files numerically for deterministic processing
tsvFiles.sort((a, b) => {
  const numA = parseInt(/^(\d+)/.exec(a)?.[1] ?? '', 10) || 0;
  const numB = parseInt(/^(\d+)/.exec(b)?.[1] ?? '', 10) || 0;
  return numA - numB;
});

console.log(`📥 Found ${tsvFiles.length} pending additions`);

let added = 0;
let updated = 0;
let skipped = 0;
const newLines = [];

for (const file of tsvFiles) {
  const content = readFileSync(join(ADDITIONS_DIR, file), 'utf-8').trim();
  const addition = parseTsvContent(content, file);
  if (!addition) { skipped++; continue; }

  // A via= tag can only be stored if the tracker has a Via column — warn
  // instead of dropping the channel silently (#1596). Clear the value too:
  // existing rows parse with via='' on this layout, so a set addition.via would
  // make the cross-channel duplicate guard see a channel mismatch and add a
  // second ? row instead of updating the same-agency re-blast.
  if (addition.via && COLMAP.via == null) {
    console.warn(`⚠️  ${file}: carries via=${addition.via} but the tracker has no Via column — value dropped. Add it with: node merge-tracker.mjs --migrate-via`);
    addition.via = '';
  }

  // Normalize the report link to be relative to the tracker file's directory.
  // The TSV convention carries a root-relative `reports/...` link; rewrite it
  // so it resolves correctly when clicked from applications.md (see #760).
  addition.report = normalizeReportLink(addition.report);

  // Check for duplicate by:
  // 1. Exact report number match
  // 2. Company + role fuzzy match
  const reportNum = extractReportNum(addition.report);
  let duplicate = null;

  if (reportNum) {
    // Report-number match must also confirm company (#912). Report-file
    // sequence and tracker-row sequence are independent, so the same number
    // appearing for two different companies is sequence drift, not a duplicate.
    // Without the company guard, a NewCo TSV with report [1] silently overwrites
    // the existing tracker row [1] belonging to an unrelated company.
    const normCompany = normalizeCompany(addition.company);
    duplicate = existingApps.find(app => {
      const existingReportNum = extractReportNum(app.report);
      return existingReportNum === reportNum && normalizeCompany(app.company) === normCompany;
    });
  }

  if (!duplicate) {
    // Exact entry number match — but only when the company also matches.
    // The TSV `num` doubles as the tracker row id, yet report-file numbering
    // and tracker-row numbering can drift out of sync (e.g. reports maxed at
    // 067 while the tracker was already at #69). A bare num collision across
    // *different* companies is that drift, not a duplicate — matching on num
    // alone silently merges a brand-new role into an unrelated existing row.
    const normCompany = normalizeCompany(addition.company);
    duplicate = existingApps.find(app =>
      app.num === addition.num && normalizeCompany(app.company) === normCompany
    );
  }

  if (!duplicate) {
    // Company + role fuzzy match
    const normCompany = normalizeCompany(addition.company);
    const additionReqNum = extractReqNumber(addition.notes);
    duplicate = existingApps.find(app => {
      if (normalizeCompany(app.company) !== normCompany) return false;
      if (!roleFuzzyMatch(addition.role, app.role)) return false;
      // Cross-channel guard (#1596): unknown-employer rows (`?`) all normalize
      // to the same empty company key, but the same role via two DIFFERENT
      // agencies is two real submissions — merging them silently is exactly
      // the double-submission hazard the Via column exists to surface. Only
      // the same channel (the agency re-blasting one listing) is a duplicate.
      // Via comparison is Unicode-aware (#1603): normalizeCompany() would
      // collapse distinct non-Latin agency names to the same empty key.
      if ((String(addition.company).trim() === '?' || String(app.company).trim() === '?')
          && normalizeVia(addition.via || '') !== normalizeVia(app.via || '')) return false;
      // Req/job-number guard (#1524): a similarly-worded title at the same
      // company can still be a genuinely distinct posting when a req/job
      // number in the Notes column proves it (employers like TD commonly run
      // concurrent near-identical L&D/HR titles distinguished only by req#).
      // Only treat this as evidence the rows differ when BOTH sides carry an
      // extractable number and they disagree — if either side has none, fall
      // back to today's fuzzy-match-only behavior unchanged.
      const appReqNum = extractReqNumber(app.notes);
      if (additionReqNum && appReqNum && additionReqNum !== appReqNum) return false;
      return true;
    });
  }

  if (duplicate) {
    const newScore = parseScore(addition.score);
    const oldScore = parseScore(duplicate.score);

    if (newScore > oldScore) {
      console.log(`🔄 Update: #${duplicate.num} ${addition.company} — ${addition.role} (${oldScore}→${newScore})`);
      const lineIdx = appLines.indexOf(duplicate.raw);
      if (lineIdx >= 0) {
        const updatedLine = buildRow({
          num: duplicate.num, date: addition.date, company: addition.company, role: addition.role,
          via: addition.via || duplicate.via || '—',
          location: addition.location || duplicate.location || '—',
          score: addition.score, status: duplicate.status, pdf: duplicate.pdf,
          report: addition.report,
          notes: `Re-eval ${addition.date} (${oldScore}→${newScore}). ${addition.notes}`,
        });
        appLines[lineIdx] = updatedLine;
        updated++;
      }
    } else {
      console.log(`⏭️  Skip: ${addition.company} — ${addition.role} (existing #${duplicate.num} ${oldScore} >= new ${newScore})`);
      skipped++;
    }
  } else {
    // New entry — trust the TSV's own number only when it is BOTH ahead of
    // this run's max AND not already claimed by any row on the tracker.
    // `addition.num > maxNum` alone is not proof the number is free: a stale,
    // precomputed number (e.g. carried by a batch worker's TSV that sat
    // unmerged while other unrelated evaluations were merged in the
    // meantime) can still collide with a row already on the tracker even
    // though it's numerically ahead of a naive maxNum snapshot (#1704).
    // usedNumbers already includes every number this run has assigned so
    // far (added below), so same-run collisions are covered too.
    let entryNum;
    if (addition.num > maxNum && !usedNumbers.has(addition.num)) {
      entryNum = addition.num;
    } else {
      entryNum = maxNum + 1;
      while (usedNumbers.has(entryNum)) entryNum++;
    }
    usedNumbers.add(entryNum);
    if (entryNum > maxNum) maxNum = entryNum;

    const newLine = buildRow({
      num: entryNum, date: addition.date, company: addition.company, role: addition.role,
      via: addition.via || '—',
      location: addition.location || '—',
      score: addition.score, status: addition.status, pdf: addition.pdf,
      report: addition.report, notes: addition.notes,
    });
    newLines.push(newLine);
    added++;
    console.log(`➕ Add #${entryNum}: ${addition.company} — ${addition.role} (${addition.score})`);
  }
}

// Insert new lines after the header (line index of first data row)
if (newLines.length > 0) {
  // Find header separator (|---|...) and insert after it
  let insertIdx = -1;
  for (let i = 0; i < appLines.length; i++) {
    if (appLines[i].includes('---') && appLines[i].startsWith('|')) {
      insertIdx = i + 1;
      break;
    }
  }
  if (insertIdx >= 0) {
    appLines.splice(insertIdx, 0, ...newLines);
  }
}

// Write back
if (!DRY_RUN) {
  writeFileAtomic(APPS_FILE, appLines.join('\n'));

  // Move processed files to merged/
  if (!existsSync(MERGED_DIR)) mkdirSync(MERGED_DIR, { recursive: true });
  for (const file of tsvFiles) {
    renameSync(join(ADDITIONS_DIR, file), join(MERGED_DIR, file));
  }
  console.log(`\n✅ Moved ${tsvFiles.length} TSVs to merged/`);
}

console.log(`\n📊 Summary: +${added} added, 🔄${updated} updated, ⏭️${skipped} skipped`);
if (DRY_RUN) console.log('(dry-run — no changes written)');
trackerLock.release();

// Optional verify
if (VERIFY && !DRY_RUN) {
  console.log('\n--- Running verification ---');
  try {
    execFileSync('node', [join(CAREER_OPS, 'verify-pipeline.mjs')], { stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
}
