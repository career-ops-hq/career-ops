#!/usr/bin/env node
/**
 * close-stale.mjs — close long-silent `Applied` tracker rows in bulk (#5794)
 *
 * A tracker used for a long search fills up with `Applied` rows nobody will ever
 * answer. Left as `Applied` they keep reading as "still in flight" to the funnel
 * (`stats.mjs`, `funnel-velocity.mjs`), the follow-up cadence and the dashboard.
 * The convention for closing one already exists — `modes/outcome.md` maps
 * `no_response` to `Discarded` — but only one row at a time. This script applies
 * it to every row that has gone quiet for longer than `--days`.
 *
 * Opt-in and zero-LLM: no network, no schema change.
 *
 * Dry run by default. Nothing is written unless `--confirm` is passed.
 *
 * A row is a candidate only when ALL hold:
 *   - its status resolves to `Applied` (aliases such as "Sent" count);
 *   - it is older than `--days` days (strictly: a row exactly N days old is
 *     kept). Age is measured from the LATEST of the Date column, an
 *     `Applied YYYY-MM-DD` date in Notes, and the day status-log.tsv recorded
 *     the move to Applied, so a late evaluation date never makes an application
 *     look older than it is.
 *
 * A candidate is SKIPPED (and reported with its reason) when it has any later
 * signal that somebody might still be answering:
 *   - `active-interview`   the company has an entry in data/active-interviews.md
 *                          (company match only, with or without the legal
 *                          form; a role mismatch must not close an
 *                          application the user is interviewing for);
 *   - `status-log`         data/status-log.tsv holds a transition after Applied;
 *   - `open-follow-up`     data/follow-ups.md has a follow-up logged for this row
 *                          within the last `--days` days, or an uncleared `next`
 *                          pin dated today or later;
 *   - `previously-auto-closed`  the row was closed by this script before and
 *                          reopened since (the note tag or a `close-stale`
 *                          ledger line is present): the user's reopen wins;
 *   - `duplicate-num`      two rows share the tracker # (#1704), so the ledger
 *                          cannot say which one a transition belongs to.
 *
 * Rows in any other state (Evaluated, Responded, Assessment, Interview, Offer,
 * Hired, Rejected, Discarded, SKIP) are never touched.
 *
 * `--confirm` rewrites each candidate row inside ONE tracker transaction (the
 * same lock and atomic replace dedup-tracker.mjs uses): the Status cell becomes
 * the target state, the fixed tag `no response (auto-closed YYYY-MM-DD, Nd)` is
 * appended to Notes, and one `source=close-stale` line per row is appended to
 * data/status-log.tsv. The tag is how these rows are told apart from real
 * rejections and found again if a reply arrives later. Re-running changes
 * nothing: closed rows are no longer Applied.
 *
 * Run: node close-stale.mjs                        (dry run, JSON to stdout)
 *      node close-stale.mjs --summary              (dry run, human-readable)
 *      node close-stale.mjs --days 45              (cutoff, default 60)
 *      node close-stale.mjs --status Rejected      (target state, default Discarded)
 *      node close-stale.mjs --confirm              (write)
 *      node close-stale.mjs --today 2026-10-17     (deterministic runs/tests)
 *
 * Paths follow CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR / CAREER_OPS_TRACKER.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  resolveColumns, parseTrackerRow, splitTrackerCells, trackerRowSeparator, normalizeTextKey,
} from './tracker-parse.mjs';
import {
  loadCanonicalStates, resolveCanonicalState, openTrackerTransaction, appendLedgerRows, cell,
  companiesMatchIgnoringCorporateForm,
} from './tracker-utils.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { parseActiveInterviews, findColumn } from './process-quality.mjs';
import {
  parseFollowups, parseNextOverrides, resolveNextOverride, parseClearedDirectives, isRetired,
  parseAppliedDate, isRealCalendarDate,
} from './followup-cadence.mjs';
import { parseStatusLog, foldObservations } from './funnel-velocity.mjs';
import { statusLogPath } from './lib/status-hooks.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { localToday } from './lib/local-today.mjs';
import { parseDate } from './lib/parse-date.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const STATES_FILE = join(CODE_ROOT, 'templates/states.yml');

export const DEFAULT_DAYS = 60;
export const DEFAULT_TARGET_STATUS = 'Discarded';
/** The status-log `source` for these transitions; a member of VALID_SOURCES in funnel-velocity.mjs. */
export const LEDGER_SOURCE = 'close-stale';
/** Every tag this script writes starts with this, which is how a reopened row is recognised. */
export const NOTE_TAG_PREFIX = 'no response (auto-closed';
const SAMPLE_SIZE = 10;

const KNOWN_FLAGS = ['--days', '--status', '--today', '--confirm', '--json', '--summary', '--help', '-h'];
const VALUE_FLAGS = ['--days', '--status', '--today'];

const USAGE = `Usage:
  node close-stale.mjs                      # dry run, JSON report
  node close-stale.mjs --summary            # dry run, human-readable report
  node close-stale.mjs --days <N>           # age cutoff in days (default ${DEFAULT_DAYS})
  node close-stale.mjs --status <state>     # target state (default ${DEFAULT_TARGET_STATUS}; any canonical state except Applied)
  node close-stale.mjs --confirm            # write the changes (default is a dry run)
  node close-stale.mjs --today <YYYY-MM-DD> # evaluate as of a fixed date
  node close-stale.mjs --help               # show this message

Only Applied rows older than the cutoff with no later signal are closed. Each
gets the note tag "${NOTE_TAG_PREFIX} YYYY-MM-DD, Nd)" and one status-log line.`;

// ── date helpers (strings in, strings out: no local-timezone arithmetic) ──

/** Whole days from one YYYY-MM-DD to another, both read at UTC midnight. */
export function daysBetween(fromIso, toIso) {
  const a = parseDate(fromIso);
  const b = parseDate(toIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** The ISO day `days` before `iso`. */
export function isoMinusDays(iso, days) {
  const d = parseDate(iso);
  return new Date(d.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** First valid YYYY-MM-DD in a cell, or null. */
function cellDate(value) {
  const m = /\d{4}-\d{2}-\d{2}/.exec(String(value ?? ''));
  return m && isRealCalendarDate(m[0]) ? m[0] : null;
}

/** The note tag for a closure made on `today` with a `days` cutoff. */
export function noteTag(today, days) {
  return `${NOTE_TAG_PREFIX} ${today}, ${days}d)`;
}

// ── signal loaders (pure over text, so tests can drive them directly) ──

/**
 * Company cells that have an entry in data/active-interviews.md.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function interviewCompanies(content) {
  return parseActiveInterviews(content).map((row) => findColumn(row, 'company'));
}

function hasInterview(company, interviewNames) {
  const key = normalizeTextKey(company);
  return interviewNames.some((name) => normalizeTextKey(name) === key
    || companiesMatchIgnoringCorporateForm(name, company));
}

/**
 * Whether data/follow-ups.md holds an open follow-up for the tracker row.
 *
 * "Open" means somebody is still working the application: a follow-up logged
 * within the cutoff window, or a `next #N` pin dated today or later that no
 * later follow-up has superseded and no `cleared` directive has retired. The
 * pin `followup-seed.mjs` writes when a row turns Applied dates a week after the
 * application, so on a stale row it is long past and does not count.
 */
export function hasOpenFollowup(num, { entries, pins, cleared }, { today, cutoff }) {
  const mine = entries.filter((e) => e.appNum === num);
  const last = mine.map((e) => e.date).filter((d) => cellDate(d)).sort().pop() ?? null;
  if (last && last >= cutoff) return true;
  const pinDate = resolveNextOverride(pins.get(num), last);
  if (pinDate && pinDate >= today && !isRetired(cleared.get(num), last)) return true;
  return false;
}

/** Fold a status-log into per-row timelines; `null` when there is no log. */
function loadTimelines(logContent, states) {
  if (!logContent) return new Map();
  return foldObservations(parseStatusLog(logContent, states).observations);
}

// ── core ──

/**
 * Classify every tracker row. Pure: no I/O and no clock read (today is injected).
 *
 * @param {string} trackerMd
 * @param {object} ctx
 * @param {string} ctx.today - YYYY-MM-DD
 * @param {number} ctx.days
 * @param {object[]} ctx.states - loadCanonicalStates() output
 * @param {string[]} [ctx.interviewCompanies]
 * @param {{entries: object[], pins: Map, cleared: Map}} [ctx.followups]
 * @param {Map<number, object[]>} [ctx.timelines] - folded status-log
 * @returns {{appliedRows: number, candidates: object[], skipped: object[], recent: number, undated: number}}
 */
export function classifyRows(trackerMd, ctx) {
  const { today, days, states } = ctx;
  const interviewNames = ctx.interviewCompanies ?? [];
  const followups = ctx.followups ?? { entries: [], pins: new Map(), cleared: new Map() };
  const timelines = ctx.timelines ?? new Map();
  const cutoff = isoMinusDays(today, days);

  const lines = String(trackerMd ?? '').split('\n');
  const options = { allowTabs: true, allowIndentation: true };
  const colmap = resolveColumns(lines, options);

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const row = parseTrackerRow(lines[i], colmap, options);
    if (row) rows.push({ ...row, lineIdx: i });
  }
  const numCounts = new Map();
  for (const r of rows) numCounts.set(r.num, (numCounts.get(r.num) ?? 0) + 1);

  const out = { appliedRows: 0, candidates: [], skipped: [], recent: 0, undated: 0, colmap, lines };
  for (const row of rows) {
    if (resolveCanonicalState(row.status, states) !== 'Applied') continue;
    out.appliedRows++;

    const timeline = timelines.get(row.num) ?? [];
    const lastAppliedIdx = timeline.map((o) => o.to).lastIndexOf('Applied');
    const loggedApplied = lastAppliedIdx === -1 ? null
      : (timeline[lastAppliedIdx].dayMath && isRealCalendarDate(timeline[lastAppliedIdx].date) ? timeline[lastAppliedIdx].date : null);
    const notesApplied = parseAppliedDate(row.notes, { requireValidCalendarDate: true });
    const referenceDate = [cellDate(row.date), notesApplied, loggedApplied].filter(Boolean).sort().pop() ?? null;
    if (!referenceDate) { out.undated++; continue; }

    const ageDays = daysBetween(referenceDate, today);
    // Strictly older than the cutoff: a row exactly `days` old is kept.
    if (ageDays <= days) { out.recent++; continue; }

    const info = { num: row.num, company: row.company, role: row.role, date: row.date, referenceDate, ageDays, lineIdx: row.lineIdx };
    const skip = (reason) => out.skipped.push({ ...info, reason });

    if (numCounts.get(row.num) > 1) { skip('duplicate-num'); continue; }
    if (String(row.notes ?? '').includes(NOTE_TAG_PREFIX) || timeline.some((o) => o.source === LEDGER_SOURCE)) {
      skip('previously-auto-closed'); continue;
    }
    if (hasInterview(row.company, interviewNames)) { skip('active-interview'); continue; }
    const later = lastAppliedIdx === -1
      ? timeline.filter((o) => o.to !== 'Applied' && o.date >= referenceDate)
      : timeline.slice(lastAppliedIdx + 1).filter((o) => o.to !== 'Applied');
    if (later.length > 0) { skip('status-log'); continue; }
    if (hasOpenFollowup(row.num, followups, { today, cutoff })) { skip('open-follow-up'); continue; }

    out.candidates.push(info);
  }
  return out;
}

/**
 * Replace one cell's value, keeping the padding around it (same rule as
 * set-status.mjs's replaceCellValue).
 */
function replaceCellValue(parts, index, value) {
  const original = parts[index] ?? '';
  const trimmed = original.trim();
  if (trimmed) {
    const start = original.indexOf(trimmed);
    parts[index] = original.slice(0, start) + value + original.slice(start + trimmed.length);
  } else if (original.length >= 2) {
    const half = Math.floor(original.length / 2);
    parts[index] = original.slice(0, half) + value + original.slice(half);
  } else {
    parts[index] = ` ${value} `;
  }
}

/**
 * Rewrite the candidate lines: Status cell -> target, tag appended to Notes.
 * Mutates and returns `lines`; touches no other line and no other cell.
 */
export function applyClosures(lines, colmap, candidates, { targetStatus, tag }) {
  for (const c of candidates) {
    const rawLine = lines[c.lineIdx];
    const separator = trackerRowSeparator(rawLine);
    const parts = splitTrackerCells(rawLine);
    while (parts.length <= Math.max(colmap.status, colmap.notes)) parts.push('');
    replaceCellValue(parts, colmap.status, targetStatus);
    const existing = (parts[colmap.notes] ?? '').trim();
    if (!existing.includes(tag)) {
      replaceCellValue(parts, colmap.notes, existing && existing !== '—' && existing !== '-' ? `${existing}; ${tag}` : tag);
    }
    if (separator === '\t') {
      const closing = rawLine.trimEnd().endsWith('|');
      lines[c.lineIdx] = parts[0] + '|' + parts.slice(1, closing ? -1 : undefined).join('\t')
        + (closing ? '|' + parts.at(-1) : '');
    } else {
      lines[c.lineIdx] = parts.join('|');
    }
  }
  return lines;
}

// ── CLI ──

function fail(message, code = 2) {
  console.error(`❌ ${message}`);
  process.exit(code);
}

/**
 * Contents of a file that may legitimately not exist yet.
 *
 * ENOENT is the only failure that means '' here. A user who has never logged a
 * follow-up has no data/follow-ups.md, and that absence is real information:
 * the open-follow-up gate genuinely has nothing to say about any row.
 *
 * Every OTHER failure means the file is THERE and could not be read, and ''
 * would be a lie with teeth. All three of this script's skip signals are read
 * through here — the open-follow-up gate, the active-interview gate and the
 * status-log gate — and each one skips a row by finding evidence IN the file.
 * No evidence found is indistinguishable from no file, so an unreadable
 * follow-ups file does not stop the run: it silently switches off the
 * protection and keeps closing rows. With --confirm that writes `Discarded`
 * over applications the user is still following up on, or still interviewing
 * for, which is the one outcome this script's own header promises cannot
 * happen.
 *
 * So anything that is not ENOENT ends the run. A gate that cannot be evaluated
 * is not a gate that passed.
 */
function readIfExists(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    fail(`cannot read ${path}: ${err.message}. This file decides which rows are skipped, `
      + 'so closing rows without it would disable that check rather than apply it.');
    return '';  // unreachable: fail() exits
  }
}

function loadContext({ dataRoot, trackerPath, today, days, states }) {
  const interviewsPath = existsSync(join(dataRoot, 'data/active-interviews.md'))
    ? join(dataRoot, 'data/active-interviews.md')
    : join(dataRoot, 'active-interviews.md');
  const followupsPath = process.env.CAREER_OPS_FOLLOWUPS || join(dataRoot, 'data/follow-ups.md');
  const followupsMd = readIfExists(followupsPath);
  return {
    today,
    days,
    states,
    interviewCompanies: interviewCompanies(readIfExists(interviewsPath)),
    followups: {
      entries: parseFollowups(followupsMd),
      pins: parseNextOverrides(followupsMd),
      cleared: parseClearedDirectives(followupsMd),
    },
    timelines: loadTimelines(readIfExists(statusLogPath(trackerPath)), states),
  };
}

function skippedByReason(skipped) {
  const counts = {};
  for (const s of skipped) counts[s.reason] = (counts[s.reason] ?? 0) + 1;
  return counts;
}

function publicRow(r) {
  const { lineIdx, ...rest } = r;
  return rest;
}

function printSummary(report) {
  const m = report.metadata;
  console.log(`\nclose-stale — ${m.confirm ? 'CONFIRMED RUN' : 'dry run'} as of ${m.today}\n`);
  console.log(`  Applied rows:            ${m.appliedRows}`);
  console.log(`  Older than ${m.days} days:      ${m.candidates + m.skipped}  (cutoff: before ${m.cutoff})`);
  console.log(`  ${m.confirm ? 'Closed' : 'Would close'} -> ${m.targetStatus}:   ${m.confirm ? m.closed : m.candidates}`);
  console.log(`  Skipped (later signal):  ${m.skipped}`);
  for (const [reason, n] of Object.entries(m.skippedByReason)) console.log(`    - ${reason}: ${n}`);
  if (m.undated) console.log(`  Applied rows with no readable date (left alone): ${m.undated}`);
  if (report.candidates.length) {
    console.log(`\n  Sample (${Math.min(SAMPLE_SIZE, report.candidates.length)} of ${report.candidates.length}, oldest first):`);
    for (const c of report.candidates.slice(0, SAMPLE_SIZE)) {
      console.log(`    #${c.num}  ${c.referenceDate}  ${c.ageDays}d  ${c.company} — ${c.role}`);
    }
  }
  if (!m.confirm && m.candidates > 0) console.log(`\n  Re-run with --confirm to close ${m.candidates} row(s).`);
  console.log('');
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  if (hasFlag(args, '--json') && hasFlag(args, '--summary')) fail('Choose one of --json or --summary.');
  const valueOf = (flag) => (hasFlag(args, flag) ? flagValue(args, flag) : null);

  const todayArg = valueOf('--today');
  if (todayArg !== null && !parseDate(todayArg)) fail(`--today expects YYYY-MM-DD, received "${todayArg}".`);
  const today = todayArg ?? localToday();

  let days = DEFAULT_DAYS;
  const daysArg = valueOf('--days');
  if (daysArg !== null) {
    if (!/^\d+$/.test(daysArg) || !Number.isSafeInteger(Number(daysArg)) || Number(daysArg) < 1) {
      fail(`--days expects a positive whole number of days, received "${daysArg}".`);
    }
    days = Number(daysArg);
  }

  let states;
  try {
    states = loadCanonicalStates(STATES_FILE);
  } catch (err) {
    fail(`Cannot load canonical states from ${STATES_FILE}: ${err.message}`);
  }
  const statusArg = valueOf('--status') ?? DEFAULT_TARGET_STATUS;
  const targetStatus = resolveCanonicalState(statusArg, states);
  if (!targetStatus) {
    fail(`"${statusArg}" is not a canonical state. Valid states: ${states.map((s) => s.label).join(' · ')}`);
  }
  if (targetStatus === 'Applied') fail('--status Applied would close nothing: pick the state to move stale rows into.');

  const confirm = hasFlag(args, '--confirm');
  const dataRoot = getCareerOpsRoot();
  const trackerPath = resolveTrackerPath(dataRoot);
  const tag = noteTag(today, days);

  const warnings = [];
  let report;
  if (!existsSync(trackerPath)) {
    warnings.push(`No tracker found at ${trackerPath}; nothing to close.`);
    report = buildReport({ classified: { appliedRows: 0, candidates: [], skipped: [], recent: 0, undated: 0 }, today, days, targetStatus, confirm, closed: 0, warnings, trackerPath });
  } else {
    let tx = null;
    let content;
    if (confirm) {
      try {
        tx = await openTrackerTransaction(trackerPath);
      } catch (err) {
        fail(`Cannot acquire the tracker lock: ${err.message}`, err?.code === 'LOCK_TIMEOUT' ? 4 : 2);
      }
    }
    try {
      // Read inside the try so a read failure still releases the lock.
      content = confirm ? tx.read() : readFileSync(trackerPath, 'utf-8');
      // Signals are read INSIDE the lock window on --confirm, so a status-log
      // line a concurrent set-status appends cannot be missed.
      const ctx = loadContext({ dataRoot, trackerPath, today, days, states });
      const classified = classifyRows(content, ctx);
      let closed = 0;
      if (classified.candidates.length && classified.colmap?.notes == null) {
        throw new Error('Tracker has no Notes column — cannot append the auto-closed tag.');
      }
      if (confirm && classified.candidates.length) {
        const newLines = applyClosures([...classified.lines], classified.colmap, classified.candidates, { targetStatus, tag });
        tx.replace(newLines.join('\n'));
        closed = classified.candidates.length;
        // Observation trail only: the tracker stays the source of truth, so a
        // failed append is a warning (same policy as set-status.mjs).
        try {
          const text = classified.candidates
            .map((c) => `${c.num}\t${today}\tApplied\t${targetStatus}\t${LEDGER_SOURCE}\t${cell(`${days}d`)}\n`)
            .join('');
          appendLedgerRows(statusLogPath(trackerPath), text);
        } catch (err) {
          warnings.push(`status-log append failed (tracker was updated): ${err.message}`);
        }
      }
      report = buildReport({ classified, today, days, targetStatus, confirm, closed, warnings, trackerPath });
    } catch (err) {
      // fail() exits the process, which would skip the finally below and leave
      // the tracker lock behind until it goes stale.
      tx?.close();
      fail(err.message);
    } finally {
      tx?.close();
    }
  }

  if (hasFlag(args, '--summary')) {
    printSummary(report);
    for (const w of warnings) console.log(`⚠ ${w}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

function buildReport({ classified, today, days, targetStatus, confirm, closed, warnings, trackerPath }) {
  const candidates = [...classified.candidates].sort((a, b) => b.ageDays - a.ageDays || a.num - b.num);
  return {
    metadata: {
      today,
      days,
      cutoff: isoMinusDays(today, days),
      targetStatus,
      confirm,
      trackerPath,
      appliedRows: classified.appliedRows,
      candidates: candidates.length,
      skipped: classified.skipped.length,
      skippedByReason: skippedByReason(classified.skipped),
      recent: classified.recent,
      undated: classified.undated,
      closed,
      noteTag: noteTag(today, days),
    },
    candidates: candidates.map(publicRow),
    skipped: classified.skipped.map(publicRow),
    warnings,
  };
}
