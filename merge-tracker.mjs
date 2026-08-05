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
import { parsePdfIndex } from './find.mjs';
import { LEGACY_COLMAP, detectColumns, resolveScoreStatus, normalizeVia, SEPARATOR_ROW_RE } from './tracker-parse.mjs';
import { resolveTrackerPath, resolveWorkspaceRoot, resolvePdfIndexPath, trackerLockDirFor, acquireTrackerLock, writeFileAtomic, normalizeCompany, cell } from './tracker-utils.mjs';

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
// CAREER_OPS_BATCH_STATE overrides the batch-state.tsv path (used by tests).
const BATCH_STATE_FILE = process.env.CAREER_OPS_BATCH_STATE
  ? process.env.CAREER_OPS_BATCH_STATE
  : join(CAREER_OPS, 'batch/batch-state.tsv');

// Cross-check against batch-state.tsv (found 2026-07-30): a worker can write
// a well-formed tracker TSV even when its own JSON result said "failed" --
// e.g. two workers that fabricated a placeholder score (0.0/5, "Suspicious")
// for a posting they never actually read, after being unable to extract the
// JD. batch-runner.sh's JSON-status detection is the authority on whether an
// offer really succeeded; a TSV whose report number maps to a "failed" row
// there is fabricated evidence, not just cosmetically ambiguous like the
// score/status column-swap check below -- it must never merge, however
// well-formed the TSV itself looks in isolation.
function loadFailedReportNumbers(path) {
  const failed = new Set();
  if (!existsSync(path)) return failed;
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('id\t')) continue;
    const cols = line.split('\t');
    if (cols.length < 6) continue;
    const status = cols[2];
    const reportNum = cols[5];
    if (status === 'failed' && reportNum && reportNum !== '-') {
      const n = parseInt(reportNum, 10);
      if (!isNaN(n)) failed.add(n);
    }
  }
  return failed;
}
const FAILED_REPORT_NUMBERS = loadFailedReportNumbers(BATCH_STATE_FILE);
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');
const MIGRATE = process.argv.includes('--migrate');
const MIGRATE_VIA = process.argv.includes('--migrate-via');
const MERGE_HOLD_MS = Number(process.env.CAREER_OPS_MERGE_HOLD_MS) || 0;
const MERGE_READY_IPC = process.env.CAREER_OPS_MERGE_READY_IPC === '1';

const TRACKER_LOCK_DIR = trackerLockDirFor(APPS_FILE);

// The reports/ dir sits at the repo root, which is the tracker's parent in the
// data/ layout (data/applications.md) and the tracker's own dir at root layout.
// Shared with sync-pdf-flags.mjs so the two agree on where a workspace's
// siblings live — they disagreed before #2471.
const REPORTS_ROOT = resolveWorkspaceRoot(APPS_FILE);
const PDF_INDEX_FILE = resolvePdfIndexPath(APPS_FILE);

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
const CANONICAL_STATES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Hired', 'Rejected', 'Discarded', 'SKIP'];

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
    'contratado': 'Hired', 'contratada': 'Hired', 'accepted': 'Hired', 'accept': 'Hired',
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
 * Company equality for duplicate detection.
 *
 * normalizeCompany() strips everything outside [a-z0-9], so a company name
 * written entirely in a non-Latin script (CJK, Cyrillic, Arabic, …) normalizes
 * to the empty string — and every such name would compare equal to every other
 * one. That collapses DIFFERENT companies into one row as soon as their roles
 * fuzzy-match (six Japanese companies posting データエンジニア → one row).
 * When the normalized key carries no signal, fall back to raw trimmed
 * equality so distinct non-Latin companies stay distinct; the unknown-employer
 * `?` marker still matches itself, so the #1596 cross-channel guard keeps its
 * existing behavior.
 *
 * @param {string} a - Company cell from one side of the comparison.
 * @param {string} b - Company cell from the other side.
 * @returns {boolean} True when the two cells name the same company.
 */
function companiesMatch(a, b) {
  const key = normalizeCompany(String(a));
  if (key !== normalizeCompany(String(b))) return false;
  return key !== '' || String(a).trim() === String(b).trim();
}

/**
 * Combine an existing row's Notes with a re-evaluation's Notes.
 *
 * The update path used to overwrite Notes with
 * `Re-eval {date} ({old}→{new}). {new notes}`, discarding the existing cell
 * outright (#2392 gap 2). The Notes column is not decoration: it carries the
 * `Applied YYYY-MM-DD` marker that followup-cadence.mjs prefers over the Date
 * column (dropping it silently resets the follow-up clock to the evaluation
 * date), the req/job number that this script's OWN sibling-req guard reads back
 * via extractReqNumber(), contact addresses, and whatever the user wrote with
 * `set-status --note`. None of it is recoverable: applications.md is gitignored
 * and no .bak is written.
 *
 * Format: the existing notes are kept verbatim and FIRST, with the re-eval
 * marker and any new notes appended after them. Order is deliberate, not
 * cosmetic — parseAppliedDate() and extractReqNumber() both return their FIRST
 * match, so leading with the established text keeps a row's apply date and req
 * number stable across re-evaluations instead of letting each new evaluation's
 * text take over. The cost is that Notes grows by one clause per re-evaluation.
 *
 * @param {string} existingNotes - Notes cell currently on the tracker row.
 * @param {object} addition - Parsed TSV addition (uses `notes` and `date`).
 * @param {number} oldScore - Score currently on the row.
 * @param {number} newScore - Score from the addition.
 * @param {string} [extraMarker] - Appended to the re-eval marker, before any
 *   incoming notes. Used by the downgrade path to record the superseded report
 *   (#2411). It rides on the marker rather than on `addition.notes` so that the
 *   repeat detection below keeps comparing the user's own text against the
 *   user's own text — a generated fragment in that comparison would make every
 *   downgrade look like a new note and defeat it.
 * @returns {string} Combined Notes cell.
 */
function mergeNotes(existingNotes, addition, oldScore, newScore, extraMarker = '') {
  // Trailing period trimmed only so the '. ' join does not produce '..'; no
  // other character of the existing text is touched. The tracker's "no data"
  // sentinels (the looksLikeScoreCell set minus the score-only DUP) count as
  // empty here: a placeholder cell collapses to the marker instead of gaining
  // a `—. ` separator the row never had (#2483).
  const prevRaw = String(existingNotes ?? '').trim();
  const prev = ['—', '-', 'N/A'].includes(prevRaw)
    ? ''
    : prevRaw.replace(/\s*\.\s*$/, '');
  const incoming = String(addition.notes ?? '').trim();
  const marker = extraMarker
    ? `Re-eval ${addition.date} (${oldScore}→${newScore}) — ${extraMarker}`
    : `Re-eval ${addition.date} (${oldScore}→${newScore})`;
  // Re-running the same evaluation would otherwise repeat its own text; the
  // marker still records that the re-evaluation happened. Repeats are detected
  // per CLAUSE — the same '. ' separator this function joins with — not by raw
  // substring: `prev.includes(incoming)` dropped any new note that happened to
  // appear INSIDE an existing clause ("Remote" vanished against "Remote OK").
  // A clause equals the incoming text either bare or in the marker-prefixed
  // form a previous run of this function appended (`{marker}: {incoming}`).
  const clause = (s) => s.replace(/\.+$/, '').trim();
  const incomingClause = clause(incoming);
  const isRepeat = incoming !== '' && prev.split(/\.\s+/).map(clause)
    .some(c => c === incomingClause || c.endsWith(`: ${incomingClause}`));
  const tail = incoming && !isRepeat ? `${marker}: ${incoming}` : marker;
  return prev ? `${prev}. ${tail}` : tail;
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

/**
 * Load the optional generated-PDF manifest.
 *
 * data/pdf-index.tsv is gitignored and only exists after generate-pdf.mjs has
 * written at least one PDF. Missing manifest = nothing to sync.
 *
 * @returns {Map<string,string>} Normalized report# → PDF path.
 */
function loadPdfIndex() {
  return existsSync(PDF_INDEX_FILE)
    ? parsePdfIndex(readFileSync(PDF_INDEX_FILE, 'utf-8'))
    : new Map();
}

/**
 * Flip stale PDF cells to ✅ when the generated-PDF manifest has the row's
 * report number.
 *
 * @param {Array<object>} existingApps - Parsed tracker rows.
 * @param {string[]} appLines - Mutable tracker file lines.
 * @param {Map<string,string>} pdfIndex - Normalized report# → PDF path.
 * @returns {number} Number of tracker rows updated.
 */
function syncPdfFlags(existingApps, appLines, pdfIndex) {
  let changed = 0;
  if (pdfIndex.size === 0) return changed;

  for (const app of existingApps) {
    const reportNum = extractReportNum(app.report);
    if (!reportNum || !pdfIndex.has(String(reportNum)) || app.pdf !== '❌') continue;

    const lineIdx = appLines.indexOf(app.raw);
    if (lineIdx < 0) continue;

    console.log(`${DRY_RUN ? '🔄 PDF sync (dry-run)' : '🔄 PDF sync'}: #${app.num} ${app.company} — report ${reportNum} now has a generated PDF`);
    if (!DRY_RUN) {
      const updatedLine = buildRow({ ...app, pdf: '✅' });
      appLines[lineIdx] = updatedLine;
      app.pdf = '✅';
      app.raw = updatedLine;
    }
    changed++;
  }

  return changed;
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

// Header + separator for the DETECTED layout, mirroring buildRow's column
// order. The abort path below prints these as repair guidance, so hard-coding
// the nine-column form would hand a user with a Via or Location column a
// header that silently drops it — repair instructions that reintroduce the
// drift they exist to fix.
function buildHeaderRows() {
  const labels = ['#', 'Date', 'Company'];
  if (COLMAP.via != null) labels.push('Via');
  labels.push('Role');
  if (COLMAP.location != null) labels.push('Location');
  labels.push('Score', 'Status', 'PDF', 'Report', 'Notes');
  return {
    header: `| ${labels.join(' | ')} |`,
    separator: `|${labels.map((l) => '-'.repeat(Math.max(3, l.length + 2))).join('|')}|`,
  };
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
  // Skip only on the NaN check inside parseAppLine, which already rejects the
  // header and separator rows because neither has a numeric `#` cell. The old
  // `.includes('---') / .includes('Empresa')` heuristic was redundant for those
  // two rows and wrong for data rows: any row whose free text contained three
  // hyphens (a URL slug such as `Senior-Engineer---Platform-Team`, an em
  // dash typed as `---`) or the word "Empresa" (a Spanish-market company name)
  // never reached existingApps, so duplicate detection could not see it and a
  // re-evaluation of that role appended a second row instead of updating it in
  // place. #1704 fixed the numbering half of this with the usedNumbers pass
  // below; this is the dedup half (#2265).
  if (!line.startsWith('|')) continue;
  const app = parseAppLine(line);
  if (app) {
    existingApps.push(app);
    if (app.num > maxNum) maxNum = app.num;
  }
}

// Full set of numbers already on the tracker (#1704). Deliberately broader than
// the existingApps loop above: it reserves the number from any row with a
// numeric # cell, including a row too malformed for parseAppLine to return.
// Such a row can't participate in duplicate detection, but its number is still
// taken and must never be handed out again. Used below so a new entry's number
// is checked against every number actually on the tracker, not just the largest
// one the existingApps loop saw.
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
let added = 0;
let updated = 0;
let skipped = 0;
const pdfIndex = loadPdfIndex();
const pdfSynced = syncPdfFlags(existingApps, appLines, pdfIndex);
updated += pdfSynced;

// Read tracker additions
if (!existsSync(ADDITIONS_DIR)) {
  console.log('No tracker-additions directory found.');
  if (pdfSynced > 0 && !DRY_RUN) writeFileAtomic(APPS_FILE, appLines.join('\n'));
  if (DRY_RUN) console.log('(dry-run — no changes written)');
  trackerLock.release();
  process.exit(0);
}

const tsvFiles = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
if (tsvFiles.length === 0) {
  console.log('✅ No pending additions to merge.');
  if (pdfSynced > 0 && !DRY_RUN) writeFileAtomic(APPS_FILE, appLines.join('\n'));
  if (DRY_RUN) console.log('(dry-run — no changes written)');
  trackerLock.release();
  process.exit(0);
}

// Sort files numerically for deterministic processing
tsvFiles.sort((a, b) => {
  const numA = parseInt(/^(\d+)/.exec(a)?.[1] ?? '', 10) || 0;
  const numB = parseInt(/^(\d+)/.exec(b)?.[1] ?? '', 10) || 0;
  return numA - numB;
});

console.log(`📥 Found ${tsvFiles.length} pending additions`);

const newLines = [];
// TSVs whose evaluation could not be applied to the tracker. They are kept out
// of merged/ so a re-run picks them up, and they make the process exit non-zero
// instead of reporting a success that did not happen.
const failedAdditions = [];

/**
 * Replace one tracker row line wherever it currently lives.
 *
 * A row added earlier in THIS run is still queued in `newLines` and has not
 * been spliced into `appLines` yet, so an update targeting it would not be
 * found by an appLines-only lookup (#2392 gap 3). Searching both keeps the
 * intra-run dedup below able to update a row it just created.
 *
 * @param {string} oldLine - The row line as it currently stands.
 * @param {string} updatedLine - Replacement row line.
 * @returns {boolean} True when the line was found and replaced.
 */
function replaceTrackerLine(oldLine, updatedLine) {
  const idx = appLines.indexOf(oldLine);
  if (idx >= 0) {
    appLines[idx] = updatedLine;
    return true;
  }
  const pendingIdx = newLines.indexOf(oldLine);
  if (pendingIdx >= 0) {
    newLines[pendingIdx] = updatedLine;
    return true;
  }
  return false;
}

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

  if (reportNum && FAILED_REPORT_NUMBERS.has(reportNum)) {
    console.warn(`⚠️  Skipping ${file}: report #${reportNum} is marked "failed" in batch-state.tsv — refusing to merge a tracker line for an offer the batch runner itself recorded as failed (possible fabricated result)`);
    skipped++;
    continue;
  }

  let duplicate = null;
  // True only for a tier-1 match (report number + company): the one tier where
  // the addition is provably the same evaluation as the existing row, so its
  // role title may replace the row's. Tier-2 (entry num) and tier-3 (fuzzy
  // role) matches keep the existing title — a fuzzy false positive that also
  // rewrites the title destroys the evidence that two reqs were distinct.
  let reportNumMatched = false;

  if (reportNum) {
    // Report-number match must also confirm company (#912). Report-file
    // sequence and tracker-row sequence are independent, so the same number
    // appearing for two different companies is sequence drift, not a duplicate.
    // Without the company guard, a NewCo TSV with report [1] silently overwrites
    // the existing tracker row [1] belonging to an unrelated company.
    duplicate = existingApps.find(app => {
      const existingReportNum = extractReportNum(app.report);
      return existingReportNum === reportNum && companiesMatch(app.company, addition.company);
    });
    if (duplicate) reportNumMatched = true;
  }

  if (!duplicate) {
    // Exact entry number match — but only when the company also matches.
    // The TSV `num` doubles as the tracker row id, yet report-file numbering
    // and tracker-row numbering can drift out of sync (e.g. reports maxed at
    // 067 while the tracker was already at #69). A bare num collision across
    // *different* companies is that drift, not a duplicate — matching on num
    // alone silently merges a brand-new role into an unrelated existing row.
    duplicate = existingApps.find(app =>
      app.num === addition.num && companiesMatch(app.company, addition.company)
      // Same-run num collisions are reservation races, not row-id references:
      // two TSVs that both claimed num=5 for DIFFERENT roles at one company
      // are two distinct evaluations, and folding them keeps the first title
      // with the second score (main renumbers and keeps both via the
      // #1704/#1733 path). For a row queued THIS run, only accept the num
      // match when the roles also fuzzy-match — consistent with tier-3's
      // cross-run semantics. For rows already on disk, num remains the
      // tracker row id and behavior is unchanged.
      && (!app.addedThisRun || roleFuzzyMatch(addition.role, app.role))
    );
  }

  if (!duplicate) {
    // Company + role fuzzy match
    const additionReqNum = extractReqNumber(addition.notes);
    duplicate = existingApps.find(app => {
      if (!companiesMatch(app.company, addition.company)) return false;
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

    // A re-evaluation writes through in BOTH directions. A lower score is not
    // noise to discard — it is newer information, and often the most valuable
    // kind: a targeting/policy change, a freshly-discovered staleness signal (a
    // requisition turning out to be a year old), or a gap re-weighted from
    // "ramp-up item" to "decisive gate". The former `newScore > oldScore` gate
    // sent all of those to a bare `else`, so the tracker kept asserting a stale
    // optimistic score, the new report was orphaned, and the TSV was archived to
    // merged/ as if it had landed (#2411). Equal scores write through too, since
    // the notes and report link are still fresher than what the row holds.
    //
    // Because the fuzzy matcher can mis-pair genuinely different roles (see
    // role-matcher.mjs — "Senior" is a stopword and short tokens are dropped), a
    // downgrade records the superseded report number so a bad match stays
    // recoverable from the tracker alone. mergeNotes() keeps the existing cell
    // verbatim and first, so a second downgrade preserves the earlier marker
    // rather than overwriting it.
    const downgrade = newScore < oldScore;
    const oldReportNum = extractReportNum(duplicate.report);
    const supersededNote = downgrade && oldReportNum && oldReportNum !== reportNum
      ? `Superseded report [${oldReportNum}] (was ${oldScore}/5)`
      : '';

    console.log(
      `${downgrade ? '🔽' : '🔄'} Update: #${duplicate.num} ${addition.company} — ${addition.role} (${oldScore}→${newScore})`
      + (downgrade ? ' — DOWNGRADE, re-eval scored lower' : ''),
    );
    const pdf = reportNum && pdfIndex.has(String(reportNum)) ? '✅' : duplicate.pdf;
    const updatedLine = buildRow({
      num: duplicate.num, date: addition.date, company: addition.company,
      role: reportNumMatched ? addition.role : duplicate.role,
      via: addition.via || duplicate.via || '—',
      location: addition.location || duplicate.location || '—',
      score: addition.score, status: duplicate.status, pdf,
      report: addition.report,
      notes: mergeNotes(duplicate.notes, addition, oldScore, newScore, supersededNote),
    });
    if (replaceTrackerLine(duplicate.raw, updatedLine)) {
      // Refresh the cached row from the line just written (#2392). `raw` was
      // captured when applications.md was parsed and used to be left stale
      // after the write, so a SECOND addition matching this same row found
      // nothing at indexOf(), fell through a branch with no else, and was
      // archived as merged — the evaluation was gone with no warning and no
      // recoverable copy (the tracker is gitignored and no .bak is written).
      // The stale `score` was just as damaging: the second comparison read
      // the pre-update score, so which of several re-evaluations survived
      // depended on TSV filename sort order. Re-parsing the written line is
      // the faithful refresh — the cached row then holds exactly what a fresh
      // read of the tracker would produce. syncPdfFlags() has always kept its
      // cache in step this way; the update path did not.
      const refreshed = parseAppLine(updatedLine);
      if (refreshed) Object.assign(duplicate, refreshed);
      else duplicate.raw = updatedLine;
      updated++;
    } else {
      // Unreachable once `raw` is refreshed above, but never silent again: a
      // row we cannot locate means the addition was NOT applied, so say so,
      // keep the TSV out of merged/, and fail the run.
      console.error(
        `❌ ${file}: could not locate tracker row #${duplicate.num} ` +
        `(${duplicate.company} — ${duplicate.role}) to update; this evaluation was NOT merged.`,
      );
      failedAdditions.push(file);
    }
  } else {
    // New entry - preserve the TSV's reserved ID whenever it is actually
    // free. Parallel workers can finish out of order, so a valid reservation
    // may be lower than the current tracker maximum (#1733). Renumber only on
    // a real collision, using the next free ID above the current maximum and
    // warning loudly so report/tracker drift is visible (#1704).
    let entryNum;
    if (!usedNumbers.has(addition.num)) {
      entryNum = addition.num;
    } else {
      entryNum = maxNum + 1;
      while (usedNumbers.has(entryNum)) entryNum++;
      console.warn(
        `⚠️  Tracker #${addition.num} already used; assigning #${entryNum} to ` +
        `${addition.company} — ${addition.role}. Report link remains ${addition.report}.`,
      );
    }
    usedNumbers.add(entryNum);
    if (entryNum > maxNum) maxNum = entryNum;

    const pdf = reportNum && pdfIndex.has(String(reportNum)) ? '✅' : addition.pdf;
    const newLine = buildRow({
      num: entryNum, date: addition.date, company: addition.company, role: addition.role,
      via: addition.via || '—',
      location: addition.location || '—',
      score: addition.score, status: addition.status, pdf,
      report: addition.report, notes: addition.notes,
    });
    newLines.push(newLine);
    // Register the row with the dedup index right away (#2392 gap 3). All
    // three dedup tiers search `existingApps`, which only ever held rows read
    // from the file, so two TSVs for the same company+role in ONE run both
    // appended and the tracker gained duplicate rows — the exact outcome
    // CLAUDE.md's "NEVER create new entries if company+role already exists"
    // rule forbids. The parsed row's `raw` is the queued line, and
    // replaceTrackerLine() knows how to find it in `newLines`, so a later
    // higher-scored addition updates it in place just like a row already on
    // disk.
    const parsedNew = parseAppLine(newLine);
    if (parsedNew) {
      // Mark the row as queued this run: tier-2 treats a num collision with a
      // same-run row as a reservation race unless the roles also fuzzy-match
      // (see the tier-2 guard above). Object.assign() in the update path never
      // deletes the flag, so it survives in-place refreshes within the run.
      parsedNew.addedThisRun = true;
      existingApps.push(parsedNew);
    }
    added++;
    console.log(`➕ Add #${entryNum}: ${addition.company} — ${addition.role} (${addition.score})`);
  }
}

// Insert new lines after the header (line index of first data row)
if (newLines.length > 0) {
  // Find header separator (|---|...) and insert after it. Match the row's
  // structure rather than a bare `---` substring, so a data row carrying three
  // hyphens in its free text can never be mistaken for the separator.
  let insertIdx = -1;
  for (let i = 0; i < appLines.length; i++) {
    if (SEPARATOR_ROW_RE.test(appLines[i])) {
      insertIdx = i + 1;
      break;
    }
  }
  if (insertIdx < 0) {
    // #2394: no separator row means no insert point. The old code left
    // insertIdx at -1, skipped the splice with no else, then carried on to
    // write the file, archive every TSV into merged/ and print "+N added" —
    // so a tracker whose table header had been damaged (or a fresh file that
    // only ever got its `# Applications Tracker` line) swallowed a whole batch
    // of evaluations while reporting success. Nothing survived: the tracker is
    // gitignored and merge-tracker keeps no .bak.
    //
    // Abort before writing anything. Leaving the tracker and the additions dir
    // exactly as they were makes the run a no-op that replays cleanly once the
    // table is repaired.
    console.error(`❌ Aborting merge: ${basename(APPS_FILE)} has no table separator row ("|---|------|...").`);
    console.error(`   There is no insert point for ${newLines.length} new row(s), so NOTHING was written and no TSV was archived.`);
    console.error('   Repair the tracker table header, then re-run — the pending additions in');
    console.error(`   ${ADDITIONS_DIR} will merge then. Expected header:`);
    const { header, separator } = buildHeaderRows();
    console.error(`     ${header}`);
    console.error(`     ${separator}`);
    for (const line of newLines) console.error(`   not merged: ${line}`);
    trackerLock.release();
    process.exit(1);
  }
  appLines.splice(insertIdx, 0, ...newLines);
}

// Write back
if (!DRY_RUN) {
  writeFileAtomic(APPS_FILE, appLines.join('\n'));

  // Move processed files to merged/ — but only the ones actually applied.
  // Archiving a TSV whose row never reached the tracker is what turns a bug
  // into permanent data loss, since applications.md is gitignored and no backup
  // is written.
  if (!existsSync(MERGED_DIR)) mkdirSync(MERGED_DIR, { recursive: true });
  const archivable = tsvFiles.filter(f => !failedAdditions.includes(f));
  for (const file of archivable) {
    renameSync(join(ADDITIONS_DIR, file), join(MERGED_DIR, file));
  }
  console.log(`\n✅ Moved ${archivable.length} TSVs to merged/`);
}

console.log(`\n📊 Summary: +${added} added, 🔄${updated} updated, ⏭️${skipped} skipped${failedAdditions.length ? `, ❌${failedAdditions.length} NOT merged` : ''}`);
if (DRY_RUN) console.log('(dry-run — no changes written)');
trackerLock.release();

// Sync PDF flags (idempotent; uses its own lock/transaction)
if (!DRY_RUN) {
  try {
    execFileSync('node', [join(CAREER_OPS, 'sync-pdf-flags.mjs')], { stdio: 'inherit' });
  } catch (e) {
    console.warn(`⚠️  Failed to sync PDF flags: ${e.message}`);
  }
}

// Optional verify
if (VERIFY && !DRY_RUN) {
  console.log('\n--- Running verification ---');
  try {
    execFileSync('node', [join(CAREER_OPS, 'verify-pipeline.mjs')], { stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
}

// Any addition that could not be applied fails the run. The TSVs stay in the
// additions dir, so re-running after the tracker is repaired merges them once.
if (failedAdditions.length > 0) {
  console.error(
    `\n❌ ${failedAdditions.length} addition(s) were NOT merged and were left in ${ADDITIONS_DIR}: ` +
    failedAdditions.join(', '),
  );
  process.exit(1);
}
