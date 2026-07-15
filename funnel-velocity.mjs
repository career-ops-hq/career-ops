#!/usr/bin/env node
/**
 * funnel-velocity.mjs — Funnel calibration vs market benchmarks + stage velocity
 *
 * Three payloads, decreasing availability:
 *   1. calibration — own funnel rates (canonical ever* definition imported from
 *      stats.mjs) vs candidate-side market benchmark ranges. Works day one.
 *   2. waiting — in-flight Applied rows and elapsed days vs the typical
 *      first-response window. Per-row factual reporting, not an aggregate claim.
 *   3. velocity — median/p75 days per stage hop, folded from the append-only
 *      transition ledger data/status-log.tsv. Accrues value as the log grows.
 *
 * Transition ledger (written by set-status.mjs, never edited in place):
 *   {tracker#}\t{YYYY-MM-DD}\t{from}\t{to}\t{source}\t{note}
 *   - from may be "-" (unknown prior state)
 *   - to "-" retracts the row's latest observation
 *   - source "correction" replaces an earlier same-(num,to) observation
 *   - log path = sibling of the active tracker file (sandbox-safe for tests)
 *
 * Statistical honesty rules (council-reviewed, non-negotiable):
 *   - medians report right-censoring ("n still waiting, excluded") — with 61%
 *     ghosting, completed-only medians are survivorship-biased otherwise
 *   - 0-day hops (same-day catch-up entries) are excluded from medians, counted
 *   - no comparative multiplier claims below n=20 applied
 *   - above-range calibration always carries the selection-bias note
 *   - every benchmark mention carries its year and "directional"
 *
 * Benchmarks lookup order: --benchmarks <path> > config/benchmarks.yml (user
 * layer, survives updates) > templates/benchmarks.yml (shipped default).
 *
 * Run: node funnel-velocity.mjs             (JSON)
 *      node funnel-velocity.mjs --summary   (human-readable)
 *      node funnel-velocity.mjs --self-test
 *      node funnel-velocity.mjs --benchmarks path/to/benchmarks.yml
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { computeFunnel, computeTrackerStats } from './stats.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { resolveTrackerPath, loadCanonicalStates, resolveCanonicalState } from './tracker-utils.mjs';
import { parseAppliedDate } from './followup-cadence.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const STATES_FILE = join(CAREER_OPS, 'templates/states.yml');

const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SOURCES = new Set(['set-status', 'correction', 'backfill', 'manual']);
// Sources whose dates are trusted for day-math. backfill/manual are parsed and
// counted but excluded: they are reconstructed after the fact, not observed.
const DAY_MATH_SOURCES = new Set(['set-status', 'correction']);

// The hops a candidate can measure from their own tracker. Applied→Rejected is
// tracked separately from the forward hops — a "days to terminal" number that
// mixes offers and rejections reads grim and means nothing.
const HOPS = [
  { key: 'appliedToResponded', from: 'Applied', to: 'Responded' },
  { key: 'respondedToInterview', from: 'Responded', to: 'Interview' },
  { key: 'interviewToOffer', from: 'Interview', to: 'Offer' },
  { key: 'appliedToRejected', from: 'Applied', to: 'Rejected' },
];

// Verbatim strings the tone contract pins (also asserted by mode-doc checks).
const SELECTION_BIAS_NOTE = 'targeted applications are expected to beat mass-platform averages — this confirms your filtering works';
const BELOW_RANGE_ACTION = '→ check follow-up compliance (followup mode) or review your score threshold (patterns mode)';
const CLAIM_MIN_N = 20;
const HOP_MIN_N = 3;

// --- Date helpers ---
export function parseISODate(s) {
  if (!DATE_RE.test(String(s ?? '').trim())) return null;
  const d = new Date(`${String(s).trim()}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysBetween(fromStr, toStr) {
  const a = parseISODate(fromStr), b = parseISODate(toStr);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

// --- Ledger parsing ---
// line: {tracker#}\t{YYYY-MM-DD}\t{from}\t{to}\t{source}\t{note}
export function parseStatusLog(content, states) {
  const observations = [];
  const unparseable = [];
  const unknownSources = [];
  const lines = String(content || '').replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#')) continue;
    const cells = t.split('\t').map(c => c.trim());
    if (cells.length < 5) { unparseable.push({ line: i + 1, raw: t, reason: 'expected 5+ tab-separated columns' }); continue; }
    const [numRaw, date, fromRaw, toRaw, source, note = ''] = cells;
    const num = parseInt(numRaw, 10);
    if (!Number.isInteger(num) || String(num) !== numRaw) { unparseable.push({ line: i + 1, raw: t, reason: `bad tracker# "${numRaw}"` }); continue; }
    if (!parseISODate(date)) { unparseable.push({ line: i + 1, raw: t, reason: `bad date "${date}"` }); continue; }
    const from = fromRaw === '-' ? null : resolveCanonicalState(fromRaw, states);
    if (fromRaw !== '-' && !from) { unparseable.push({ line: i + 1, raw: t, reason: `unknown from-state "${fromRaw}"` }); continue; }
    const to = toRaw === '-' ? '-' : resolveCanonicalState(toRaw, states);
    if (toRaw !== '-' && !to) { unparseable.push({ line: i + 1, raw: t, reason: `unknown to-state "${toRaw}"` }); continue; }
    if (!VALID_SOURCES.has(source)) {
      unknownSources.push({ line: i + 1, num, source });
      // Parsed but never fed to day-math; still visible in dataQuality.
      observations.push({ num, date, from, to, source, note, dayMath: false });
      continue;
    }
    observations.push({ num, date, from, to, source, note, dayMath: DAY_MATH_SOURCES.has(source) });
  }
  return { observations, unparseable, unknownSources };
}

/**
 * Fold observations into one ordered timeline per tracker#.
 *
 * Rules (append-only log semantics):
 *   - later `correction` with same (num, to) replaces the earlier observation's
 *     date (the fix for "agent logged the wrong day")
 *   - `to: "-"` retracts the row's latest surviving observation (the fix for
 *     "that transition never happened")
 *   - otherwise observations accumulate in file order (the log IS the order;
 *     dates may legitimately be non-monotonic via --on backdating)
 *
 * @returns Map num -> [{to, date, source, dayMath}]
 */
export function foldObservations(observations) {
  const byNum = new Map();
  for (const obs of observations) {
    if (!byNum.has(obs.num)) byNum.set(obs.num, []);
    const timeline = byNum.get(obs.num);
    if (obs.to === '-') { timeline.pop(); continue; }
    if (obs.source === 'correction') {
      const idx = timeline.map(o => o.to).lastIndexOf(obs.to);
      if (idx !== -1) { timeline[idx] = { to: obs.to, date: obs.date, source: obs.source, dayMath: obs.dayMath }; continue; }
    }
    timeline.push({ to: obs.to, date: obs.date, source: obs.source, dayMath: obs.dayMath });
  }
  // Sort each timeline by date so hop math sees event order, not entry order
  // (--on backdating makes file order unreliable). Stable sort keeps same-day
  // catch-up entries in entry order.
  for (const timeline of byNum.values()) {
    timeline.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return byNum;
}

// --- Percentiles ---
export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// p75 by linear interpolation between closest ranks (R-7, the numpy default).
// Pinned by self-test fixture: [3,6,20] -> 13.
export function p75(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const rank = 0.75 * (s.length - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

// --- Velocity ---
/**
 * Per-hop day stats from folded timelines.
 *
 * A hop measurement = days between a row's dated `from` observation and its
 * next dated `to` observation (both day-math-trusted). Honesty rules:
 *   - 0-day hops excluded from the math, counted (same-day catch-up entries)
 *   - right-censoring: a row sitting in `from` with no later observation
 *     counts as censored for that hop (still waiting — median excludes it and
 *     must say so)
 *   - < HOP_MIN_N completed measurements -> insufficientData, no median
 */
export function computeVelocity(timelines, todayStr) {
  const result = {};
  for (const hop of HOPS) {
    const days = [];
    let sameDayExcluded = 0;
    let censored = 0;
    for (const timeline of timelines.values()) {
      const fromIdx = timeline.findIndex(o => o.to === hop.from && o.dayMath);
      if (fromIdx === -1) continue;
      const next = timeline.slice(fromIdx + 1).find(o => o.to === hop.to && o.dayMath);
      if (next) {
        const d = daysBetween(timeline[fromIdx].date, next.date);
        if (d === null || d < 0) continue;
        if (d === 0) { sameDayExcluded++; continue; }
        days.push(d);
      } else if (fromIdx === timeline.length - 1) {
        // Row's latest state is the hop's from-state: still waiting = censored.
        // Only forward hops censor; Applied→Rejected shares Applied rows with
        // Applied→Responded, so count censoring once (on the forward hop).
        if (hop.to !== 'Rejected') censored++;
      }
    }
    result[hop.key] = {
      from: hop.from,
      to: hop.to,
      n: days.length,
      median: days.length >= HOP_MIN_N ? median(days) : null,
      p75: days.length >= HOP_MIN_N ? p75(days) : null,
      insufficientData: days.length < HOP_MIN_N,
      sameDayExcluded,
      censored,
    };
  }
  return result;
}

// --- Benchmarks ---
export function loadBenchmarks(explicitPath) {
  const path = explicitPath
    || (existsSync(join(CAREER_OPS, 'config/benchmarks.yml')) ? join(CAREER_OPS, 'config/benchmarks.yml') : join(CAREER_OPS, 'templates/benchmarks.yml'));
  let doc;
  try {
    doc = yaml.load(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`Cannot read benchmarks at ${path}: ${err.message}`);
  }
  if (!doc || typeof doc.benchmarks !== 'object' || doc.benchmarks === null) {
    throw new Error(`Malformed benchmarks file at ${path}: expected a top-level "benchmarks" map`);
  }
  return { benchmarks: doc.benchmarks, path };
}

/** Classify an own-rate percentage against a benchmark's range (inclusive). */
export function classify(ownPct, metric) {
  if (ownPct === null || ownPct === undefined || !metric || !Array.isArray(metric.range_pct)) return null;
  const [lo, hi] = metric.range_pct;
  const band = ownPct < lo ? 'below-range' : ownPct > hi ? 'above-range' : 'within-range';
  const typical = metric.typical_pct;
  return {
    band,
    ownPct,
    rangePct: [lo, hi],
    typicalPct: typical ?? null,
    vsTypical: typical ? Math.round((ownPct / typical) * 10) / 10 : null,
    source: metric.source ?? null,
    year: metric.year ?? null,
    caveat: metric.caveat ?? null,
  };
}

// --- Calibration (flagship: works day one, no ledger needed) ---
export function computeCalibration(funnel, benchmarks) {
  const smallSample = funnel.everApplied < CLAIM_MIN_N;
  return {
    everApplied: funnel.everApplied,
    smallSample,
    claimMinN: CLAIM_MIN_N,
    responseRate: classify(funnel.everApplied > 0 ? funnel.responseRate : null, benchmarks.response_rate),
    interviewRate: classify(funnel.everApplied > 0 ? funnel.interviewRate : null, benchmarks.application_to_interview),
  };
}

// --- Waiting (flagship #2: in-flight Applied rows vs first-response window) ---
/**
 * Applied-date priority per row:
 *   1. ledger Applied observation (event-dated via --on, or logged same day)
 *   2. "Applied YYYY-MM-DD" in the tracker notes (followup-cadence convention;
 *      followup-seed/apply modes write it — same helper, same regex)
 *   3. unknown (listed, never guessed — the tracker date column is the
 *      EVALUATION date and must not stand in for the submission date)
 */
export function computeWaiting(rows, timelines, benchmarks, todayStr) {
  const windowDays = benchmarks.days_first_response?.range_days ?? [5, 14];
  const items = [];
  let unknownDates = 0;
  for (const row of rows) {
    if (row.status !== 'Applied') continue;
    const timeline = timelines.get(row.num) || [];
    const ledgerApplied = timeline.filter(o => o.to === 'Applied' && o.dayMath).pop();
    const appliedDate = ledgerApplied?.date ?? parseAppliedDate(row.notes) ?? null;
    if (!appliedDate) { unknownDates++; items.push({ num: row.num, company: row.company, appliedDate: null, elapsedDays: null, beyondTypicalWindow: false, dateSource: 'unknown' }); continue; }
    const elapsed = daysBetween(appliedDate, todayStr);
    items.push({
      num: row.num,
      company: row.company,
      appliedDate,
      elapsedDays: elapsed,
      beyondTypicalWindow: elapsed !== null && elapsed > windowDays[1],
      dateSource: ledgerApplied ? 'status-log' : 'tracker-notes',
    });
  }
  return {
    windowDays,
    windowSource: benchmarks.days_first_response ? { source: benchmarks.days_first_response.source, year: benchmarks.days_first_response.year } : null,
    inFlight: items.length,
    unknownDates,
    items: items.sort((a, b) => (b.elapsedDays ?? -1) - (a.elapsedDays ?? -1)),
  };
}

// --- Tracker rows ---
export function parseTrackerRows(content) {
  const lines = String(content ?? '').replace(/\r/g, '').split('\n');
  const colmap = resolveColumns(lines);
  const rows = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) rows.push(row);
  }
  return rows;
}

// --- Assembly ---
export function analyze({ trackerContent, logContent, benchmarks, states, todayStr }) {
  const rows = parseTrackerRows(trackerContent);
  const stats = computeTrackerStats(trackerContent);
  const funnel = computeFunnel(stats.byStatus);
  const { observations, unparseable, unknownSources } = parseStatusLog(logContent, states);
  const timelines = foldObservations(observations);

  const trackerNums = new Set(rows.map(r => r.num));
  const orphans = [...timelines.keys()].filter(n => !trackerNums.has(n));
  const coveredRows = [...timelines.keys()].filter(n => trackerNums.has(n)).length;
  const newestObs = observations.reduce((max, o) => (o.date > max ? o.date : max), '');

  const velocity = computeVelocity(timelines, todayStr);
  // The one hop with a candidate-side day benchmark gets it attached, so the
  // renderer can show market context next to the own-median (same denominator:
  // per-successful-process). Gated on an existing median: with insufficientData
  // the JSON output would otherwise leak a benchmark next to a null median.
  const io = benchmarks.days_interview_to_offer;
  if (io && Array.isArray(io.range_days) && velocity.interviewToOffer.median !== null) {
    velocity.interviewToOffer.benchmark = {
      rangeDays: io.range_days,
      typicalDays: io.typical_days ?? null,
      source: io.source ?? null,
      year: io.year ?? null,
    };
  }

  return {
    calibration: computeCalibration(funnel, benchmarks),
    waiting: computeWaiting(rows, timelines, benchmarks, todayStr),
    velocity,
    dataQuality: {
      trackerRows: rows.length,
      coveredRows,
      observations: observations.length,
      orphans,
      unparseable,
      unknownSources,
      newestObservation: newestObs || null,
    },
  };
}

// --- Summary rendering (tone contract lives here — see header) ---
function fmtCalibrationLine(label, c, smallSample, n) {
  if (!c || c.ownPct === null) return `  ${label}: no data yet`;
  const range = `${c.rangePct[0]}–${c.rangePct[1]}% typical band (${c.year ?? 'n/a'}, directional)`;
  let line = `  ${label}: ${c.ownPct}% vs ${range}`;
  if (smallSample) {
    line += ` — small sample (n=${n}) — directional only`;
    return line;
  }
  if (c.band === 'above-range') {
    line += ` — above the typical band${c.vsTypical ? `, ${c.vsTypical}× typical` : ''} (${SELECTION_BIAS_NOTE})`;
  } else if (c.band === 'below-range') {
    line += ` — below the typical band ${BELOW_RANGE_ACTION}`;
  } else {
    line += ' — within the typical band';
  }
  return line;
}

export function renderSummary(result, todayStr) {
  const out = [];
  const { calibration: cal, waiting, velocity, dataQuality: dq } = result;
  out.push('━'.repeat(46));
  out.push(`Funnel Calibration — ${todayStr}`);
  out.push('━'.repeat(46));

  out.push('\nCalibration (your funnel vs market):');
  if (cal.everApplied === 0) {
    out.push('  no applications sent yet — calibration starts at your first Applied row');
  } else {
    out.push(fmtCalibrationLine('Response rate', cal.responseRate, cal.smallSample, cal.everApplied));
    out.push(fmtCalibrationLine('Interview rate', cal.interviewRate, cal.smallSample, cal.everApplied));
    if (cal.smallSample) out.push(`  (comparative claims need n≥${cal.claimMinN} applied; you have ${cal.everApplied})`);
  }

  out.push('\nWaiting (in-flight applications):');
  if (!waiting.inFlight) {
    out.push('  none in Applied right now');
  } else {
    out.push(`  ${waiting.inFlight} in flight. Typical first-response window: ${waiting.windowDays[0]}–${waiting.windowDays[1]} days (${waiting.windowSource?.year ?? 'n/a'}, directional; many applications never get a response — silence is common, not a verdict).`);
    for (const item of waiting.items) {
      if (item.appliedDate === null) { out.push(`  #${item.num} ${item.company} — applied date unknown (no dated Applied observation; add "Applied YYYY-MM-DD" to its notes or use set-status)`); continue; }
      const flag = item.beyondTypicalWindow ? `, beyond typical ${waiting.windowDays[0]}–${waiting.windowDays[1]}d window → consider followup mode` : '';
      out.push(`  #${item.num} ${item.company} — applied ${item.appliedDate} (${item.elapsedDays}d${flag})`);
    }
  }

  out.push('\nVelocity (days per stage, from the transition ledger):');
  const hopsWithData = Object.values(velocity).filter(h => !h.insufficientData);
  for (const h of Object.values(velocity)) {
    const extras = [];
    if (h.censored) extras.push(`${h.censored} still waiting, excluded`);
    if (h.sameDayExcluded) extras.push(`${h.sameDayExcluded} same-day catch-up entr${h.sameDayExcluded === 1 ? 'y' : 'ies'} excluded`);
    const extraStr = extras.length ? `; ${extras.join('; ')}` : '';
    if (h.insufficientData) {
      out.push(`  ${h.from}→${h.to}: insufficient data (n=${h.n}${extraStr})`);
    } else {
      const bm = h.benchmark ? ` vs ${h.benchmark.rangeDays[0]}–${h.benchmark.rangeDays[1]}d typical (${h.benchmark.year ?? 'n/a'}, directional)` : '';
      out.push(`  ${h.from}→${h.to}: median ${h.median}d, p75 ${h.p75}d${bm} (n=${h.n} completed${extraStr} — median reflects answered applications only)`);
    }
  }
  if (!hopsWithData.length && dq.observations === 0) {
    out.push('  ledger is empty — velocity accrues as statuses change through set-status.mjs');
  }

  out.push('\nData quality:');
  out.push(`  velocity data for ${dq.coveredRows} of ${dq.trackerRows} tracker rows (rows predating the log or edited outside set-status have no dated transitions)`);
  if (dq.unparseable.length) {
    out.push(`  ⚠ ${dq.unparseable.length} unparseable ledger line${dq.unparseable.length === 1 ? '' : 's'}:`);
    for (const u of dq.unparseable) out.push(`      line ${u.line}: ${u.reason}`);
  } else out.push('  unparseable ledger lines: none');
  if (dq.unknownSources.length) {
    out.push(`  ⚠ ${dq.unknownSources.length} observation${dq.unknownSources.length === 1 ? '' : 's'} with unrecognized source (excluded from day-math):`);
    for (const s of dq.unknownSources) out.push(`      line ${s.line}: #${s.num} source "${s.source}"`);
  } else out.push('  unrecognized sources: none');
  if (dq.orphans.length) {
    out.push(`  ⚠ ${dq.orphans.length} orphaned tracker#${dq.orphans.length === 1 ? '' : 's'} in the ledger (renumbering/dedup can strand them): ${dq.orphans.map(n => `#${n}`).join(', ')}`);
  } else out.push('  orphaned ledger entries: none');
  if (dq.newestObservation) out.push(`  newest observation: ${dq.newestObservation}`);
  out.push('');
  return out.join('\n');
}

// --- Self-test ---
function selfTest() {
  let failures = 0;
  const check = (cond, msg) => {
    if (!cond) { console.error(`SELF-TEST FAIL: ${msg}`); failures++; }
  };
  const states = loadCanonicalStates(STATES_FILE);
  const TODAY = '2026-07-08';

  // -- parser --
  const LOG_FIXTURE = [
    '1\t2026-06-01\tEvaluated\tApplied\tset-status\t',
    '1\t2026-06-08\tApplied\tResponded\tset-status\t',
    '1\t2026-06-15\tResponded\tInterview\tset-status\t',
    '1\t2026-06-30\tInterview\tOffer\tset-status\t',
    '2\t2026-06-01\t-\tApplied\tset-status\tunknown prior state',
    '2\t2026-06-11\tApplied\tResponded\tset-status\t',
    '2\t2026-06-09\tApplied\tResponded\tcorrection\tthey actually replied on the 9th',
    '3\t2026-06-05\tEvaluated\tApplied\tset-status\t',
    '3\t2026-06-05\tApplied\tResponded\tset-status\tsame-day catch-up',
    '4\t2026-06-20\tEvaluated\tApplied\tset-status\t',
    '5\t2026-06-01\tEvaluated\tApplied\tset-status\t',
    '5\t2026-06-02\tApplied\tInterview\tset-status\tmis-click',
    '5\t2026-06-02\t-\t-\tset-status\tretract the mis-click',
    '6\t2026-06-03\tEvaluated\tApplied\tfuture-import\tunknown source on purpose',
    '99\t2026-06-01\tEvaluated\tApplied\tset-status\torphan - not in tracker',
    'x\t2026-06-01\tEvaluated\tApplied\tset-status\tbad num',
    '7\t06/01/2026\tEvaluated\tApplied\tset-status\tbad date',
    '8\t2026-06-01\tEvaluated\tShortlisted\tset-status\tnon-canonical state',
    '',
    '# comment line',
  ].join('\n');

  const { observations, unparseable, unknownSources } = parseStatusLog(LOG_FIXTURE, states);
  check(unparseable.length === 3, `parser: expected 3 unparseable, got ${unparseable.length}`);
  check(unparseable.some(u => u.reason.includes('bad tracker#')), 'parser: bad num reported');
  check(unparseable.some(u => u.reason.includes('bad date')), 'parser: bad date reported');
  check(unparseable.some(u => u.reason.includes('unknown to-state')), 'parser: non-canonical state reported');
  check(unknownSources.length === 1 && unknownSources[0].source === 'future-import', 'parser: unknown source counted');
  check(observations.find(o => o.source === 'future-import')?.dayMath === false, 'parser: unknown source excluded from day-math');
  check(observations.find(o => o.num === 2 && o.from === null), 'parser: "-" from-state parses as null');

  // -- fold --
  const timelines = foldObservations(observations);
  const t2 = timelines.get(2);
  check(t2.length === 2, `fold: row 2 expected 2 observations, got ${t2.length}`);
  check(t2[1].date === '2026-06-09' && t2[1].source === 'correction', 'fold: correction replaces same-(num,to) date');
  const t5 = timelines.get(5);
  check(t5.length === 1 && t5[0].to === 'Applied', `fold: retraction removes latest observation (got ${t5.map(o => o.to).join(',')})`);

  // -- percentiles --
  check(median([3, 6, 20]) === 6, 'median odd');
  check(median([3, 6]) === 4.5, 'median even');
  check(p75([3, 6, 20]) === 13, `p75 interpolation: expected 13, got ${p75([3, 6, 20])}`);
  check(p75([5]) === 5, 'p75 single value');

  // -- velocity --
  const velocity = computeVelocity(timelines, TODAY);
  check(velocity.appliedToResponded.n === 2, `velocity: A→R expected n=2 (rows 1,2), got ${velocity.appliedToResponded.n}`);
  check(velocity.appliedToResponded.insufficientData === true, 'velocity: n=2 < 3 → insufficient');
  check(velocity.appliedToResponded.median === null, 'velocity: insufficient → no median');
  check(velocity.appliedToResponded.sameDayExcluded === 1, `velocity: row 3 same-day hop excluded+counted, got ${velocity.appliedToResponded.sameDayExcluded}`);
  // rows 4, 5, 99 sit in Applied with no later observation → censored (still waiting)
  check(velocity.appliedToResponded.censored === 3, `velocity: expected 3 censored, got ${velocity.appliedToResponded.censored}`);
  check(velocity.appliedToRejected.censored === 0, 'velocity: rejection hop does not double-count censoring');
  check(velocity.interviewToOffer.n === 1 && velocity.interviewToOffer.insufficientData, 'velocity: I→O n=1 insufficient');

  // three completed A→R measurements → median renders
  const logWithThird = LOG_FIXTURE + '\n4\t2026-06-27\tApplied\tResponded\tset-status\t';
  const v3 = computeVelocity(foldObservations(parseStatusLog(logWithThird, states).observations), TODAY);
  check(v3.appliedToResponded.n === 3 && v3.appliedToResponded.median === 7, `velocity: [7,8,7] → median 7, got n=${v3.appliedToResponded.n} median=${v3.appliedToResponded.median}`);
  check(v3.appliedToResponded.censored === 2, 'velocity: censored drops to 2 after row 4 completes');

  // -- benchmarks + classification --
  const bm = loadBenchmarks(join(CAREER_OPS, 'templates/benchmarks.yml')).benchmarks;
  check(bm.response_rate && Array.isArray(bm.response_rate.range_pct), 'benchmarks: shipped file loads');
  check(bm.days_first_response.range_days[1] === 14, 'benchmarks: first-response window upper bound');
  check(!('time_to_fill' in bm), 'benchmarks: employer-side time_to_fill must not exist');
  check(classify(1.5, bm.response_rate).band === 'below-range', 'classify: below');
  check(classify(6, bm.response_rate).band === 'within-range', 'classify: within');
  check(classify(14, bm.response_rate).band === 'above-range', 'classify: above');
  check(classify(2, bm.response_rate).band === 'within-range', 'classify: lower bound inclusive');
  check(classify(13, bm.response_rate).band === 'within-range', 'classify: upper bound inclusive');
  check(classify(6, bm.response_rate).vsTypical === 2, 'classify: vsTypical multiplier');

  // -- calibration gating --
  const mkTracker = (applied, responded) => {
    const header = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|';
    const rows = [];
    let n = 1;
    for (let i = 0; i < applied; i++) rows.push(`| ${n++} | 2026-06-01 | Co${n} | Role | 4.0/5 | Applied | ❌ | - | |`);
    for (let i = 0; i < responded; i++) rows.push(`| ${n++} | 2026-06-01 | Co${n} | Role | 4.0/5 | Responded | ❌ | - | Applied 2026-06-01 |`);
    return `${header}\n${rows.join('\n')}`;
  };
  const small = analyze({ trackerContent: mkTracker(16, 1), logContent: '', benchmarks: bm, states, todayStr: TODAY });
  check(small.calibration.smallSample === true, 'calibration: n=17 < 20 → smallSample');
  const smallSummary = renderSummary(small, TODAY);
  check(!/[\d.]+× typical/.test(smallSummary), 'tone: no multiplier claim under n=20');
  check(smallSummary.includes('directional only'), 'tone: small-sample label present');

  const big = analyze({ trackerContent: mkTracker(38, 2), logContent: '', benchmarks: bm, states, todayStr: TODAY });
  check(big.calibration.smallSample === false, 'calibration: n=40 → claims allowed');
  check(big.calibration.responseRate.ownPct === 5, `calibration: 2/40 = 5%, got ${big.calibration.responseRate.ownPct}`);
  const bigSummary = renderSummary(big, TODAY);
  check(bigSummary.includes('within the typical band'), 'tone: within-band phrasing');

  // above-range → selection-bias note; below-range → single action pointer
  const above = renderSummary(analyze({ trackerContent: mkTracker(25, 15), logContent: '', benchmarks: bm, states, todayStr: TODAY }), TODAY);
  check(above.includes(SELECTION_BIAS_NOTE), 'tone: above-range carries selection-bias note');
  const below = renderSummary(analyze({ trackerContent: mkTracker(40, 0), logContent: '', benchmarks: bm, states, todayStr: TODAY }), TODAY);
  check(below.includes(BELOW_RANGE_ACTION), 'tone: below-range carries the single action pointer');
  check(below.includes('(2025, directional)'), 'tone: benchmark year + directional attached');

  // -- waiting --
  const waitTracker = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-06-01 | LogCo | Role | 4.0/5 | Applied | ❌ | - | |',
    '| 2 | 2026-06-01 | NotesCo | Role | 4.0/5 | Applied | ❌ | - | Applied 2026-07-01 |',
    '| 3 | 2026-06-01 | UnknownCo | Role | 4.0/5 | Applied | ❌ | - | evaluated only |',
    '| 4 | 2026-06-01 | DoneCo | Role | 4.0/5 | Responded | ❌ | - | Applied 2026-06-01 |',
  ].join('\n');
  const waitLog = '1\t2026-06-10\tEvaluated\tApplied\tset-status\t';
  const wait = analyze({ trackerContent: waitTracker, logContent: waitLog, benchmarks: bm, states, todayStr: TODAY }).waiting;
  check(wait.inFlight === 3, `waiting: 3 Applied rows in flight, got ${wait.inFlight}`);
  const w1 = wait.items.find(i => i.num === 1);
  check(w1.dateSource === 'status-log' && w1.appliedDate === '2026-06-10', 'waiting: ledger date wins');
  check(w1.elapsedDays === 28 && w1.beyondTypicalWindow === true, `waiting: 28d beyond 14d window, got ${w1.elapsedDays}`);
  const w2 = wait.items.find(i => i.num === 2);
  check(w2.dateSource === 'tracker-notes' && w2.elapsedDays === 7 && w2.beyondTypicalWindow === false, 'waiting: notes date fallback, within window');
  const w3 = wait.items.find(i => i.num === 3);
  check(w3.dateSource === 'unknown' && w3.appliedDate === null, 'waiting: unknown date listed, never guessed');
  check(!wait.items.some(i => i.num === 4), 'waiting: non-Applied rows excluded');

  // -- data quality --
  const dq = analyze({ trackerContent: waitTracker, logContent: LOG_FIXTURE, benchmarks: bm, states, todayStr: TODAY }).dataQuality;
  check(dq.orphans.length >= 1 && dq.orphans.includes(99), 'dataQuality: orphan #99 surfaced');
  check(dq.unparseable.length === 3, 'dataQuality: unparseable lines surfaced');
  check(dq.newestObservation === '2026-06-30', `dataQuality: newest observation, got ${dq.newestObservation}`);
  const dqSummary = renderSummary(analyze({ trackerContent: waitTracker, logContent: LOG_FIXTURE, benchmarks: bm, states, todayStr: TODAY }), TODAY);
  check(dqSummary.includes('velocity data for'), 'summary: coverage line present');
  check(dqSummary.includes('still waiting, excluded'), 'summary: censoring surfaced next to velocity');

  // -- interview→offer day benchmark wiring --
  const ioLog = [
    '1\t2026-05-01\tResponded\tInterview\tset-status\t',
    '1\t2026-05-22\tInterview\tOffer\tset-status\t',
    '2\t2026-05-01\tResponded\tInterview\tset-status\t',
    '2\t2026-05-26\tInterview\tOffer\tset-status\t',
    '3\t2026-05-01\tResponded\tInterview\tset-status\t',
    '3\t2026-05-31\tInterview\tOffer\tset-status\t',
  ].join('\n');
  const ioResult = analyze({ trackerContent: waitTracker, logContent: ioLog, benchmarks: bm, states, todayStr: TODAY });
  check(ioResult.velocity.interviewToOffer.benchmark?.rangeDays?.[0] === 20, 'io-benchmark: days_interview_to_offer attached to the hop');
  check(ioResult.velocity.interviewToOffer.n === 3 && ioResult.velocity.interviewToOffer.median === 25, `io-benchmark: [21,25,30] → median 25, got ${ioResult.velocity.interviewToOffer.median}`);
  const ioSummary = renderSummary(ioResult, TODAY);
  check(ioSummary.includes('vs 20–28d typical (2019, directional)'), 'io-benchmark: summary carries the benchmark with year + directional');
  check(!renderSummary(analyze({ trackerContent: waitTracker, logContent: '', benchmarks: bm, states, todayStr: TODAY }), TODAY).includes('20–28d typical'), 'io-benchmark: no benchmark context without a median (claims stay gated)');
  // n=1 I→O hop → insufficientData, median null → benchmark must not leak into JSON output
  const ioInsufficient = analyze({ trackerContent: waitTracker, logContent: LOG_FIXTURE, benchmarks: bm, states, todayStr: TODAY });
  check(ioInsufficient.velocity.interviewToOffer.insufficientData === true && !('benchmark' in ioInsufficient.velocity.interviewToOffer), 'io-benchmark: not attached when median is null (JSON output stays gated)');

  // -- missing year in a user-override benchmark file must render n/a, not null --
  const bmNoYear = JSON.parse(JSON.stringify(bm));
  delete bmNoYear.response_rate.year;
  delete bmNoYear.application_to_interview.year;
  delete bmNoYear.days_interview_to_offer.year;
  const noYearSummary = renderSummary(analyze({ trackerContent: mkTracker(40, 0), logContent: ioLog, benchmarks: bmNoYear, states, todayStr: TODAY }), TODAY);
  check(noYearSummary.includes('(n/a, directional)'), 'no-year: renders n/a fallback');
  check(!noYearSummary.includes('null, directional'), 'no-year: never prints (null, directional)');

  // -- empty state --
  const empty = analyze({ trackerContent: '', logContent: '', benchmarks: bm, states, todayStr: TODAY });
  check(empty.calibration.everApplied === 0, 'empty: zero applied');
  const emptySummary = renderSummary(empty, TODAY);
  check(emptySummary.includes('calibration starts at your first Applied row'), 'empty: friendly zero state');
  check(emptySummary.includes('ledger is empty'), 'empty: ledger explainer');

  if (failures) { console.error(`\n${failures} self-test failure(s)`); process.exit(1); }
  console.log('funnel-velocity self-test OK (parser + fold + percentiles + velocity/censoring + benchmarks + calibration gating + waiting + tone contract)');
}

// --- Main ---
function flagValue(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
}

function main() {
  if (selfTestMode) { selfTest(); return; }

  let benchmarks;
  try {
    benchmarks = loadBenchmarks(flagValue('--benchmarks')).benchmarks;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  const states = loadCanonicalStates(STATES_FILE);
  const trackerPath = resolveTrackerPath(CAREER_OPS);
  const logPath = join(dirname(trackerPath), 'status-log.tsv');
  const trackerContent = existsSync(trackerPath) ? readFileSync(trackerPath, 'utf-8') : '';
  const logContent = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
  const todayStr = new Date().toISOString().slice(0, 10);

  if (!trackerContent) {
    if (summaryMode) console.log(`No tracker found at ${trackerPath} — nothing to calibrate yet.`);
    else console.log(JSON.stringify({ calibration: null, waiting: null, velocity: null, dataQuality: { trackerRows: 0, note: `no tracker at ${trackerPath}` } }, null, 2));
    return;
  }

  const result = analyze({ trackerContent, logContent, benchmarks, states, todayStr });
  if (summaryMode) console.log(renderSummary(result, todayStr));
  else console.log(JSON.stringify({ ...result, generatedAt: todayStr }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
