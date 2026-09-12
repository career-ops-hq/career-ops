#!/usr/bin/env node
import { validateFlags } from './lib/cli-flags.mjs';
/**
 * stats.mjs — Lifetime pipeline stats aggregator (zero-token). #1604
 *
 * One JSON contract for "how is my pipeline doing, lifetime": tracker roll-up,
 * cumulative funnel, lifetime scanner totals from scan-history.tsv, portal
 * coverage from portals.yml, and follow-up compliance. Reads durable data
 * files only — no LLM cost anywhere.
 *
 * Run: node stats.mjs             (JSON to stdout)
 *      node stats.mjs --summary   (human-readable table)
 *
 * Sections degrade to null when their source file is missing, and
 * `metadata.sources` says which files were found — a fresh clone with zero
 * user data emits the full contract shape with null sections.
 *
 * `runs` aggregates data/scan-runs.tsv (per-run counters written by scan.mjs,
 * #1604 PR-2) — null until the first non-dry scan creates the file.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { normalizeStatus, analyzeFromContent } from './followup-cadence.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
const APPS_FILE = resolveTrackerPath(DATA_ROOT);
const SCAN_HISTORY_FILE = join(DATA_ROOT, 'data', 'scan-history.tsv');
const FOLLOWUPS_FILE = join(DATA_ROOT, 'data', 'follow-ups.md');
const SCAN_RUNS_FILE = join(DATA_ROOT, 'data', 'scan-runs.tsv');
const STATUS_LOG_FILE = join(DATA_ROOT, 'data', 'status-log.tsv');
const PORTALS_FILE = join(DATA_ROOT, 'portals.yml');
const PORTAL_HEALTH_FILE = join(DATA_ROOT, 'data', 'portal-health.tsv');

const CANONICAL_STATUSES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Hired', 'Rejected', 'Discarded', 'SKIP'];

// In-flight applications. Deliberately NARROWER than the dashboard's
// ActiveApps (which also counts Evaluated): an evaluated-but-never-sent row is
// a candidate, not an application in flight. Hired is a terminal success, not
// in flight, so it is intentionally excluded here (but see PURSUED/funnel).
const ACTIVE_STATUSES = new Set(['Applied', 'Responded', 'Interview', 'Offer']);

// Rows that count toward avgScoreApplied — jobs the user actually pursued.
// Plain avgScore mixes in SKIP/Discarded and understates real fit. Hired is
// the fullest pursuit of all, so it belongs here.
const PURSUED_STATUSES = new Set(['Applied', 'Responded', 'Interview', 'Offer', 'Hired', 'Rejected']);

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (part, total) => (total > 0 ? round1((part / total) * 100) : 0);

/** Canonical display form ("aplicado" → "Applied", "skip" → "SKIP"); unknown → "Unknown" (counted, never dropped). */
function canonicalStatus(raw) {
  const norm = normalizeStatus(String(raw ?? ''));
  if (norm === 'skip') return 'SKIP';
  const cased = norm.charAt(0).toUpperCase() + norm.slice(1);
  return CANONICAL_STATUSES.includes(cased) ? cased : 'Unknown';
}

// ── Tracker roll-up ─────────────────────────────────────────────────

/**
 * Roll up applications.md: counts per canonical status, score stats, pdf and
 * report coverage, in-flight count. Header-aware via tracker-parse.mjs; CRLF
 * input is normalized first (Windows checkouts).
 *
 * @param {string} content - Raw applications.md text.
 */
export function computeTrackerStats(content) {
  const lines = String(content ?? '').replace(/\r/g, '').split('\n');
  const colmap = resolveColumns(lines);
  const byStatus = Object.fromEntries(CANONICAL_STATUSES.map((s) => [s, 0]));
  let total = 0, scoreSum = 0, scoreCount = 0, topScore = 0, withPdf = 0, withReport = 0, activeApps = 0;
  let pursuedSum = 0, pursuedCount = 0;
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    total++;
    const status = canonicalStatus(row.status);
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (ACTIVE_STATUSES.has(status)) activeApps++;
    const score = parseFloat(String(row.score || '').replace(/\*/g, ''));
    if (!Number.isNaN(score) && score > 0) {
      scoreSum += score;
      scoreCount++;
      if (score > topScore) topScore = score;
      if (PURSUED_STATUSES.has(status)) { pursuedSum += score; pursuedCount++; }
    }
    if ((row.pdf || '').includes('✅')) withPdf++;
    if (/\[.*\]\(.*\)/.test(row.report || '')) withReport++;
  }
  return {
    total,
    byStatus,
    avgScore: scoreCount > 0 ? round1(scoreSum / scoreCount) : null,
    avgScoreApplied: pursuedCount > 0 ? round1(pursuedSum / pursuedCount) : null,
    topScore: topScore > 0 ? topScore : null,
    pdfPct: pct(withPdf, total),
    reportPct: pct(withReport, total),
    activeApps,
  };
}

/** Map of tracker number → canonical status (for follow-up compliance). */
export function trackerStatusByNum(content) {
  const lines = String(content ?? '').replace(/\r/g, '').split('\n');
  const colmap = resolveColumns(lines);
  const byNum = new Map();
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) byNum.set(row.num, canonicalStatus(row.status));
  }
  return byNum;
}

/**
 * Tracker numbers that followup-cadence.mjs's own cadence math already
 * classifies 'cold' (Applied, zero response after applied_max_followups
 * follow-ups). Reuses `analyzeFromContent` — the same function
 * followup-cadence.mjs's CLI runs — instead of re-deriving the
 * applied_max_followups/cadence rule here (#2123). A row can only be
 * classified cold when its status is 'applied', so every number returned
 * here is already a subset of ACTIVE_STATUSES.
 *
 * Missing follow-ups content (`null`/absent file, the common case) degrades
 * gracefully: analyzeFromContent treats it as zero logged follow-ups for
 * every row, so nothing can cross the follow-up-count threshold and this
 * returns an empty set — never an error, never a guess.
 *
 * @param {string} trackerContent - Raw applications.md text.
 * @param {string|null} followupsContent - Raw follow-ups.md text, or null when absent.
 */
export function computeColdAppNums(trackerContent, followupsContent) {
  const result = analyzeFromContent(trackerContent, followupsContent || '');
  if (result.error) return new Set();
  return new Set(result.entries.filter((e) => e.urgency === 'cold').map((e) => e.num));
}

// ── Cumulative funnel ───────────────────────────────────────────────

/**
 * Cumulative funnel: everX = "reached stage X or beyond, ever". The math
 * mirrors the dashboard's ComputeProgressMetrics (career.go): Rejected counts
 * into everApplied (a rejection proves a submission), Hired counts into every
 * stage through everOffer (a landed job proves the offer and everything before
 * it), and each later stage sums itself plus everything beyond it. Rates are
 * relative to everApplied.
 *
 * Keys are deliberately NOT bare status names — `tracker.byStatus.Applied` is
 * "currently in Applied" while `everApplied` is "ever applied"; the same word
 * for two different numbers would read as a bug.
 *
 * Known limitation: statuses are snapshots, so a Rejected row that never got a
 * response is indistinguishable from one rejected after interviews — middle
 * stages are lower bounds until status-transition logging exists (#1428).
 *
 * This is the canonical funnel definition for career-ops going forward;
 * dashboard/web consuming this JSON instead of keeping independent copies is
 * a named follow-up in #1604.
 */
export function computeFunnel(byStatus) {
  const n = (k) => byStatus[k] || 0;
  const everApplied = n('Applied') + n('Responded') + n('Interview') + n('Offer') + n('Hired') + n('Rejected');
  const everResponded = n('Responded') + n('Interview') + n('Offer') + n('Hired');
  const everInterview = n('Interview') + n('Offer') + n('Hired');
  const everOffer = n('Offer') + n('Hired');
  return {
    everApplied,
    everResponded,
    everInterview,
    everOffer,
    responseRate: pct(everResponded, everApplied),
    interviewRate: pct(everInterview, everApplied),
    offerRate: pct(everOffer, everApplied),
    smallSample: everApplied < 10,
  };
}

// Canonical pipeline depth per stage, for "ever reached" math. Terminal and
// pre-pipeline states (Rejected/Discarded/Evaluated/SKIP/Unknown) are absent →
// depth 0; the ledger's from/to history is what proves the stages a row passed
// through before it landed on a terminal snapshot.
const STAGE_RANK = { Applied: 1, Responded: 2, Interview: 3, Offer: 4, Hired: 5 };

/**
 * Parse data/status-log.tsv into per-row transition observations. Columns are
 * {num}\t{date}\t{from}\t{to}\t{source}\t{note}; only num/from/to are read here.
 * Torn or non-numeric-num rows are skipped — this is a display aid, never throws.
 * @returns {Array<{num:number, from:string, to:string}>}
 */
export function parseStatusLogStages(content) {
  const out = [];
  for (const line of String(content ?? '').replace(/\r/g, '').split('\n')) {
    if (!line.trim()) continue;
    const c = line.split('\t');
    const rawNum = String(c[0] || '').trim();
    const date = String(c[1] || '').trim();
    const from = String(c[2] || '').trim();
    const to = String(c[3] || '').trim();
    if (!/^\d+$/.test(rawNum) || !date || !from || !to) continue;
    out.push({ num: Number(rawNum), from, to });
  }
  return out;
}

/**
 * Ledger-aware funnel: everX counts DISTINCT tracker rows that ever reached
 * stage X, folding the transition ledger so a row now sitting in a terminal
 * snapshot still counts for the stages it passed through — an Offer that was
 * declined (now Discarded) counts into everOffer; a Rejected that reached
 * Interview counts into everInterview. This resolves the snapshot limitation
 * computeFunnel() documents (#1428) for every row the ledger covers; a row with
 * no ledger history falls back to its current status alone, so pre-ledger middle
 * stages stay lower bounds. A current Rejected still proves everApplied (rank 1)
 * with no ledger, matching the snapshot math. Same shape as computeFunnel() plus
 * `basis:'ledger'`.
 *
 * @param {Map<number,string>} statusByNum - num → current canonical status.
 * @param {Array<{num:number,from:string,to:string}>} ledger - parseStatusLogStages output.
 */
export function computeFunnelWithHistory(statusByNum, ledger) {
  const reached = new Map(); // num → highest stage rank ever held (distinct rows)
  const bump = (num, rank) => { if (rank > (reached.get(num) || 0)) reached.set(num, rank); };
  for (const [num, status] of statusByNum) {
    bump(num, STAGE_RANK[status] || (status === 'Rejected' ? 1 : 0));
  }
  for (const { num, from, to } of ledger) {
    if (!statusByNum.has(num)) continue; // ledger row whose tracker row is gone
    bump(num, STAGE_RANK[from] || 0);
    bump(num, STAGE_RANK[to] || 0);
  }
  let everApplied = 0, everResponded = 0, everInterview = 0, everOffer = 0;
  for (const rank of reached.values()) {
    if (rank >= 1) everApplied++;
    if (rank >= 2) everResponded++;
    if (rank >= 3) everInterview++;
    if (rank >= 4) everOffer++;
  }
  return {
    everApplied,
    everResponded,
    everInterview,
    everOffer,
    responseRate: pct(everResponded, everApplied),
    interviewRate: pct(everInterview, everApplied),
    offerRate: pct(everOffer, everApplied),
    smallSample: everApplied < 10,
    basis: 'ledger',
  };
}

// ── Lifetime scanner totals ─────────────────────────────────────────

/** ISO week key ("2026-W27") for a YYYY-MM-DD string; null for bad input. Exported for the year-boundary tests. */
export function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday decides the ISO year
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Lifetime totals from scan-history.tsv. Malformed rows (no URL in column 0)
 * are skipped rather than crashing — a torn row from an interrupted append
 * must never poison the aggregate. Extra trailing columns (e.g. the
 * fingerprint column, #1597) are ignored.
 *
 * @param {string} content - Raw scan-history.tsv text.
 * @param {{weeks?: number}} [opts] - How many trailing weeks of addedPerWeek to keep.
 */
export function computeScanStats(content, { weeks = 8 } = {}) {
  const lines = String(content ?? '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const byPortal = {}, byStatus = {};
  const companies = new Set();
  const weekCounts = new Map();
  let totalRecorded = 0, added = 0, firstSeen = null, lastSeen = null;
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols[0] === 'url') continue; // header
    if (!/^https?:\/\//.test(cols[0])) continue; // torn/malformed row
    totalRecorded++;
    const [, date, portal, , company, statusRaw] = cols;
    const status = (statusRaw || 'added').trim() || 'added';
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (portal) byPortal[portal] = (byPortal[portal] || 0) + 1;
    if (company) companies.add(company.toLowerCase());
    if (status === 'added') {
      added++;
      const wk = isoWeek(date);
      if (wk) weekCounts.set(wk, (weekCounts.get(wk) || 0) + 1);
    }
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (!firstSeen || date < firstSeen) firstSeen = date;
      if (!lastSeen || date > lastSeen) lastSeen = date;
    }
  }
  const addedPerWeek = [...weekCounts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-weeks)
    .map(([week, count]) => ({ week, count }));
  return { totalRecorded, added, byStatus, byPortal, distinctCompanies: companies.size, firstSeen, lastSeen, addedPerWeek };
}

/** Lowercased set of company names that ever appeared in scan-history.tsv. */
export function scanCompanyNames(content) {
  const names = new Set();
  for (const line of String(content ?? '').replace(/\r/g, '').split('\n')) {
    const cols = line.split('\t');
    if (!/^https?:\/\//.test(cols[0] || '')) continue;
    const company = (cols[4] || '').trim();
    if (company) names.add(company.toLowerCase());
  }
  return [...names];
}

// ── Portal coverage ─────────────────────────────────────────────────

/**
 * Configured-vs-producing portal coverage.
 *
 * producingPct = share of configured tracked_companies whose name has EVER
 * appeared as a scanned job's company. A low number usually means "no matching
 * openings from that company yet", NOT a broken portal — the --summary label
 * carries the same caveat. Matching is exact-lowercase between portals.yml
 * `name` and the scanner's company string; that undercounts when names differ
 * ("Acme" vs "Acme, Inc."). Documented v1 contract — no silent fuzzy-matching.
 *
 * @param {string} portalsYmlContent - Raw portals.yml text.
 * @param {object|null} scanStats - Result of computeScanStats (for activePortals).
 * @param {string[]} [producingCompanyNames] - From scanCompanyNames().
 */
export function computePortalStats(portalsYmlContent, scanStats, producingCompanyNames = [], portalHealthContent = null) {
  let cfg;
  try {
    cfg = yaml.load(String(portalsYmlContent ?? '')) || {};
  } catch {
    return null; // malformed YAML → no portal section rather than a crash
  }
  const companies = Array.isArray(cfg.tracked_companies) ? cfg.tracked_companies : [];
  const boards = Array.isArray(cfg.job_boards) ? cfg.job_boards : [];
  const configuredNames = new Set(
    companies.map((c) => String(c?.name || '').toLowerCase()).filter(Boolean),
  );
  const producing = new Set(producingCompanyNames.map((n) => String(n).toLowerCase()));
  let producingCompanies = 0;
  for (const name of configuredNames) if (producing.has(name)) producingCompanies++;

  let persistentlyDead = 0;
  if (portalHealthContent) {
    const lines = portalHealthContent.split('\n');
    const healthRecords = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length >= 3) {
        healthRecords.push({ company: parts[1], status: parts[2] });
      }
    }
    const streaks = new Map();
    for (const r of healthRecords) {
      // Mirrors scan.mjs computeConsecutiveFailures: healthy statuses reset,
      // every other status (slug_gone/network/auth/server/unknown) counts.
      if (r.status === 'reachable' || r.status === 'empty') {
        streaks.set(r.company, 0);
      } else {
        streaks.set(r.company, (streaks.get(r.company) || 0) + 1);
      }
    }
    const threshold = cfg.portal_health_threshold || 3;
    for (const [company, streak] of streaks.entries()) {
      if (streak >= threshold && configuredNames.has(String(company).toLowerCase())) {
        persistentlyDead++;
      }
    }
  }

  return {
    configuredCompanies: companies.length,
    configuredBoards: boards.length,
    activePortals: Object.keys(scanStats?.byPortal || {}).length,
    producingCompanies,
    producingPct: pct(producingCompanies, configuredNames.size),
    persistentlyDead,
  };
}

// ── Follow-up compliance ────────────────────────────────────────────

/**
 * Follow-up compliance from follow-ups.md (same table shape followup-cadence
 * parses: | num | appNum | date | company | role | channel | contact | notes |).
 * appliedWithoutFollowup counts tracker rows currently in Applied with zero
 * logged follow-ups — the rows the followup mode would flag as aging silently.
 *
 * @param {string} followupsContent - Raw follow-ups.md text.
 * @param {Map<number,string>} trackerByNum - From trackerStatusByNum().
 */
export function computeFollowupStats(followupsContent, trackerByNum) {
  const byApp = new Map();
  let totalFollowups = 0;
  for (const line of String(followupsContent ?? '').replace(/\r/g, '').split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 8) continue;
    const num = parseInt(parts[1], 10);
    const appNum = parseInt(parts[2], 10);
    if (Number.isNaN(num) || Number.isNaN(appNum)) continue; // header/separator
    totalFollowups++;
    byApp.set(appNum, (byApp.get(appNum) || 0) + 1);
  }
  let appliedWithoutFollowup = 0;
  for (const [num, status] of trackerByNum) {
    if (status === 'Applied' && !byApp.has(num)) appliedWithoutFollowup++;
  }
  return {
    totalFollowups,
    appsWithFollowups: byApp.size,
    appliedWithoutFollowup,
    avgPerApp: byApp.size > 0 ? round1(totalFollowups / byApp.size) : 0,
  };
}

/**
 * Schema check for follow-ups.md, so a malformed table is distinguishable from
 * an empty one (#2971).
 *
 * computeFollowupStats() above and followup-cadence.mjs's parseTrackerContent()
 * both read this table POSITIONALLY, in the shape modes/followup.md documents:
 * `| num | appNum | date | company | role | channel | contact | notes |`. Both
 * skip any row where parts[1] or parts[2] fails parseInt. A table written with a
 * different column order is therefore dropped row by row and reports as ZERO
 * follow-ups in both tools — indistinguishable from a file where nothing has
 * been logged yet, with no error and no warning. This returns the counts needed
 * to tell those two cases apart; verify-pipeline.mjs turns them into output.
 *
 * Reports rather than throws: it is a diagnostic, and the consumers must keep
 * degrading gracefully on a bad file rather than crashing a stats run.
 *
 * @param {string|null} followupsContent - Raw follow-ups.md text, or null when absent.
 * @returns {{present: boolean, sawSeparator: boolean, pipeLines: number,
 *   dataRows: number, parsed: number, unparsedLines: number[]}}
 *   `unparsedLines` holds 1-based line numbers of data rows the consumers will skip.
 */
export function checkFollowupsSchema(followupsContent) {
  const empty = { present: false, sawSeparator: false, pipeLines: 0, dataRows: 0, parsed: 0, unparsedLines: [] };
  if (followupsContent == null) return empty;
  const lines = String(followupsContent).replace(/\r/g, '').split('\n');
  // A Markdown table's delimiter row is the boundary: everything before it is
  // the header (whose cells never parse as ints), everything after is data.
  const SEPARATOR_RE = /^\|[\s|:-]+\|?\s*$/;
  let sawSeparator = false;
  let pipeLines = 0;
  let dataRows = 0;
  let parsed = 0;
  const unparsedLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue; // followup-seed.mjs's "- next #N" pins live outside the table
    pipeLines++;
    if (SEPARATOR_RE.test(line)) { sawSeparator = true; continue; }
    if (!sawSeparator) continue; // header row, or a table missing its delimiter entirely
    dataRows++;
    const parts = line.split('|').map((s) => s.trim());
    // Mirrors both consumers' guard exactly; if it diverges, this check stops
    // predicting what they will actually do with the file.
    const readable = parts.length >= 8
      && !Number.isNaN(parseInt(parts[1], 10))
      && !Number.isNaN(parseInt(parts[2], 10));
    if (readable) parsed++;
    else unparsedLines.push(i + 1);
  }
  return { present: true, sawSeparator, pipeLines, dataRows, parsed, unparsedLines };
}

// ── Scan-run trends ─────────────────────────────────────────────────

/**
 * Aggregate data/scan-runs.tsv (written by scan.mjs, one row per non-dry run).
 *
 * Header-name parsing, NEVER positional: columns may be appended in later
 * schema versions and a positional slice would silently miscount from then on.
 * Torn rows (crash mid-append) and rows with a bad timestamp are skipped;
 * failed runs count in totalRuns/failedRuns but are excluded from averages so
 * an aborted run doesn't drag the trend down.
 *
 * @param {string} content - Raw scan-runs.tsv text.
 * @returns {object|null} null for empty/unknown-schema files.
 */
export function computeRunStats(content) {
  const lines = String(content ?? '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = lines[0].split('\t');
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  if (idx.timestamp == null || idx.found == null) return null; // unknown schema
  const filterCols = header.filter((h) => h.startsWith('filtered_'));
  const rows = [];
  // A row WIDER than the header is the dangerous case, and only the narrow one was guarded.
  // SCAN_RUNS_HEADER is written by appendScanRunSummary only when the file does not yet exist, so
  // when a release appends or inserts a counter the on-disk header silently stops describing the
  // rows beneath it. Every name-based lookup then reads a neighbouring column, and the result is a
  // confident, precise, wrong number rather than an obvious break. Count these and exclude them:
  // the averages must describe the rows the header can still describe, and the caller has to be
  // able to see when that is a minority of the file.
  let driftedRows = 0;
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    if (cols.length > header.length) { driftedRows++; continue; } // header no longer describes this row
    if (cols.length < header.length) continue; // torn row
    if (!/^\d{4}-\d{2}-\d{2}/.test(cols[idx.timestamp] || '')) continue;
    const num = (name) => { const v = Number(cols[idx[name]]); return Number.isNaN(v) ? 0 : v; };
    rows.push({
      date: cols[idx.timestamp].slice(0, 10),
      status: idx.status != null ? cols[idx.status] : 'completed',
      found: num('found'),
      filtered: filterCols.reduce((a, h) => a + num(h), 0),
      newAdded: num('new_added'),
    });
  }
  // Distinguish "no runs recorded" from "every run was excluded as drifted". Returning null for
  // the second case hides the reason: the caller would report an absent scan section on a file
  // that is full of rows the header can no longer describe.
  if (rows.length === 0) {
    return driftedRows > 0
      ? { totalRuns: 0, driftedRows, failedRuns: 0, lastRunDate: null, avgFoundPerRun: 0, avgNewPerRun: 0, filterRemovalPct: 0 }
      : null;
  }
  // Inclusion by 'completed', not exclusion by known failure names: any
  // status a future scan.mjs writes is excluded from trend averages until
  // this aggregator learns what it means. Rows from pre-status files default
  // to 'completed' above, so old data keeps counting.
  //
  // No-op on today's data: scan.mjs only ever writes 'completed' or 'failed',
  // and both predicates ('!== failed' vs '=== completed') agree on those two.
  // The switch is a guard for a future third status (e.g. 'aborted'), not a
  // behavior change now. One edge is reachable only by hand-editing the TSV:
  // an explicitly empty status flips from counted to failedRuns, since
  // appendScanRunSummary always writes a non-empty status.
  const completed = rows.filter((r) => r.status === 'completed');
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  return {
    totalRuns: rows.length,
    driftedRows,
    failedRuns: rows.length - completed.length,
    lastRunDate: rows.map((r) => r.date).sort().at(-1),
    avgFoundPerRun: completed.length ? round1(sum(completed, 'found') / completed.length) : 0,
    avgNewPerRun: completed.length ? round1(sum(completed, 'newAdded') / completed.length) : 0,
    filterRemovalPct: pct(sum(completed, 'filtered'), sum(completed, 'found')),
  };
}

// ── Assembler + CLI ─────────────────────────────────────────────────

/**
 * Assemble the full stats contract. Every section is null when its source
 * file is missing; metadata.sources records what was found.
 */
export function computeAllStats({
  appsFile = APPS_FILE,
  scanHistoryFile = SCAN_HISTORY_FILE,
  followupsFile = FOLLOWUPS_FILE,
  scanRunsFile = SCAN_RUNS_FILE,
  portalsFile = PORTALS_FILE,
  portalHealthFile = PORTAL_HEALTH_FILE,
  statusLogFile = STATUS_LOG_FILE,
} = {}) {
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf-8') : null);
  const apps = read(appsFile);
  const scanHist = read(scanHistoryFile);
  const fups = read(followupsFile);
  const portals = read(portalsFile);
  const runs = read(scanRunsFile);
  const portalHealth = read(portalHealthFile);
  const statusLog = read(statusLogFile);
  const trackerBase = apps ? computeTrackerStats(apps) : null;
  const scan = scanHist ? computeScanStats(scanHist) : null;

  // Cold-classification wiring (#2123): activeApps is purely status-based and
  // stays untouched for backward compatibility. activeAppsLive subtracts rows
  // followup-cadence.mjs's own cadence math independently classifies 'cold'
  // (Applied, zero response after applied_max_followups follow-ups) — the more
  // honest "still worth expecting a reply from" figure. No follow-up data
  // (`fups` null) means no cold rows can be identified, so activeAppsLive
  // simply equals activeApps.
  let tracker = trackerBase;
  if (trackerBase) {
    const coldNums = computeColdAppNums(apps, fups);
    let activeAppsCold = 0;
    if (coldNums.size > 0) {
      const byNum = trackerStatusByNum(apps);
      for (const [num, status] of byNum) {
        if (ACTIVE_STATUSES.has(status) && coldNums.has(num)) activeAppsCold++;
      }
    }
    tracker = {
      ...trackerBase,
      activeAppsLive: trackerBase.activeApps - activeAppsCold,
      activeAppsCold,
    };
  }

  return {
    metadata: {
      generatedAt: new Date().toISOString().slice(0, 10),
      sources: {
        tracker: !!apps,
        scanHistory: !!scanHist,
        followups: !!fups,
        portals: !!portals,
        scanRuns: !!runs,
        portalHealth: !!portalHealth,
        statusLog: !!statusLog,
      },
    },
    tracker,
    // Prefer the ledger-aware funnel once a transition log exists (#1428); fall
    // back to the pure status snapshot when it does not, so nothing regresses.
    funnel: !tracker
      ? null
      : statusLog
        ? computeFunnelWithHistory(trackerStatusByNum(apps), parseStatusLogStages(statusLog))
        : computeFunnel(tracker.byStatus),
    scan,
    portals: portals ? computePortalStats(portals, scan, scanHist ? scanCompanyNames(scanHist) : [], portalHealth) : null,
    followups: fups && apps ? computeFollowupStats(fups, trackerStatusByNum(apps)) : null,
    runs: runs ? computeRunStats(runs) : null,
  };
}

/** Human-readable table. pdfPct/reportPct are JSON-only by design — no job-search decision follows from them. */
function printSummary(stats) {
  const line = '━'.repeat(45);
  console.log(`\n${line}`);
  console.log(`Pipeline Stats — ${stats.metadata.generatedAt}`);
  console.log(line);
  const t = stats.tracker;
  if (t) {
    const fit = t.avgScore != null
      ? ` | avg fit ${t.avgScore}/5${t.avgScoreApplied != null ? ` (pursued roles ${t.avgScoreApplied}/5)` : ''} | top ${t.topScore}`
      : '';
    // Only break out live/cold when there's a cold row to report — with no
    // follow-up data (or genuinely zero cold rows) the plain count is exactly
    // as accurate and the parenthetical would be noise.
    const liveInfo = t.activeAppsCold > 0 ? ` (${t.activeAppsLive} live, ${t.activeAppsCold} cold)` : '';
    console.log(`Tracker:    ${t.total} total | ${t.activeApps} active${liveInfo}${fit}`);
    const statusLine = Object.entries(t.byStatus).filter(([, c]) => c > 0).map(([s, c]) => `${s} ${c}`).join(' · ');
    if (statusLine) console.log(`Status:     ${statusLine}`);
  } else {
    console.log('Tracker:    — no data (data/applications.md missing)');
  }
  const f = stats.funnel;
  if (f) {
    const small = f.smallSample ? ' (small sample — rates indicative only)' : '';
    const basis = f.basis === 'ledger' ? ' · ledger-adjusted (folds status-log history)' : '';
    console.log(`Funnel:     ever applied ${f.everApplied} → responded ${f.everResponded} (${f.responseRate}%) → interview ${f.everInterview} (${f.interviewRate}%) → offer ${f.everOffer} (${f.offerRate}%)${small}${basis}`);
  }
  const s = stats.scan;
  if (s) {
    const portalsLine = Object.entries(s.byPortal).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, c]) => `${p} ${c}`).join(' · ');
    console.log(`Scanner:    ${s.totalRecorded} jobs recorded${s.firstSeen ? ` since ${s.firstSeen}` : ''} | ${s.added} added | ${s.distinctCompanies} companies${portalsLine ? ` | ${portalsLine}` : ''}`);
  } else {
    console.log('Scanner:    — no data (data/scan-history.tsv missing)');
  }
  const p = stats.portals;
  if (p) {
    const deadPart = p.persistentlyDead > 0 ? ` | 🚨 ${p.persistentlyDead} persistently dead (run verify-portals.mjs)` : '';
    console.log(`Portals:    ${p.configuredCompanies} companies + ${p.configuredBoards} boards configured | ${p.producingCompanies} have produced a match (${p.producingPct}%)${deadPart} — low ≠ broken, may just be no openings`);
  } else {
    console.log('Portals:    — no data (portals.yml missing)');
  }
  const fu = stats.followups;
  if (fu) {
    console.log(`Follow-ups: ${fu.totalFollowups} sent across ${fu.appsWithFollowups} apps | ${fu.appliedWithoutFollowup} Applied apps with none | avg ${fu.avgPerApp}/app`);
  } else {
    console.log('Follow-ups: — no data (data/follow-ups.md missing)');
  }
  const r = stats.runs;
  if (r && r.totalRuns === 0 && r.driftedRows > 0) {
    // Every row was excluded, so there is no last run to name and no average worth printing.
    // Rendering the normal line here would read `0 recorded (last null) | avg 0 found`, which
    // looks like an empty file rather than an unreadable one.
    console.log(`Runs:       none readable — all ${r.driftedRows} row(s) in scan-runs.tsv are wider than its header, so their columns cannot be read by name.`);
    console.log('            Recover by moving scan-runs.tsv aside; the next scan writes a fresh file with a current header.');
  } else if (r) {
    const failed = r.failedRuns > 0 ? ` | ${r.failedRuns} failed` : '';
    console.log(`Runs:       ${r.totalRuns} recorded (last ${r.lastRunDate})${failed} | avg ${r.avgFoundPerRun} found / ${r.avgNewPerRun} new per run | filters remove ${r.filterRemovalPct}%`);
    if (r.driftedRows > 0) {
      // Say it rather than quietly averaging whichever rows still line up: those may be a small
      // and unrepresentative tail of the file.
      console.log(`            ${r.driftedRows} row(s) excluded — wider than scan-runs.tsv's header, so their columns cannot be read by name. Move the file aside to start a fresh one.`);
    }
  } else {
    console.log('Runs:       — no data (data/scan-runs.tsv missing; created by the next scan)');
  }
  console.log('');
}

// ── CLI flags + help ────────────────────────────────────────────────

const KNOWN_FLAGS = ['--summary', '--help', '-h'];

const USAGE = `Usage:
  node stats.mjs             # full JSON stats to stdout
  node stats.mjs --summary   # human-readable table
  node stats.mjs --help|-h   # print this usage block and exit`;

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);

  validateFlags(args, KNOWN_FLAGS, USAGE);

  const stats = computeAllStats();
  if (args.includes('--summary')) printSummary(stats);
  else console.log(JSON.stringify(stats, null, 2));
}
