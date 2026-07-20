#!/usr/bin/env node
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
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { normalizeStatus } from './followup-cadence.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = join(ROOT, 'data', 'applications.md');
const SCAN_HISTORY_FILE = join(ROOT, 'data', 'scan-history.tsv');
const FOLLOWUPS_FILE = join(ROOT, 'data', 'follow-ups.md');
const SCAN_RUNS_FILE = join(ROOT, 'data', 'scan-runs.tsv');
const PORTALS_FILE = join(ROOT, 'portals.yml');
const PORTAL_HEALTH_FILE = join(ROOT, 'data', 'portal-health.tsv');

const CANONICAL_STATUSES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];

// In-flight applications. Deliberately NARROWER than the dashboard's
// ActiveApps (which also counts Evaluated): an evaluated-but-never-sent row is
// a candidate, not an application in flight.
const ACTIVE_STATUSES = new Set(['Applied', 'Responded', 'Interview', 'Offer']);

// Rows that count toward avgScoreApplied — jobs the user actually pursued.
// Plain avgScore mixes in SKIP/Discarded and understates real fit.
const PURSUED_STATUSES = new Set(['Applied', 'Responded', 'Interview', 'Offer', 'Rejected']);

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

// ── Cumulative funnel ───────────────────────────────────────────────

/**
 * Cumulative funnel: everX = "reached stage X or beyond, ever". The math
 * mirrors the dashboard's ComputeProgressMetrics (career.go): Rejected counts
 * into everApplied (a rejection proves a submission), and each later stage
 * sums itself plus everything beyond it. Rates are relative to everApplied.
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
  const everApplied = n('Applied') + n('Responded') + n('Interview') + n('Offer') + n('Rejected');
  const everResponded = n('Responded') + n('Interview') + n('Offer');
  const everInterview = n('Interview') + n('Offer');
  const everOffer = n('Offer');
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
      if (r.status === 'slug_gone' || r.status === 'network') {
        streaks.set(r.company, (streaks.get(r.company) || 0) + 1);
      } else if (r.status === 'reachable' || r.status === 'empty') {
        streaks.set(r.company, 0);
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
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
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
  if (rows.length === 0) return null;
  const completed = rows.filter((r) => r.status !== 'failed');
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  return {
    totalRuns: rows.length,
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
} = {}) {
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf-8') : null);
  const apps = read(appsFile);
  const scanHist = read(scanHistoryFile);
  const fups = read(followupsFile);
  const portals = read(portalsFile);
  const runs = read(scanRunsFile);
  const portalHealth = read(portalHealthFile);
  const tracker = apps ? computeTrackerStats(apps) : null;
  const scan = scanHist ? computeScanStats(scanHist) : null;
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
      },
    },
    tracker,
    funnel: tracker ? computeFunnel(tracker.byStatus) : null,
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
    console.log(`Tracker:    ${t.total} total | ${t.activeApps} active${fit}`);
    const statusLine = Object.entries(t.byStatus).filter(([, c]) => c > 0).map(([s, c]) => `${s} ${c}`).join(' · ');
    if (statusLine) console.log(`Status:     ${statusLine}`);
  } else {
    console.log('Tracker:    — no data (data/applications.md missing)');
  }
  const f = stats.funnel;
  if (f) {
    const small = f.smallSample ? ' (small sample — rates indicative only)' : '';
    console.log(`Funnel:     ever applied ${f.everApplied} → responded ${f.everResponded} (${f.responseRate}%) → interview ${f.everInterview} (${f.interviewRate}%) → offer ${f.everOffer} (${f.offerRate}%)${small}`);
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
  if (r) {
    const failed = r.failedRuns > 0 ? ` | ${r.failedRuns} failed` : '';
    console.log(`Runs:       ${r.totalRuns} recorded (last ${r.lastRunDate})${failed} | avg ${r.avgFoundPerRun} found / ${r.avgNewPerRun} new per run | filters remove ${r.filterRemovalPct}%`);
  } else {
    console.log('Runs:       — no data (data/scan-runs.tsv missing; created by the next scan)');
  }
  console.log('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stats = computeAllStats();
  if (process.argv.includes('--summary')) printSummary(stats);
  else console.log(JSON.stringify(stats, null, 2));
}
