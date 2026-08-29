#!/usr/bin/env node
/**
 * tracker-sync-check.mjs — applications.md <-> active-interviews.md status
 * sync checker for career-ops
 *
 * The project's own rule ("any interview status change must touch both
 * data/applications.md and data/active-interviews.md") is enforced only by
 * memory/discipline today. This script cross-checks the two files for status
 * drift: a row gets scheduled/rescheduled/rejected and only one of the two
 * files is updated.
 *
 * Matching (see matchInterviewRow):
 *   1. Hard match — a `#N in tracker` reference in the active-interviews.md
 *      Notes column, looked up directly against applications.md's row number.
 *   2. Fallback fuzzy match — Company + Role text, using invite-match.mjs's
 *      normalizeCompanyName/companySimilarity (imported directly, not
 *      copied) plus role-matcher.mjs's roleFuzzyMatch (already shared with
 *      detect-reposts.mjs/dedup-tracker.mjs).
 *   Rows that can't be confidently paired land in their own "unmatched"
 *   bucket rather than being silently guessed.
 *
 * Resolution (see compareLifecycle):
 *   Tier 1 (auto-resolve) — templates/states.yml's 8 canonical states have a
 *   one-way lifecycle order: Evaluated -> Applied -> Responded -> Interview
 *   -> {Offer | Rejected | Discarded | SKIP} (the last four are terminal, no
 *   further order among them, but any of them supersedes an earlier stage).
 *   If the two files disagree and one side is strictly later-stage, that's
 *   not ambiguous — the earlier-stage file is stale. Reported as
 *   `resolution: "auto-tier1"` with the correct `suggestedStatus`.
 *
 *   Tier 2 (needs human review) — two different terminal statuses, or an
 *   unrecognized status, has no clear order. `git blame -L {line},{line}
 *   --porcelain {file}` supplies a last-modified timestamp for the relevant
 *   line in each file so a human can eyeball which is current. Reported as
 *   `resolution: "needs-review-tier2"` with both statuses and timestamps.
 *   The script does NOT write in this tier — reporting only.
 *
 * SCOPE (intentional, first version): read-only / reporting only. Tier 1 is
 * described as "auto-propagate" in the originating issue, but this script
 * does not write to applications.md — it reports the mismatch and the
 * suggested fix. Auto-write is a reasonable fast-follow once the reporting
 * mode has been used and trusted; unattended status writes on a script's very
 * first run is unnecessary risk (career-ops's `merge-tracker.mjs` gate on
 * tracker additions follows the same caution).
 *
 * Run: node tracker-sync-check.mjs              (JSON to stdout)
 *      node tracker-sync-check.mjs --summary    (human-readable table)
 *      node tracker-sync-check.mjs --apps-file path/to/applications.md
 *      node tracker-sync-check.mjs --interviews-file path/to/active-interviews.md
 *      node tracker-sync-check.mjs --self-test
 *
 * Issue #1504 — github.com/santifer/career-ops
 */

import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';

import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { normalizeCompanyName, companySimilarity } from './invite-match.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
const DEFAULT_APPS_FILE = existsSync(join(DATA_ROOT, 'data/applications.md'))
  ? join(DATA_ROOT, 'data/applications.md')
  : join(DATA_ROOT, 'applications.md');
const DEFAULT_INTERVIEWS_FILE = existsSync(join(DATA_ROOT, 'data/active-interviews.md'))
  ? join(DATA_ROOT, 'data/active-interviews.md')
  : join(DATA_ROOT, 'active-interviews.md');

// --- CLI args ---
const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const appsFileIdx = args.indexOf('--apps-file');
const APPS_FILE = appsFileIdx !== -1 && args[appsFileIdx + 1] !== undefined
  ? args[appsFileIdx + 1]
  : DEFAULT_APPS_FILE;
const interviewsFileIdx = args.indexOf('--interviews-file');
const INTERVIEWS_FILE = interviewsFileIdx !== -1 && args[interviewsFileIdx + 1] !== undefined
  ? args[interviewsFileIdx + 1]
  : DEFAULT_INTERVIEWS_FILE;

// --- Canonical lifecycle (templates/states.yml) ---
// Non-terminal states are strictly ordered; terminal states have no order
// among each other but supersede any non-terminal (earlier) state.
//
// Loaded from templates/states.yml at evaluation time (rather than hardcoded
// here) so a template change — a new state, a reordered/renamed one — can't
// silently desync from what this checker classifies. CodeRabbit flagged this
// on PR #1505: the old hardcoded copy predated states.yml's "hired" state and
// would have classified it as unrecognized (falling into Tier 2 "ambiguous"
// against every other status) instead of correctly ranking it as terminal.
//
// states.yml has no explicit ordering field, so LIFECYCLE_ORDER is taken from
// the file's own array order among states NOT marked `terminal: true`; the
// terminal set and the id -> display-label map are read directly off each
// state's `terminal` and `label` fields. See the comment above `states:` in
// templates/states.yml for the contract.
const STATES_FILE = join(CAREER_OPS, 'templates/states.yml');

/**
 * Load the canonical lifecycle order, terminal-status set, and id -> label
 * map from templates/states.yml.
 * @param {string} statesPath - Path to templates/states.yml.
 * @returns {{ order: string[], terminal: Set<string>, labels: Record<string,string> }}
 */
export function loadLifecycle(statesPath) {
  const doc = yaml.load(readFileSync(statesPath, 'utf-8'));
  if (!doc || !Array.isArray(doc.states)) {
    throw new Error(`Malformed states file at ${statesPath}: expected a top-level "states" list`);
  }
  const order = [];
  const terminal = new Set();
  const labels = {};
  for (const s of doc.states) {
    const id = String(s?.id ?? '').trim();
    if (!id) continue;
    labels[id] = String(s.label ?? id);
    if (s.terminal) terminal.add(id);
    else order.push(id);
  }
  return { order, terminal, labels };
}

const { order: LIFECYCLE_ORDER, terminal: TERMINAL_STATUSES, labels: CANONICAL_LABELS } = loadLifecycle(STATES_FILE);

// Mirrors the ALIASES map in analyze-patterns.mjs / verify-pipeline.mjs —
// applications.md status cell normalization (bold markers, trailing dates,
// Spanish aliases from the shipped default modes).
const STATUS_ALIASES = {
  'evaluada': 'evaluated', 'condicional': 'evaluated', 'hold': 'evaluated',
  'evaluar': 'evaluated', 'verificar': 'evaluated',
  'aplicado': 'applied', 'enviada': 'applied', 'aplicada': 'applied',
  'applied': 'applied', 'sent': 'applied',
  'respondido': 'responded',
  'entrevista': 'interview',
  'oferta': 'offer',
  'rechazado': 'rejected', 'rechazada': 'rejected',
  'descartado': 'discarded', 'descartada': 'discarded',
  'cerrada': 'discarded', 'cancelada': 'discarded',
  'no aplicar': 'skip', 'no_aplicar': 'skip', 'monitor': 'skip', 'geo blocker': 'skip',
};

/**
 * Normalize an applications.md status cell to one of the 8 canonical ids.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeStatus(raw) {
  const clean = String(raw ?? '').replace(/\*\*/g, '').trim().toLowerCase()
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  return STATUS_ALIASES[clean] || clean;
}

// active-interviews.md's Status column tracks a per-round state (Scheduled,
// Confirmed, Completed, Rejected, ...), not one of the 8 canonical tracker
// states directly. Only the terminal outcomes below carry unambiguous
// tracker-status meaning; anything else (Scheduled/Confirmed/Completed/
// Pending/unrecognized) means the row is simply present in the live
// interview log, which implies "at least Interview stage" — the row
// wouldn't exist otherwise.
const INTERVIEW_ROUND_STATUS_MAP = {
  rejected: 'rejected',
  declined: 'discarded',
  withdrawn: 'discarded',
  cancelled: 'discarded',
  canceled: 'discarded',
  ghosted: 'discarded',
  offer: 'offer',
  offered: 'offer',
};

/**
 * Normalize an active-interviews.md Status cell to one of the 8 canonical
 * ids, defaulting to "interview" (presence in the live interview log implies
 * at least that stage) when the cell isn't a recognized terminal outcome.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeInterviewStatus(raw) {
  const clean = String(raw ?? '').replace(/\*\*/g, '').trim().toLowerCase();
  return INTERVIEW_ROUND_STATUS_MAP[clean] || 'interview';
}

/**
 * Compare two canonical statuses against the one-way lifecycle order.
 * Returns `{ comparable, cmp }`:
 *   - comparable=false when neither status is recognized as strictly later
 *     (two different terminal statuses, or an unrecognized status) — Tier 2.
 *   - comparable=true, cmp=0 when equal (no mismatch).
 *   - comparable=true, cmp=1 when `a` is later-stage than `b`.
 *   - comparable=true, cmp=-1 when `b` is later-stage than `a`.
 * @param {string} a - Already-normalized canonical status.
 * @param {string} b - Already-normalized canonical status.
 */
export function compareLifecycle(a, b) {
  if (a === b) return { comparable: true, cmp: 0 };

  const aTerm = TERMINAL_STATUSES.has(a);
  const bTerm = TERMINAL_STATUSES.has(b);

  if (aTerm && bTerm) return { comparable: false, cmp: 0 }; // two different terminal outcomes — ambiguous
  if (aTerm && !bTerm) return { comparable: true, cmp: 1 };
  if (bTerm && !aTerm) return { comparable: true, cmp: -1 };

  const ai = LIFECYCLE_ORDER.indexOf(a);
  const bi = LIFECYCLE_ORDER.indexOf(b);
  if (ai === -1 || bi === -1) return { comparable: false, cmp: 0 }; // unrecognized status — ambiguous

  if (ai === bi) return { comparable: true, cmp: 0 };
  return { comparable: true, cmp: ai > bi ? 1 : -1 };
}

// --- Company/role fuzzy matching ---
// normalizeCompanyName and companySimilarity are imported directly from
// invite-match.mjs (issue #1495 / PR #1497), which is now on main — see the
// import at the top of this file.

// A candidate needs at least this much company-name overlap (post
// normalization) to be considered a confident fuzzy match, on top of
// role-matcher.mjs's roleFuzzyMatch agreeing on the role text.
const FUZZY_COMPANY_THRESHOLD = 0.5;

// --- Notes-column tracker reference ---
const TRACKER_REF_RE = /#\s*(\d+)\s+in\s+tracker/i;

/**
 * Extract a `#N in tracker` reference from an active-interviews.md Notes
 * cell, if present.
 * @param {string} notes
 * @returns {number|null}
 */
export function extractTrackerRef(notes) {
  const m = String(notes ?? '').match(TRACKER_REF_RE);
  return m ? parseInt(m[1], 10) : null;
}

// --- applications.md loader (line-number aware, for git blame) ---
function loadTrackerWithLines(appsFile) {
  if (!existsSync(appsFile)) return [];
  const content = readFileSync(appsFile, 'utf-8');
  const lines = content.split('\n');
  const colmap = resolveColumns(lines);
  const entries = [];
  lines.forEach((line, i) => {
    const row = parseTrackerRow(line, colmap);
    if (row) entries.push({ ...row, lineNum: i + 1 }); // 1-based, for git blame -L
  });
  return entries;
}

// --- active-interviews.md loader (line-number aware, for git blame) ---
//
// Mirrors the table-scan in process-quality.mjs's parseActiveInterviews
// (only the first contiguous pipe-table block is parsed; malformed rows are
// dropped). Kept local — rather than calling that function and trying to
// re-derive line numbers afterward — because this checker needs the
// original line number of each row for `git blame -L`, which
// parseActiveInterviews does not expose. Any change to the table-detection
// algorithm there should be mirrored here.
export function parseActiveInterviewsWithLines(content) {
  if (typeof content !== 'string' || !content.trim()) return [];

  const lines = content.split('\n');
  const isTableLine = line => /^\s*\|.*\|\s*$/.test(line);

  const startIdx = lines.findIndex(isTableLine);
  if (startIdx === -1) return [];

  const tableLineIdxs = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (!isTableLine(lines[i])) break;
    tableLineIdxs.push(i);
  }
  if (tableLineIdxs.length < 2) return [];

  const splitRow = line =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const isSeparatorRow = cells => cells.every(cell => /^:?-+:?$/.test(cell));

  const header = splitRow(lines[tableLineIdxs[0]]);
  const colCount = header.length;
  if (colCount === 0) return [];

  const rows = [];
  for (const idx of tableLineIdxs.slice(1)) {
    const cells = splitRow(lines[idx]);
    if (isSeparatorRow(cells)) continue;
    if (cells.length !== colCount) continue;

    const row = {};
    header.forEach((col, i) => { row[col] = cells[i]; });
    rows.push({ row, lineNum: idx + 1 }); // 1-based, for git blame -L
  }
  return rows;
}

function loadActiveInterviewsWithLines(interviewsFile) {
  if (!existsSync(interviewsFile)) return [];
  return parseActiveInterviewsWithLines(readFileSync(interviewsFile, 'utf-8'));
}

// Case-insensitive column lookup — same rationale as process-quality.mjs's
// findColumn: header wording ("Notes" vs "notes") is candidate-editable.
function findColumn(row, name) {
  const key = Object.keys(row || {}).find(k => k.trim().toLowerCase() === name);
  return key ? String(row[key] ?? '') : '';
}

// --- git blame timestamp (Tier 2 tiebreak) ---
/**
 * Last-modified timestamp (ISO 8601) for one line of a tracked file, via
 * `git blame -L {line},{line} --porcelain`. Returns null on any failure
 * (not a git repo, uncommitted file, line out of range, git not installed)
 * rather than throwing — a missing timestamp just means Tier 2 output shows
 * one side blank, not a crash.
 * @param {string} filePath - Absolute or cwd-relative path.
 * @param {number} lineNum - 1-based line number.
 * @param {string} [cwd] - Working directory for the git invocation.
 * @returns {string|null}
 */
export function gitBlameTimestamp(filePath, lineNum, cwd = CAREER_OPS) {
  if (!Number.isInteger(lineNum) || lineNum < 1) return null;
  try {
    const out = execFileSync(
      'git',
      ['blame', '-L', `${lineNum},${lineNum}`, '--porcelain', filePath],
      { cwd, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const m = out.match(/^committer-time (\d+)/m);
    if (!m) return null;
    return new Date(parseInt(m[1], 10) * 1000).toISOString();
  } catch {
    return null;
  }
}

// --- Row matching ---
/**
 * Match one active-interviews.md row against applications.md entries.
 *
 * Tries the `#N in tracker` Notes reference first (hard match). Falls back
 * to fuzzy Company+Role matching when absent: a candidate is a confident
 * fuzzy match only when company-name overlap clears FUZZY_COMPANY_THRESHOLD
 * AND role-matcher.mjs's roleFuzzyMatch agrees, and exactly one such
 * candidate exists. Any ambiguity — a duplicate tracker number, or more than
 * one fuzzy candidate regardless of whether their scores tie — is treated as
 * no match, not a guess (CodeRabbit review on PR #1505: silently taking
 * `.find()`'s first result, or only bailing on a score tie, can pair an
 * interview row with the wrong application).
 *
 * @param {object} interviewRow - Plain row object (Company/Role/Notes cells).
 * @param {Array<object>} trackerEntries - From loadTrackerWithLines().
 * @returns {{ entry: object|null, method: 'tracker-ref'|'fuzzy'|'unmatched', confidence: number, note?: string }}
 */
export function matchInterviewRow(interviewRow, trackerEntries) {
  const notes = findColumn(interviewRow, 'notes');
  const trackerRef = extractTrackerRef(notes);

  if (trackerRef != null) {
    const entries = trackerEntries.filter(e => e.num === trackerRef);
    if (entries.length === 1) return { entry: entries[0], method: 'tracker-ref', confidence: 1 };
    return {
      entry: null,
      method: 'unmatched',
      confidence: 0,
      note: entries.length === 0
        ? `Notes references #${trackerRef} in tracker, but no such row exists in applications.md`
        : `Notes references #${trackerRef} in tracker, but ${entries.length} rows use that number`,
    };
  }

  const company = findColumn(interviewRow, 'company');
  const role = findColumn(interviewRow, 'role');
  const normCompany = normalizeCompanyName(company);

  const candidates = trackerEntries
    .map(entry => ({ entry, sim: companySimilarity(normCompany, normalizeCompanyName(entry.company)) }))
    .filter(({ sim }) => sim >= FUZZY_COMPANY_THRESHOLD)
    .filter(({ entry }) => roleFuzzyMatch(role, entry.role))
    .sort((a, b) => b.sim - a.sim);

  if (candidates.length === 0) {
    return { entry: null, method: 'unmatched', confidence: 0, note: 'No tracker reference in Notes and no confident Company+Role fuzzy match' };
  }
  if (candidates.length > 1) {
    return { entry: null, method: 'unmatched', confidence: candidates[0].sim, note: `Ambiguous fuzzy match — ${candidates.length} tracker rows scored for "${company}"` };
  }

  return { entry: candidates[0].entry, method: 'fuzzy', confidence: Math.round(candidates[0].sim * 1000) / 1000 };
}

// --- Sync report ---
/**
 * Cross-check applications.md entries against active-interviews.md rows and
 * build the mismatch report. Pure function — no file I/O — so tests can
 * drive it directly against fixture data and an injected blame function.
 *
 * @param {Array<object>} trackerEntries - From loadTrackerWithLines() (each with `lineNum`).
 * @param {Array<{row: object, lineNum: number}>} interviewRows - From loadActiveInterviewsWithLines().
 * @param {object} [opts]
 * @param {(filePath: string, lineNum: number) => string|null} [opts.blameFn] - Injectable for tests.
 * @param {string} [opts.appsFilePath] - Path recorded on Tier 2 entries (display only).
 * @param {string} [opts.interviewsFilePath] - Path recorded on Tier 2 entries (display only).
 * @returns {{ mismatches: Array<object>, summary: object }}
 */
export function buildSyncReport(trackerEntries, interviewRows, opts = {}) {
  const blameFn = opts.blameFn || ((filePath, lineNum) => gitBlameTimestamp(filePath, lineNum));
  const appsFilePath = opts.appsFilePath || APPS_FILE;
  const interviewsFilePath = opts.interviewsFilePath || INTERVIEWS_FILE;

  const results = [];
  for (const { row, lineNum } of interviewRows) {
    const company = findColumn(row, 'company');
    const role = findColumn(row, 'role');
    const rawStatus = findColumn(row, 'status');
    const activeInterviewsStatus = normalizeInterviewStatus(rawStatus);

    const { entry, method, confidence, note } = matchInterviewRow(row, trackerEntries);

    if (!entry) {
      results.push({
        trackerNum: null,
        company,
        role,
        applicationsStatus: null,
        activeInterviewsStatus: rawStatus,
        resolution: 'unmatched',
        matchMethod: method,
        matchConfidence: confidence,
        note,
      });
      continue;
    }

    const applicationsStatus = normalizeStatus(entry.status);
    const { comparable, cmp } = compareLifecycle(applicationsStatus, activeInterviewsStatus);

    if (comparable && cmp === 0) {
      results.push({
        trackerNum: entry.num,
        company,
        role,
        applicationsStatus: entry.status,
        activeInterviewsStatus: rawStatus,
        resolution: 'matched-no-mismatch',
        matchMethod: method,
        matchConfidence: confidence,
      });
      continue;
    }

    if (comparable) {
      // cmp>0 means applications.md (a) is later-stage, so active-interviews.md
      // is the stale file; cmp<0 means the reverse. suggestedStatus is always
      // the canonical LABEL of whichever side is later — never the raw
      // active-interviews.md round-status text — since it's meant to be
      // written into applications.md's Status column.
      const laterCanonical = cmp > 0 ? applicationsStatus : activeInterviewsStatus;
      const suggestedStatus = CANONICAL_LABELS[laterCanonical] || laterCanonical;
      const staleIn = cmp > 0 ? 'active-interviews.md' : 'applications.md';
      results.push({
        trackerNum: entry.num,
        company,
        role,
        applicationsStatus: entry.status,
        activeInterviewsStatus: rawStatus,
        resolution: 'auto-tier1',
        suggestedStatus,
        staleIn,
        matchMethod: method,
        matchConfidence: confidence,
      });
      continue;
    }

    // Tier 2 — genuinely ambiguous. Blame both lines for a human tiebreak.
    const applicationsLastModified = blameFn(appsFilePath, entry.lineNum);
    const activeInterviewsLastModified = blameFn(interviewsFilePath, lineNum);
    results.push({
      trackerNum: entry.num,
      company,
      role,
      applicationsStatus: entry.status,
      activeInterviewsStatus: rawStatus,
      resolution: 'needs-review-tier2',
      applicationsLastModified,
      activeInterviewsLastModified,
      matchMethod: method,
      matchConfidence: confidence,
    });
  }

  const summary = {
    total: results.length,
    tier1: results.filter(r => r.resolution === 'auto-tier1').length,
    tier2: results.filter(r => r.resolution === 'needs-review-tier2').length,
    matchedNoMismatch: results.filter(r => r.resolution === 'matched-no-mismatch').length,
    unmatched: results.filter(r => r.resolution === 'unmatched').length,
  };

  return { mismatches: results, summary };
}

/**
 * End-to-end: load both files from disk and build the sync report. This is
 * the function verify-pipeline.mjs imports rather than shelling out, so the
 * matching/resolution logic lives in exactly one place.
 * @param {object} [opts]
 * @param {string} [opts.appsFile]
 * @param {string} [opts.interviewsFile]
 * @returns {{ mismatches: Array<object>, summary: object }}
 */
export function checkTrackerSync(opts = {}) {
  const appsFile = opts.appsFile || APPS_FILE;
  const interviewsFile = opts.interviewsFile || INTERVIEWS_FILE;
  const trackerEntries = loadTrackerWithLines(appsFile);
  const interviewRows = loadActiveInterviewsWithLines(interviewsFile);
  return buildSyncReport(trackerEntries, interviewRows, { appsFilePath: appsFile, interviewsFilePath: interviewsFile });
}

// --- Summary mode ---
function printSummary(result) {
  console.log(`\n${'='.repeat(90)}`);
  console.log('  Tracker Sync Check — career-ops');
  console.log(`  applications.md <-> active-interviews.md | rows checked: ${result.summary.total}`);
  console.log(`${'='.repeat(90)}\n`);

  if (result.mismatches.length === 0) {
    console.log('  No active-interviews.md rows found (or nothing to compare).\n');
    return;
  }

  const header =
    '  ' +
    'Company'.padEnd(20) +
    'Role'.padEnd(28) +
    'Apps'.padEnd(12) +
    'Interviews'.padEnd(12) +
    'Resolution';
  console.log(header);
  console.log('  ' + '-'.repeat(100));

  for (const m of result.mismatches) {
    const company = (m.company || '').substring(0, 18).padEnd(20);
    const role = (m.role || '').substring(0, 26).padEnd(28);
    const apps = (m.applicationsStatus || '—').substring(0, 10).padEnd(12);
    const interviews = (m.activeInterviewsStatus || '—').substring(0, 10).padEnd(12);
    let resolution = m.resolution;
    if (m.resolution === 'auto-tier1') resolution += ` (suggest: ${m.suggestedStatus}, stale in ${m.staleIn})`;
    if (m.resolution === 'needs-review-tier2') resolution += ` (apps@${m.applicationsLastModified || 'n/a'} vs interviews@${m.activeInterviewsLastModified || 'n/a'})`;
    if (m.resolution === 'unmatched') resolution += ` (${m.note})`;
    console.log('  ' + company + role + apps + interviews + resolution);
  }

  console.log(`\n  Tier 1 (auto-resolvable): ${result.summary.tier1}`);
  console.log(`  Tier 2 (needs review):    ${result.summary.tier2}`);
  console.log(`  Matched, no mismatch:     ${result.summary.matchedNoMismatch}`);
  console.log(`  Unmatched:                ${result.summary.unmatched}`);
  console.log('\n  Read-only report — no files were modified. Fix Tier 1 rows by hand for now.\n');
}

// --- Self-test ---
function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  // --- normalizeStatus / normalizeInterviewStatus ---
  check(normalizeStatus('**Applied**') === 'applied', 'normalizeStatus strips bold markers');
  check(normalizeStatus('Rejected 2026-06-01') === 'rejected', 'normalizeStatus strips trailing date');
  check(normalizeStatus('entrevista') === 'interview', 'normalizeStatus maps Spanish alias');
  check(normalizeInterviewStatus('Scheduled') === 'interview', 'unrecognized round status defaults to interview');
  check(normalizeInterviewStatus('Rejected') === 'rejected', 'terminal round status maps through');
  check(normalizeInterviewStatus('Withdrawn') === 'discarded', 'withdrawn maps to discarded');

  // --- compareLifecycle ---
  check(compareLifecycle('applied', 'applied').cmp === 0, 'equal statuses: no mismatch');
  check(compareLifecycle('applied', 'interview').comparable && compareLifecycle('applied', 'interview').cmp === -1, 'applied < interview (b later)');
  check(compareLifecycle('interview', 'applied').comparable && compareLifecycle('interview', 'applied').cmp === 1, 'interview > applied (a later)');
  check(compareLifecycle('interview', 'rejected').comparable && compareLifecycle('interview', 'rejected').cmp === -1, 'terminal supersedes non-terminal');
  check(!compareLifecycle('rejected', 'discarded').comparable, 'two different terminal statuses are not comparable (tier 2)');
  check(!compareLifecycle('applied', 'bogus-status').comparable, 'unrecognized status is not comparable (tier 2)');

  // --- loadLifecycle (states.yml-derived, CodeRabbit review on PR #1505) ---
  check(LIFECYCLE_ORDER.includes('evaluated') && LIFECYCLE_ORDER.includes('interview'), 'LIFECYCLE_ORDER loaded from states.yml includes the non-terminal stages');
  check(TERMINAL_STATUSES.has('offer') && TERMINAL_STATUSES.has('rejected') && TERMINAL_STATUSES.has('discarded') && TERMINAL_STATUSES.has('skip'), 'TERMINAL_STATUSES loaded from states.yml includes the original 4 terminal states');
  check(TERMINAL_STATUSES.has('hired'), 'TERMINAL_STATUSES loaded from states.yml also picks up "hired" (would have been unrecognized under the old hardcoded copy)');
  check(!TERMINAL_STATUSES.has('applied'), 'TERMINAL_STATUSES loaded from states.yml does not misclassify a non-terminal state');
  check(CANONICAL_LABELS.evaluated === 'Evaluated' && CANONICAL_LABELS.skip === 'SKIP' && CANONICAL_LABELS.hired === 'Hired', 'CANONICAL_LABELS loaded from states.yml matches expected display labels');
  check(compareLifecycle('interview', 'hired').comparable && compareLifecycle('interview', 'hired').cmp === -1, 'hired (states.yml-derived terminal) supersedes a non-terminal stage');
  check(!compareLifecycle('hired', 'rejected').comparable, 'hired vs. a different terminal status is ambiguous (tier 2), same as the pre-existing terminal states');

  // --- normalizeCompanyName / companySimilarity (imported from invite-match.mjs) ---
  check(normalizeCompanyName('Acme Corp.') === 'acme', 'strips "Corp." suffix');
  check(normalizeCompanyName('Acme Technologies Inc.') === 'acme', 'strips chained suffixes');
  check(companySimilarity('acme', 'acme') === 1, 'identical strings score 1');
  check(companySimilarity('acme', 'globex') === 0, 'unrelated names score 0');

  // Non-ASCII company names: the old hand-copied local implementation used a
  // Latin-only character class ([^a-z0-9 ]) that stripped every non-Latin
  // character, collapsing names like "Яндекс" or "アクメ株式会社" to an empty
  // string and sending matchInterviewRow() straight to unmatched. The real
  // invite-match.mjs implementation uses \p{L}\p{M}\p{N} (any script) instead,
  // so the normalized key survives and a same-company match succeeds.
  check(normalizeCompanyName('Яндекс') === 'яндекс', 'non-ASCII (Cyrillic) company name survives normalization instead of collapsing to empty');
  check(companySimilarity(normalizeCompanyName('Яндекс'), normalizeCompanyName('Яндекс')) === 1, 'identical non-ASCII company names still score a perfect match');
  const nonAsciiEntries = [
    { num: 401, company: 'Яндекс', role: 'Product Manager', status: 'Applied', lineNum: 1 },
  ];
  const nonAsciiResult = matchInterviewRow(
    { Company: 'Яндекс', Role: 'Product Manager', Notes: '' },
    nonAsciiEntries
  );
  check(nonAsciiResult.entry !== null && nonAsciiResult.entry.num === 401, 'non-ASCII company name matches via matchInterviewRow instead of falling to unmatched (regression for the hand-copied Latin-only normalizer)');

  // --- extractTrackerRef ---
  check(extractTrackerRef('Confirmed for Tuesday. #42 in tracker.') === 42, 'extracts "#N in tracker" reference');
  check(extractTrackerRef('No reference here') === null, 'returns null when no reference present');

  // --- matchInterviewRow ambiguity handling (CodeRabbit review on PR #1505) ---
  // Duplicate tracker numbers: a `#N in tracker` Notes reference must not
  // silently resolve to trackerEntries.find()'s first hit when two rows
  // share the same number (a real applications.md corruption case) — the
  // match should bail to unmatched instead of guessing which row is right.
  const dupNumEntries = [
    { num: 201, company: 'Acme Corp', role: 'Backend Engineer', status: 'Applied', lineNum: 1 },
    { num: 201, company: 'Acme Holdings', role: 'Backend Engineer II', status: 'Applied', lineNum: 2 },
  ];
  const dupNumResult = matchInterviewRow(
    { Company: 'Acme Corp', Role: 'Backend Engineer', Notes: '#201 in tracker' },
    dupNumEntries
  );
  check(dupNumResult.entry === null, 'duplicate tracker numbers: matchInterviewRow does not guess (entry is null)');
  check(dupNumResult.method === 'unmatched', 'duplicate tracker numbers: matchInterviewRow reports unmatched, not the first find() hit');
  check(/2 rows use that number/.test(dupNumResult.note || ''), 'duplicate tracker numbers: note explains the ambiguity');

  // Multiple non-tied fuzzy candidates: two tracker rows both clear
  // FUZZY_COMPANY_THRESHOLD and roleFuzzyMatch for the same interview row,
  // but with different (non-tied) similarity scores. Bailing only on an
  // exact score tie would let the higher-scoring one win by default; the
  // fix requires exactly one candidate, full stop.
  const nonTiedEntries = [
    { num: 301, company: 'Acme Partners', role: 'Program Manager', status: 'Applied', lineNum: 1 },
    { num: 302, company: 'Acme Partners Group Studio', role: 'Program Manager', status: 'Applied', lineNum: 2 },
  ];
  const simA = companySimilarity(normalizeCompanyName('Acme Partners'), normalizeCompanyName('Acme Partners'));
  const simB = companySimilarity(normalizeCompanyName('Acme Partners'), normalizeCompanyName('Acme Partners Group Studio'));
  check(simA !== simB, 'fuzzy fixture sanity check: the two candidate scores are not tied');
  const nonTiedResult = matchInterviewRow(
    { Company: 'Acme Partners', Role: 'Program Manager', Notes: '' },
    nonTiedEntries
  );
  check(nonTiedResult.entry === null, 'multiple non-tied fuzzy candidates: matchInterviewRow does not pick the higher-scoring one');
  check(nonTiedResult.method === 'unmatched', 'multiple non-tied fuzzy candidates: matchInterviewRow reports unmatched, not fuzzy');
  check(/Ambiguous fuzzy match/.test(nonTiedResult.note || ''), 'multiple non-tied fuzzy candidates: note flags the ambiguity');

  // --- parseActiveInterviewsWithLines (line-number tracking) ---
  const md = [
    '# Active Interviews',
    '',
    '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |',
    '|---------|------|-------|-----------|-------------|--------|-------|',
    '| Acme Corp | Backend Engineer | Prescreen | 2026-06-01 | Jane | Scheduled | #101 in tracker |',
  ].join('\n');
  const parsedWithLines = parseActiveInterviewsWithLines(md);
  check(parsedWithLines.length === 1, 'parses one data row from a small fixture table');
  check(parsedWithLines[0]?.lineNum === 5, 'reports the correct 1-based source line number for the data row');

  // --- End-to-end fixtures: buildSyncReport ---
  // Fixture tracker entries (mirrors applications.md's parsed row shape).
  const trackerEntries = [
    { num: 101, date: '2026-06-01', company: 'Acme Corp', role: 'Backend Engineer', score: '4.2/5', status: 'Applied', pdf: '✅', report: '[101](reports/101-acme-2026-06-01.md)', notes: '', lineNum: 10 },
    { num: 102, date: '2026-05-01', company: 'Northwind Traders', role: 'Program Coordinator', score: '3.9/5', status: 'Discarded', pdf: '✅', report: '[102](reports/102-northwind-2026-05-01.md)', notes: '', lineNum: 11 },
    { num: 103, date: '2026-04-10', company: 'Fabrikam Health', role: 'HR Business Partner', score: '4.0/5', status: 'Applied', pdf: '✅', report: '[103](reports/103-fabrikam-2026-04-10.md)', notes: '', lineNum: 12 },
    { num: 104, date: '2026-03-15', company: 'Contoso Logistics', role: 'Training Specialist', score: '4.1/5', status: 'Interview', pdf: '✅', report: '[104](reports/104-contoso-2026-03-15.md)', notes: '', lineNum: 13 },
  ];

  // Row A — matched via #N in tracker reference; clean tier-1 auto-resolve:
  // applications.md still says "Applied" but the live interview log shows
  // the round was Rejected — active-interviews.md is later-stage, so
  // applications.md is the stale file.
  const rowA = { row: { Company: 'Acme Corp', Role: 'Backend Engineer', Round: 'Round 1', 'Date/Time': '2026-06-08', Interviewer: 'Panel', Status: 'Rejected', Notes: '#101 in tracker' }, lineNum: 20 };

  // Row B — tier-2 ambiguous: applications.md says Discarded, the interview
  // log's round status says Rejected — two different terminal outcomes with
  // no clear order between them.
  const rowB = { row: { Company: 'Northwind Traders', Role: 'Program Coordinator', Round: 'Final', 'Date/Time': '2026-05-20', Interviewer: 'HM', Status: 'Rejected', Notes: '#102 in tracker' }, lineNum: 21 };

  // Row C — matched via fuzzy Company+Role fallback (no tracker reference;
  // company spelled slightly differently ["Inc" suffix], role phrased
  // slightly differently but role-matcher.mjs's roleFuzzyMatch still agrees
  // on 2+ discriminating tokens — "(Hybrid)" tokenizes to a stopword, unlike
  // a real specialization suffix, so it doesn't split the titles apart).
  // Also doubles as a tier-1 case: the tracker still shows "Applied" but the
  // live interview log implies Interview stage.
  const rowC = { row: { Company: 'Fabrikam Health Inc', Role: 'HR Business Partner (Hybrid)', Round: 'Prescreen', 'Date/Time': '2026-04-12', Interviewer: 'Recruiter', Status: 'Scheduled', Notes: 'clean process' }, lineNum: 22 };

  // Row D — unmatched/low-confidence: no tracker reference, and the company
  // name doesn't resemble anything in the fixture tracker.
  const rowD = { row: { Company: 'Totally Unrelated Ventures', Role: 'Mystery Role', Round: 'Prescreen', 'Date/Time': '2026-07-01', Interviewer: 'Someone', Status: 'Scheduled', Notes: '' }, lineNum: 23 };

  // Row E — matched via #N reference, statuses agree (no mismatch): confirms
  // the "clean, nothing to report" path also works end-to-end.
  const rowE = { row: { Company: 'Contoso Logistics', Role: 'Training Specialist', Round: 'Round 2', 'Date/Time': '2026-03-20', Interviewer: 'Panel', Status: 'Scheduled', Notes: '#104 in tracker' }, lineNum: 24 };

  const fakeBlame = (filePath, lineNum) => `2026-0${lineNum % 9 || 1}-01T00:00:00.000Z`;
  const report = buildSyncReport(trackerEntries, [rowA, rowB, rowC, rowD, rowE], {
    blameFn: fakeBlame,
    appsFilePath: 'data/applications.md',
    interviewsFilePath: 'data/active-interviews.md',
  });

  check(report.mismatches.length === 5, 'buildSyncReport returns one entry per active-interviews.md row');

  const resA = report.mismatches.find(m => m.trackerNum === 101);
  check(!!resA, 'row A matched via #101 in tracker reference');
  check(resA?.matchMethod === 'tracker-ref', 'row A matched via tracker-ref method');
  check(resA?.resolution === 'auto-tier1', 'row A resolves as tier 1 (clean forward progression)');
  check(resA?.suggestedStatus === 'Rejected', 'row A suggests the later-stage status (Rejected)');
  check(resA?.staleIn === 'applications.md', 'row A flags applications.md as the stale file');

  const resB = report.mismatches.find(m => m.trackerNum === 102);
  check(!!resB, 'row B matched via #102 in tracker reference');
  check(resB?.resolution === 'needs-review-tier2', 'row B resolves as tier 2 (two different terminal statuses)');
  check(resB?.applicationsLastModified === fakeBlame('x', 11), 'row B carries the injected applications.md blame timestamp');
  check(resB?.activeInterviewsLastModified === fakeBlame('x', 21), 'row B carries the injected active-interviews.md blame timestamp');

  const resC = report.mismatches.find(m => m.trackerNum === 103);
  check(!!resC, 'row C matched via fuzzy Company+Role fallback');
  check(resC?.matchMethod === 'fuzzy', 'row C matched via fuzzy method, not tracker-ref');
  check(resC?.resolution === 'auto-tier1', 'row C resolves as tier 1 (tracker stuck on Applied, live log implies Interview)');
  check(resC?.suggestedStatus === 'Interview', 'row C suggests the later-stage canonical label (Interview)');
  check(resC?.staleIn === 'applications.md', 'row C flags applications.md as the stale file');

  const resD = report.mismatches.find(m => m.company === 'Totally Unrelated Ventures');
  check(!!resD, 'row D (unrelated company) present in results');
  check(resD?.resolution === 'unmatched', 'row D resolves as unmatched (no confident candidate)');
  check(resD?.trackerNum === null, 'row D has no tracker number (never guessed)');

  const resE = report.mismatches.find(m => m.trackerNum === 104);
  check(!!resE, 'row E matched via #104 in tracker reference');
  check(resE?.resolution === 'matched-no-mismatch', 'row E resolves as matched-no-mismatch (both sides agree on Interview stage)');

  check(report.summary.tier1 >= 1, 'summary counts at least one tier1 result');
  check(report.summary.tier2 === 1, 'summary counts exactly one tier2 result');
  check(report.summary.unmatched === 1, 'summary counts exactly one unmatched result');
  check(report.summary.matchedNoMismatch === 1, 'summary counts exactly one matched-no-mismatch result');
  check(report.summary.total === 5, 'summary total matches the number of active-interviews.md rows processed');

  // --- No active-interviews.md rows at all -> empty, no crash ---
  const emptyReport = buildSyncReport(trackerEntries, [], { blameFn: fakeBlame });
  check(emptyReport.mismatches.length === 0, 'empty interview-row input returns no mismatches');
  check(emptyReport.summary.total === 0, 'empty interview-row input reports total=0');

  console.log(`\n  tracker-sync-check self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (isMainModule(import.meta.url)) {
  if (selfTestMode) {
    runSelfTest();
  }

  const result = checkTrackerSync({ appsFile: APPS_FILE, interviewsFile: INTERVIEWS_FILE });

  if (summaryMode) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
