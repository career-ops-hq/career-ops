#!/usr/bin/env node
/**
 * company-history.mjs — Per-Company Evidence-Card Aggregator for career-ops
 *
 * READ-ONLY. Never writes a file. Joins the tracker (data/applications.md),
 * follow-ups (data/follow-ups.md), and scan-history (data/scan-history.tsv)
 * per company, and renders an evidence card per company covering two
 * independent axes:
 *
 *   - responsiveness: has THIS company ever responded to you, or gone silent
 *     on an Applied row past the silence window? A rejection counts as a
 *     response — it is an answer, not silence.
 *   - postingChurn: does this company repost the same role repeatedly
 *     (evergreen requisition / re-opened search), per detect-reposts.mjs?
 *
 * This script deliberately reports FACTS, not verdicts. It never uses the
 * words "ghost"/"ghosted" or "risk" — high-volume inboxes, evergreen
 * requisitions, re-opened searches, and the candidate's own unlogged
 * responses all produce the same raw signals as genuine silence, so the
 * card lists evidence and lets the human judge it.
 *
 * Sources (each optional; a missing file degrades gracefully, never crashes):
 *   - tracker:       resolveTrackerPath() -> data/applications.md
 *   - follow-ups:    data/follow-ups.md
 *   - scan-history:  data/scan-history.tsv (-> detectReposts clusters)
 *   - status-log:    ./funnel-velocity.mjs, loaded ONLY via a dynamic
 *                     `await import(...)` in try/catch. This module does not
 *                     exist on this branch — the import always fails and the
 *                     statusLog source reports false. The try-path is written
 *                     defensively so it degrades the same way if the module
 *                     is absent OR present-but-shaped differently than
 *                     expected in a future branch/install: every extraction
 *                     from it is guarded by `typeof x === 'function'`.
 *
 * Run: node company-history.mjs                    (JSON to stdout)
 *      node company-history.mjs --summary           (human-readable cards)
 *      node company-history.mjs --company "Acme"    (single-card lookup)
 *      node company-history.mjs --silence-window 21 (override default window)
 *      node company-history.mjs --include-stale     (include >365d-old facts in labels)
 *      node company-history.mjs --self-test
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';

import { parseScanHistory, detectReposts } from './detect-reposts.mjs';
import { normalizeCompany, resolveTrackerPath } from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import {
  parseFollowups,
  parseAppliedDate,
  parseDate,
  daysBetween,
  normalizeStatus,
} from './followup-cadence.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));

const DEFAULT_STALE_AFTER_DAYS = 365;
const DEFAULT_SILENCE_WINDOW_DAYS = 28;

// Statuses that count as "the company answered" — a rejection IS an answer.
const RESPONDED_STATUSES = new Set(['responded', 'interview', 'offer', 'rejected']);
const OUTCOME_LABELS = { responded: 'Responded', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };

const EXPLANATION_LINE =
  'high-volume inboxes, evergreen requisitions, re-opened searches, and your own unlogged responses ' +
  'all produce these patterns — facts, not verdicts';

// --- CLI args ---
const KNOWN_FLAGS = ['--summary', '--self-test', '--company', '--silence-window', '--include-stale', '--scan-history', '--followups', '--help', '-h'];
const VALUE_FLAGS = ['--company', '--silence-window', '--scan-history', '--followups'];

const USAGE = `Usage:
  node company-history.mjs                       # full JSON evidence cards to stdout
  node company-history.mjs --summary              # human-readable cards
  node company-history.mjs --company "Acme"       # single-card lookup
  node company-history.mjs --silence-window 21    # override the default silence window (days)
  node company-history.mjs --include-stale        # include facts older than 365d in label computation
  node company-history.mjs --self-test            # run the in-memory test suite
  node company-history.mjs --help                 # print this usage block and exit`;

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  // A value flag's space-separated value must not be mistaken for an
  // unrecognized flag just because it starts with `-` (mirrors
  // scan-ats-full.mjs's adjacency rule).
  const consumedValueIndices = new Set();
  args.forEach((a, idx) => {
    if (VALUE_FLAGS.includes(a) && args[idx + 1] !== undefined && !args[idx + 1].startsWith('--')) {
      consumedValueIndices.add(idx + 1);
    }
  });

  const unknownFlags = args.filter((a, idx) =>
    a.startsWith('-') && !consumedValueIndices.has(idx) && !KNOWN_FLAGS.includes(a.split('=')[0]));
  if (unknownFlags.length) {
    console.error(`Error: unrecognized flag(s): ${unknownFlags.join(', ')}. Valid flags: ${KNOWN_FLAGS.join(', ')}`);
    console.error(USAGE);
    process.exit(1);
  }

  const valueOf = (flag) => {
    // `--flag=value` form first: `args.indexOf(flag)` is -1 for it, so the
    // space-separated lookup below would silently drop the value otherwise.
    const eq = args.find(a => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    return args[idx + 1];
  };

  return {
    summaryMode: args.includes('--summary'),
    selfTestMode: args.includes('--self-test'),
    company: valueOf('--company'),
    silenceWindowArg: valueOf('--silence-window'),
    includeStale: args.includes('--include-stale'),
    scanHistoryOverride: valueOf('--scan-history'),
    followupsOverride: valueOf('--followups'),
  };
}

// --- Default silence-window resolution ---
//
// templates/benchmarks.yml does not exist on this branch, but a user install
// may ship it (days_first_response.range_days[1] * 2). Try it, fall back to
// the hardcoded default. Any parse failure degrades silently to the default
// — this is a nice-to-have default source, never a hard dependency.
export function resolveDefaultSilenceWindow(rootDir = CAREER_OPS) {
  try {
    const path = join(rootDir, 'templates/benchmarks.yml');
    if (!existsSync(path)) return DEFAULT_SILENCE_WINDOW_DAYS;
    const doc = yaml.load(readFileSync(path, 'utf-8'));
    const range = doc?.days_first_response?.range_days;
    const upper = Array.isArray(range) ? range[1] : undefined;
    if (typeof upper === 'number' && Number.isFinite(upper) && upper > 0) return upper * 2;
    return DEFAULT_SILENCE_WINDOW_DAYS;
  } catch {
    return DEFAULT_SILENCE_WINDOW_DAYS;
  }
}

// --- today() — injectable for deterministic tests ---
export function today() {
  return new Date(new Date().toISOString().split('T')[0]);
}

function resolveNow(now) {
  if (now instanceof Date) return now;
  if (typeof now === 'string') return parseDate(now) || today();
  return today();
}

// --- Source loaders (each returns {rows|clusters, loaded}; missing file -> empty + loaded:false) ---

export function loadTrackerRows(rootDir = CAREER_OPS) {
  const path = resolveTrackerPath(rootDir);
  if (!existsSync(path)) return { rows: [], loaded: false };
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  const colmap = resolveColumns(lines);
  const rows = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) rows.push(row);
  }
  return { rows, loaded: true };
}

export function loadFollowupRows(rootDir = CAREER_OPS, overridePath) {
  const path = overridePath || join(rootDir, 'data/follow-ups.md');
  if (!existsSync(path)) return { rows: [], loaded: false };
  return { rows: parseFollowups(readFileSync(path, 'utf-8')), loaded: true };
}

export function loadRepostClusters(rootDir = CAREER_OPS, overridePath) {
  const path = overridePath || join(rootDir, 'data/scan-history.tsv');
  if (!existsSync(path)) return { clusters: [], loaded: false };
  const rows = parseScanHistory(readFileSync(path, 'utf-8'));
  return { clusters: detectReposts(rows), loaded: true };
}

// Dynamic-only dependency: funnel-velocity.mjs does not exist on this branch.
// Loaded exclusively through a try/catch'd dynamic import so a missing (or
// differently-shaped) module never crashes this script. Every extraction
// below is guarded with typeof checks for the same reason — we cannot verify
// the real export surface of a module that isn't present yet.
export async function loadStatusLogSource() {
  let mod = null;
  try {
    mod = await import('./funnel-velocity.mjs');
  } catch {
    return { loaded: false, appliedDateByNum: new Map(), medianResponseDays: null };
  }
  if (!mod || typeof mod !== 'object') {
    return { loaded: false, appliedDateByNum: new Map(), medianResponseDays: null };
  }

  const appliedDateByNum = new Map();
  try {
    if (typeof mod.getAppliedDateObservations === 'function') {
      const observations = mod.getAppliedDateObservations();
      if (Array.isArray(observations)) {
        for (const obs of observations) {
          if (obs && Number.isFinite(obs.num) && obs.appliedDate) {
            appliedDateByNum.set(obs.num, obs.appliedDate);
          }
        }
      }
    }
  } catch {
    // Defensive: an unexpected shape must not crash aggregation.
  }

  let medianResponseDays = null;
  try {
    if (typeof mod.computeMedianResponseDays === 'function') {
      const value = mod.computeMedianResponseDays();
      if (typeof value === 'number' && Number.isFinite(value)) medianResponseDays = value;
    }
  } catch {
    // Defensive: an unexpected shape must not crash aggregation.
  }

  return { loaded: true, appliedDateByNum, medianResponseDays };
}

// --- Follow-up counts joined by appNum ---
export function buildFollowupCountsByAppNum(followupRows) {
  const counts = new Map();
  for (const fu of Array.isArray(followupRows) ? followupRows : []) {
    if (!fu || !Number.isFinite(fu.appNum)) continue;
    counts.set(fu.appNum, (counts.get(fu.appNum) || 0) + 1);
  }
  return counts;
}

// --- Applied-date resolution (priority: status-log -> notes -> tracker date column) ---
export function resolveAppliedDate(row, statusLogAppliedByNum) {
  const fromLog = statusLogAppliedByNum instanceof Map ? statusLogAppliedByNum.get(row.num) : undefined;
  if (fromLog) return { dateStr: fromLog, dateBasis: 'status-log' };

  const fromNotes = parseAppliedDate(row.notes);
  if (fromNotes) return { dateStr: fromNotes, dateBasis: 'notes' };

  return { dateStr: row.date, dateBasis: 'evaluation-date' };
}

// --- Responsiveness axis (pure) ---
//
// rows: tracker rows already scoped to one company.
// followupCountsByAppNum: Map<appNum, count> (global — join key is appNum, not company).
// opts: { now, silenceWindowDays, staleAfterDays, includeStale, statusLogAppliedByNum }
export function computeResponsiveness(rows, followupCountsByAppNum, opts = {}) {
  const now = resolveNow(opts.now);
  const silenceWindowDays = Number.isFinite(opts.silenceWindowDays) ? opts.silenceWindowDays : DEFAULT_SILENCE_WINDOW_DAYS;
  const staleAfterDays = Number.isFinite(opts.staleAfterDays) ? opts.staleAfterDays : DEFAULT_STALE_AFTER_DAYS;
  const includeStale = !!opts.includeStale;
  const counts = followupCountsByAppNum instanceof Map ? followupCountsByAppNum : new Map();
  const statusLogAppliedByNum = opts.statusLogAppliedByNum instanceof Map ? opts.statusLogAppliedByNum : null;

  const facts = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const normalized = normalizeStatus(String(row.status || ''));

    if (normalized === 'applied') {
      const { dateStr, dateBasis } = resolveAppliedDate(row, statusLogAppliedByNum);
      const appliedDate = parseDate(dateStr);
      if (!appliedDate) continue; // unusable date — no fact, no crash

      const silentDays = daysBetween(appliedDate, now);
      if (silentDays < silenceWindowDays) continue; // right-censored: pending, not silent

      const followupsSent = counts.get(row.num) || 0;
      facts.push({
        num: row.num,
        appliedDate: dateStr,
        status: row.status,
        silentDays,
        followupsSent,
        confidence: followupsSent >= 1 ? 'confirmed-by-followups' : 'unconfirmed',
        stale: silentDays > staleAfterDays,
        dateBasis,
        // Real set-status.mjs syntax (it rejects unknown flags, so the
        // instruction must only use flags that exist): the response date is
        // recorded through --note, which appends idempotently.
        clearInstruction: `if they actually responded, node set-status.mjs ${row.num} <state> --note "responded <date>" clears this`,
      });
    } else if (RESPONDED_STATUSES.has(normalized)) {
      const respondedDate = parseDate(row.date) ? row.date : undefined;
      const ageBasisDate = respondedDate ? parseDate(respondedDate) : null;
      const fact = {
        num: row.num,
        outcome: OUTCOME_LABELS[normalized] || row.status,
        stale: ageBasisDate ? daysBetween(ageBasisDate, now) > staleAfterDays : false,
      };
      if (respondedDate) fact.respondedDate = respondedDate;
      if (normalized === 'rejected') fact.note = 'a rejection is an answer';
      facts.push(fact);
    }
  }

  facts.sort((a, b) => a.num - b.num);

  const isSilent = f => 'silentDays' in f;
  const isResponded = f => 'outcome' in f;
  const activeFacts = includeStale ? facts : facts.filter(f => !f.stale);
  const hasSilent = activeFacts.some(isSilent);
  const hasResponded = activeFacts.some(isResponded);

  let label;
  if (hasSilent && hasResponded) label = 'mixed';
  else if (hasSilent) label = 'silent-on-you';
  else if (hasResponded) label = 'responded-before';
  else label = 'no-history';

  return {
    label,
    facts,
    medianResponseDays: Number.isFinite(opts.medianResponseDays) ? opts.medianResponseDays : null,
  };
}

// --- Posting-churn axis (pure) ---
export function computePostingChurn(clusters, scanHistoryLoaded) {
  if (!scanHistoryLoaded) return { label: 'no-scan-data', clusters: [] };
  const mapped = (Array.isArray(clusters) ? clusters : []).map(c => ({
    role: c.role,
    repostCount: c.repostCount,
    daysSpan: c.daysSpan,
    lastSeen: c.lastSeen,
  }));
  return { label: mapped.length > 0 ? 'reposts-detected' : 'none-detected', clusters: mapped };
}

// --- Full aggregation (pure — takes already-loaded sources) ---
//
// sources: {
//   trackerRows, followupRows, repostClusters,
//   sourcesLoaded: { tracker, followups, scanHistory, statusLog },
//   statusLogAppliedByNum, medianResponseDays,
// }
// opts: { now, silenceWindowDays, staleAfterDays, includeStale }
export function buildCompanyCards(sources, opts = {}) {
  const trackerRows = Array.isArray(sources.trackerRows) ? sources.trackerRows : [];
  const followupRows = Array.isArray(sources.followupRows) ? sources.followupRows : [];
  const repostClusters = Array.isArray(sources.repostClusters) ? sources.repostClusters : [];
  const sourcesLoaded = sources.sourcesLoaded || { tracker: false, followups: false, scanHistory: false, statusLog: false };

  const silenceWindowDays = Number.isFinite(opts.silenceWindowDays) ? opts.silenceWindowDays : DEFAULT_SILENCE_WINDOW_DAYS;
  const staleAfterDays = Number.isFinite(opts.staleAfterDays) ? opts.staleAfterDays : DEFAULT_STALE_AFTER_DAYS;

  let unjoinable = 0;

  // Group tracker rows by normalized company key.
  const trackerByKey = new Map();
  for (const row of trackerRows) {
    const key = normalizeCompany(String(row?.company || ''));
    if (!key) { unjoinable += 1; continue; }
    if (!trackerByKey.has(key)) trackerByKey.set(key, { company: row.company, rows: [] });
    trackerByKey.get(key).rows.push(row);
  }

  // Follow-ups without a resolvable company key still count towards
  // dataQuality (they contribute to the join universe even though counts are
  // joined by appNum, not company).
  for (const fu of followupRows) {
    const key = normalizeCompany(String(fu?.company || ''));
    if (!key) unjoinable += 1;
  }

  // Group repost clusters by normalized company key (re-key raw cluster strings).
  const clustersByKey = new Map();
  for (const cluster of repostClusters) {
    const key = normalizeCompany(String(cluster?.company || ''));
    if (!key) { unjoinable += 1; continue; }
    if (!clustersByKey.has(key)) clustersByKey.set(key, { company: cluster.company, clusters: [] });
    clustersByKey.get(key).clusters.push(cluster);
  }

  const followupCountsByAppNum = buildFollowupCountsByAppNum(followupRows);

  const keys = new Set([...trackerByKey.keys(), ...clustersByKey.keys()]);

  const cards = [];
  const hygieneAgedApplied = [];

  for (const key of keys) {
    const trackerGroup = trackerByKey.get(key);
    const clusterGroup = clustersByKey.get(key);
    const companyName = trackerGroup?.company || clusterGroup?.company || key;

    const responsiveness = computeResponsiveness(trackerGroup?.rows || [], followupCountsByAppNum, {
      now: opts.now,
      silenceWindowDays,
      staleAfterDays,
      includeStale: opts.includeStale,
      statusLogAppliedByNum: sources.statusLogAppliedByNum,
      medianResponseDays: sources.medianResponseDays,
    });

    const postingChurn = computePostingChurn(clusterGroup?.clusters || [], sourcesLoaded.scanHistory);

    const hasAnySilent = responsiveness.facts.some(f => 'silentDays' in f);
    const explanations = hasAnySilent ? [EXPLANATION_LINE] : [];

    for (const f of responsiveness.facts) {
      if ('silentDays' in f) {
        hygieneAgedApplied.push({ num: f.num, company: companyName, silentDays: f.silentDays });
      }
    }

    cards.push({ company: companyName, key, responsiveness, postingChurn, explanations });
  }

  cards.sort((a, b) => a.company.localeCompare(b.company));
  hygieneAgedApplied.sort((a, b) => b.silentDays - a.silentDays);

  return {
    metadata: {
      silenceWindowDays,
      staleAfterDays,
      companies: cards.length,
      sources: sourcesLoaded,
    },
    hygiene: { agedApplied: hygieneAgedApplied },
    companies: cards,
    dataQuality: { unjoinable },
  };
}

// --- Single-company lookup ---
export function getCompanyCard(result, companyName) {
  const key = normalizeCompany(String(companyName || ''));
  const found = result.companies.find(c => c.key === key);
  if (found) return found;

  const scanHistoryLoaded = !!result.metadata?.sources?.scanHistory;
  return {
    company: companyName,
    key,
    responsiveness: { label: 'no-history', facts: [] },
    postingChurn: { label: scanHistoryLoaded ? 'none-detected' : 'no-scan-data', clusters: [] },
    explanations: [],
  };
}

// --- Summary rendering (pure) ---
const LABEL_ORDER = { 'silent-on-you': 0, mixed: 1, 'responded-before': 2, 'no-history': 3 };

export function renderSummary(result) {
  const lines = [];
  lines.push('');
  lines.push('='.repeat(78));
  lines.push('  Company History — career-ops');
  lines.push(`  companies: ${result.companies.length} | silence window: ${result.metadata.silenceWindowDays}d`);
  lines.push('='.repeat(78));
  lines.push('');

  const aged = result.hygiene?.agedApplied || [];
  if (aged.length > 0) {
    lines.push(`  ${aged.length} aged-Applied row(s) look silent — confirm real or update (node set-status.mjs <num> <state> --note "responded <date>").`);
    lines.push('');
  }

  lines.push('  silence window: ' + result.metadata.silenceWindowDays + 'd — slow to reply is common; silence within the window is expected.');
  lines.push('');

  const sorted = [...result.companies].sort((a, b) => {
    const rank = (LABEL_ORDER[a.responsiveness.label] ?? 9) - (LABEL_ORDER[b.responsiveness.label] ?? 9);
    return rank !== 0 ? rank : a.company.localeCompare(b.company);
  });

  if (sorted.length === 0) {
    lines.push('  No company evidence available (no tracker, follow-up, or scan-history data found).');
    lines.push('');
  }

  for (const card of sorted) {
    lines.push(`  ${card.company} [${card.responsiveness.label}] — postings: ${card.postingChurn.label}`);
    for (const f of card.responsiveness.facts) {
      if ('silentDays' in f) {
        const staleTag = f.stale ? ' (stale)' : '';
        lines.push(`      #${f.num} silent ${f.silentDays}d since ${f.appliedDate} — ${f.followupsSent} follow-up(s), ${f.confidence}${staleTag}`);
      } else {
        const note = f.note ? ` (${f.note})` : '';
        lines.push(`      #${f.num} ${f.outcome}${f.respondedDate ? ` on ${f.respondedDate}` : ''}${note}`);
      }
    }
    for (const c of card.postingChurn.clusters) {
      lines.push(`      repost: "${c.role}" seen ${c.repostCount}x over ${c.daysSpan}d, last ${c.lastSeen}`);
    }
    if (card.explanations.length > 0) {
      lines.push(`      note: ${card.explanations[0]}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Self-test ---
function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  const NOW = new Date('2026-07-09T00:00:00Z');
  const row = (num, company, status, date, notes = '') => ({ num, date, company, role: 'Engineer', score: '4/5', status, pdf: '✅', report: `reports/${num}.md`, notes });

  // --- join fixtures: case/punct variants meet under one key; "" excluded -> unjoinable ---
  {
    const rows = [
      row(1, 'Acme Inc.', 'Applied', '2026-01-01'),
      row(2, 'ACME, INC', 'Applied', '2026-01-02'),
      row(3, '株式会社', 'Applied', '2026-01-03'), // normalizeCompany -> "" (non a-z0-9)
    ];
    const result = buildCompanyCards(
      { trackerRows: rows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(result.companies.length === 1, 'case/punct company variants join under one key');
    check(result.companies[0].responsiveness.facts.length === 2, 'both joined rows contribute facts to the single card');
    check(result.dataQuality.unjoinable === 1, 'empty-key company (non-Latin, strips to "") is excluded and counted as unjoinable');
  }

  // --- label goldens ---
  {
    // silent-on-you: one Applied row well past the window, nothing else.
    const silentOnly = buildCompanyCards(
      { trackerRows: [row(10, 'SilentCo', 'Applied', '2026-05-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(silentOnly.companies[0].responsiveness.label === 'silent-on-you', 'silent-only fixture labels silent-on-you');

    // responded-before: a Rejected row only.
    const respondedOnly = buildCompanyCards(
      { trackerRows: [row(11, 'RespondedCo', 'Rejected', '2026-06-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(respondedOnly.companies[0].responsiveness.label === 'responded-before', 'responded-only fixture labels responded-before');

    // mixed: one silent-old Applied row + one later Rejected row (different app).
    const mixed = buildCompanyCards(
      {
        trackerRows: [
          row(12, 'MixedCo', 'Applied', '2026-05-01'),
          row(13, 'MixedCo', 'Rejected', '2026-06-20'),
        ],
        followupRows: [], repostClusters: [],
        sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false },
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(mixed.companies[0].responsiveness.label === 'mixed', 'silent-old + responded-later fixture labels mixed (both retained in facts)');
    check(mixed.companies[0].responsiveness.facts.length === 2, 'mixed card retains both the silent and the responded fact');

    // no-history: an Evaluated row only (never applied, never responded).
    const noHistory = buildCompanyCards(
      { trackerRows: [row(14, 'NoHistoryCo', 'Evaluated', '2026-06-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(noHistory.companies[0].responsiveness.label === 'no-history', 'Evaluated-only fixture labels no-history');
    check(noHistory.companies[0].responsiveness.facts.length === 0, 'no-history card carries no facts');
  }

  // --- right-censoring: Applied row younger than window -> pending, not silent ---
  {
    const pending = buildCompanyCards(
      { trackerRows: [row(20, 'PendingCo', 'Applied', '2026-07-05')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(pending.companies[0].responsiveness.facts.length === 0, 'Applied row younger than the window produces no fact (pending, right-censored)');
    check(pending.companies[0].responsiveness.label === 'no-history', 'a lone pending row labels no-history, not silent-on-you');
  }

  // --- rejection-is-an-answer ---
  {
    const rejected = computeResponsiveness([row(30, 'RejCo', 'Rejected', '2026-06-01')], new Map(), { now: NOW, silenceWindowDays: 28 });
    check(rejected.facts.length === 1 && rejected.facts[0].outcome === 'Rejected', 'Rejected row produces a responded fact with outcome Rejected');
    check(rejected.facts[0].note === 'a rejection is an answer', 'Rejected fact carries the rejection-is-an-answer note');
  }

  // --- pin-line exclusion (parseFollowups already handles this; assert via fixture) ---
  {
    const followupsMd = [
      '| # | App# | Date | Company | Role | Channel | Contact | Notes |',
      '|---|------|------|---------|------|---------|---------|-------|',
      '| 1 | 40 | 2026-06-01 | PinCo | Engineer | Email | jane@pinco.com | first nudge |',
      '- next #40 2026-07-15 (set 2026-07-01)',
    ].join('\n');
    const followupRows = parseFollowups(followupsMd);
    check(followupRows.length === 1, 'pin-directive line is not parsed as a sent follow-up row');
    check(followupRows[0].appNum === 40, 'the one real follow-up row parses with the expected appNum');
  }

  // --- confidence-not-label: same label, different confidence ---
  {
    const followupRows = [
      { num: 1, appNum: 50, date: '2026-06-01', company: 'ConfA', role: 'x', channel: 'Email', contact: 'a@a.com', notes: '' },
      { num: 2, appNum: 50, date: '2026-06-08', company: 'ConfA', role: 'x', channel: 'Email', contact: 'a@a.com', notes: '' },
    ];
    const result = buildCompanyCards(
      {
        trackerRows: [row(50, 'ConfA', 'Applied', '2026-05-01'), row(51, 'ConfB', 'Applied', '2026-05-01')],
        followupRows, repostClusters: [],
        sourcesLoaded: { tracker: true, followups: true, scanHistory: false, statusLog: false },
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    const confA = getCompanyCard(result, 'ConfA');
    const confB = getCompanyCard(result, 'ConfB');
    check(confA.responsiveness.label === 'silent-on-you' && confB.responsiveness.label === 'silent-on-you', 'both rows share the silent-on-you label regardless of follow-up count');
    check(confA.responsiveness.facts[0].confidence === 'confirmed-by-followups', '2 follow-ups sent -> confirmed-by-followups');
    check(confB.responsiveness.facts[0].confidence === 'unconfirmed', '0 follow-ups sent -> unconfirmed');
  }

  // --- stale: fact >365d old excluded from label by default; --include-stale includes ---
  {
    const staleRows = [row(60, 'StaleCo', 'Applied', '2025-01-01')]; // ~554 days before NOW
    const defaultResult = computeResponsiveness(staleRows, new Map(), { now: NOW, silenceWindowDays: 28 });
    check(defaultResult.facts[0].stale === true, 'a >365d-old Applied row is flagged stale');
    check(defaultResult.label === 'no-history', 'a stale-only fact is excluded from label computation by default');

    const includeStaleResult = computeResponsiveness(staleRows, new Map(), { now: NOW, silenceWindowDays: 28, includeStale: true });
    check(includeStaleResult.label === 'silent-on-you', '--include-stale includes the stale fact in label computation');
  }

  // --- absent-file degradation: each source absent -> false, no crash, other axes still work ---
  {
    const bogusRoot = join(CAREER_OPS, '__does-not-exist__');
    const tracker = loadTrackerRows(bogusRoot);
    check(tracker.loaded === false && tracker.rows.length === 0, 'loadTrackerRows against a nonexistent root degrades gracefully');

    const followups = loadFollowupRows(bogusRoot);
    check(followups.loaded === false && followups.rows.length === 0, 'loadFollowupRows against a nonexistent root degrades gracefully');

    const scanHistory = loadRepostClusters(bogusRoot);
    check(scanHistory.loaded === false && scanHistory.clusters.length === 0, 'loadRepostClusters against a nonexistent root degrades gracefully');

    const result = buildCompanyCards(
      {
        trackerRows: [row(70, 'AloneCo', 'Applied', '2026-05-01')],
        followupRows: [], repostClusters: [],
        sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false },
      },
      { now: NOW, silenceWindowDays: 28 },
    );
    check(result.companies[0].responsiveness.label === 'silent-on-you', 'responsiveness axis still computes when other sources are absent');
    check(result.companies[0].postingChurn.label === 'no-scan-data', 'churn axis reports no-scan-data when scan-history is absent');
  }

  // --- absent funnel-velocity module -> medianResponseDays omitted/null, statusLog false, no crash ---
  {
    // Synchronous self-test cannot await the dynamic import directly, but we
    // can assert the same contract computeResponsiveness/buildCompanyCards
    // expose when the loader reports statusLog absent (this is exactly what
    // loadStatusLogSource() resolves to on this branch — verified separately
    // by the top-level async CLI run, which never throws).
    const result = computeResponsiveness([row(80, 'NoStatusLogCo', 'Applied', '2026-05-01')], new Map(), { now: NOW, silenceWindowDays: 28 });
    check(result.medianResponseDays === null, 'medianResponseDays is null when not supplied (statusLog absent)');
  }

  // --- --company lookup: known company returns card; unknown returns no-history shape ---
  {
    const result = buildCompanyCards(
      { trackerRows: [row(90, 'KnownCo', 'Rejected', '2026-06-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const known = getCompanyCard(result, 'KnownCo');
    check(known.responsiveness.label === 'responded-before', 'known company lookup returns its real card');

    const unknown = getCompanyCard(result, 'NeverHeardOfThemCo');
    check(unknown.responsiveness.label === 'no-history' && unknown.responsiveness.facts.length === 0, 'unknown company lookup returns the minimal no-history shape');
    check(unknown.postingChurn.label === 'no-scan-data', 'unknown company lookup reports no-scan-data churn when scan-history never loaded');
  }

  // --- distribution-sanity: 5 companies, not everything is silent-on-you ---
  {
    const rows = [
      row(100, 'RespondedA', 'Rejected', '2026-06-01'),
      row(101, 'RespondedB', 'Interview', '2026-06-10'),
      row(102, 'SilentC', 'Applied', '2026-05-01'),
      row(103, 'PendingOnlyD', 'Applied', '2026-07-05'),
      row(104, 'NoHistoryE', 'Evaluated', '2026-06-01'),
    ];
    const result = buildCompanyCards(
      { trackerRows: rows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const labels = result.companies.map(c => c.responsiveness.label);
    check(labels.filter(l => l === 'responded-before').length === 2, 'distribution fixture: 2 companies responded-before');
    check(labels.filter(l => l === 'silent-on-you').length === 1, 'distribution fixture: 1 company silent-on-you');
    check(labels.filter(l => l === 'no-history').length === 2, 'distribution fixture: 2 companies no-history (pending-only + evaluated-only)');
    check(!labels.every(l => l === 'silent-on-you'), 'distribution fixture: NOT everything is silent-on-you');
  }

  // --- vocabulary assertions ---
  {
    const rows = [row(110, 'VocabCo', 'Applied', '2026-01-01')];
    const result = buildCompanyCards(
      { trackerRows: rows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
      { now: NOW, silenceWindowDays: 28 },
    );
    const output = renderSummary(result);
    check(!/risk/i.test(output), 'rendered summary never contains the word "risk"');
    check(!/ghost/i.test(output), 'rendered summary never contains the word "ghost"');
  }

  // --- every silent fact has date + clearInstruction containing "set-status" ---
  {
    const result = computeResponsiveness([row(120, 'ClearCo', 'Applied', '2026-01-01')], new Map(), { now: NOW, silenceWindowDays: 28 });
    const fact = result.facts[0];
    check(!!fact.appliedDate, 'silent fact carries an appliedDate');
    check(typeof fact.clearInstruction === 'string' && fact.clearInstruction.includes('set-status'), 'silent fact clearInstruction references set-status.mjs');
  }

  console.log(`\n  company-history self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { summaryMode, selfTestMode, company, silenceWindowArg, includeStale, scanHistoryOverride, followupsOverride } =
    parseArgs(process.argv);

  if (selfTestMode) {
    runSelfTest();
  } else {
    const run = async () => {
      const tracker = loadTrackerRows(CAREER_OPS);
      const followups = loadFollowupRows(CAREER_OPS, followupsOverride);
      const scanHistory = loadRepostClusters(CAREER_OPS, scanHistoryOverride);
      const statusLog = await loadStatusLogSource();

      const silenceWindowDays = silenceWindowArg !== undefined && Number.isFinite(parseInt(silenceWindowArg, 10))
        ? parseInt(silenceWindowArg, 10)
        : resolveDefaultSilenceWindow(CAREER_OPS);

      const result = buildCompanyCards(
        {
          trackerRows: tracker.rows,
          followupRows: followups.rows,
          repostClusters: scanHistory.clusters,
          sourcesLoaded: {
            tracker: tracker.loaded,
            followups: followups.loaded,
            scanHistory: scanHistory.loaded,
            statusLog: statusLog.loaded,
          },
          statusLogAppliedByNum: statusLog.appliedDateByNum,
          medianResponseDays: statusLog.medianResponseDays,
        },
        { silenceWindowDays, includeStale },
      );

      if (company) {
        console.log(JSON.stringify(getCompanyCard(result, company), null, 2));
        return;
      }

      if (summaryMode) {
        console.log(renderSummary(result));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    };

    run().catch(err => {
      console.error(`company-history.mjs: unexpected error: ${err?.message || err}`);
      process.exit(1);
    });
  }
}
