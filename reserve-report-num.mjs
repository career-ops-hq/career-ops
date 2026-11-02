#!/usr/bin/env node

/**
 * reserve-report-num.mjs - shared atomic report-number allocator.
 *
 * The CLI and every evaluator use the exported API below. Reservations account
 * for report files, reservation sentinels, tracker row IDs, report links in
 * the tracker, and tracker numbers the ledgers still name after their row was
 * deleted or merged away (status-log.tsv, follow-ups.md,
 * salary-observations.tsv, contacts.tsv). The tracker scan and sentinel
 * creation run under the same lock as tracker writers, while O_CREAT|O_EXCL
 * keeps claims atomic across processes.
 *
 * Usage:
 *   node reserve-report-num.mjs
 *   node reserve-report-num.mjs --count 8
 *   node reserve-report-num.mjs --release 035
 *   node reserve-report-num.mjs --release 042-049
 *   node reserve-report-num.mjs --gc
 *
 * Unrecognized arguments are rejected (exit 1, nothing reserved).
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  statSync, unlinkSync, writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot } from './path-resolver.mjs';
import {
  extractTrackerReportNumbers, parseTrackerRow, resolveColumns,
} from './tracker-parse.mjs';
import {
  acquireTrackerLock, canonicalizeTrackerPath, resolveTrackerPath, trackerLockDirFor,
} from './tracker-utils.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = getCareerOpsRoot();
const MAX_SENTINEL_AGE_MS = 4 * 60 * 60 * 1000;
const MAX_RETRIES = 50;
const MAX_COUNT = 50;
const RESERVATION_TOKEN = Symbol('career-ops-report-reservation-token');
const USAGE_LINES = [
  'Usage: node reserve-report-num.mjs [--count <1-N>] [--release <NNN>[-<MMM>]] [--gc]',
  '',
  '  (no flags)                Reserve 1 report number (default)',
  `  --count <1-${MAX_COUNT}>            Reserve N report numbers, printed as a range`,
  '  --release <NNN>[-<MMM>]  Release a previously reserved number or range',
  '  --gc                      Garbage-collect stale reservation sentinels',
  '',
];

/** Format a report ID with a minimum width of three digits. */
export function formatReportNumber(num) {
  if (!Number.isSafeInteger(num) || num < 1) {
    throw new TypeError(`Report number must be a positive integer, got ${num}`);
  }
  return String(num).padStart(3, '0');
}

function reportsDirFor(options = {}) {
  return resolve(options.reportsDir
    || process.env.CAREER_OPS_REPORTS_DIR
    || join(options.rootDir || ROOT, 'reports'));
}

function trackerPathFor(options = {}) {
  return options.trackerPath
    ? canonicalizeTrackerPath(options.trackerPath)
    : resolveTrackerPath(options.rootDir || ROOT);
}

function batchStateFileFor(options = {}) {
  return resolve(options.batchStateFile
    || process.env.CAREER_OPS_BATCH_STATE
    || join(options.rootDir || ROOT, 'batch/batch-state.tsv'));
}

// Mirrors merge-tracker.mjs's loadFailedReportNumbers: a report number the
// batch runner itself recorded as "failed" must not be handed out again, or
// the two scripts disagree by construction — this script re-issues the
// number, then merge-tracker.mjs refuses to merge a tracker line for it.
function occupiedFromFailedBatchState(batchStateFile) {
  const failed = new Set();
  if (!existsSync(batchStateFile)) return failed;
  for (const line of readFileSync(batchStateFile, 'utf-8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('id\t')) continue;
    const cols = line.split('\t');
    if (cols.length < 6) continue;
    const status = cols[2];
    const reportNum = cols[5];
    if (status === 'failed' && reportNum && reportNum !== '-') {
      // Digits only, positive, safe: parseInt would accept "12abc" and
      // 9007199254740992, and an unsafe number in the occupied set makes
      // reserveReportNumbers throw "No safe report-number range remains".
      const n = /^\d+$/.test(reportNum) ? Number(reportNum) : NaN;
      if (Number.isSafeInteger(n) && n > 0) failed.add(n);
    }
  }
  return failed;
}

// A bare date file is not a report. `scan-ats-full.mjs --md-out reports/` writes
// its digest as `reports/YYYY-MM-DD.md`, which matches `/^(\d+)-/` and is read
// as report #2026 — pushing every later reservation to 2027+, silently and
// permanently.
//
// Deliberately narrow: report filenames in the wild are not all
// `NNN-slug-DATE.md` (`1001-taken.md` and `NNN-RESERVED.md` are both real), so
// requiring a trailing date would drop legitimate occupancy. Exclude only names
// that are *entirely* a date. See tests/reserve-report-num.test.mjs.
const BARE_DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

function occupiedFromReports(reportsDir) {
  const occupied = new Set();
  if (!existsSync(reportsDir)) return occupied;
  for (const name of readdirSync(reportsDir)) {
    if (BARE_DATE_FILE_RE.test(name)) continue;
    const match = name.match(/^(\d+)-/);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    if (Number.isInteger(num) && num > 0) occupied.add(num);
  }
  return occupied;
}

function occupiedFromTracker(trackerPath) {
  const occupied = new Set();
  if (!existsSync(trackerPath)) return occupied;

  const lines = readFileSync(trackerPath, 'utf-8').split(/\r?\n/);
  const colmap = resolveColumns(lines);
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    if (row.num > 0) occupied.add(row.num);
    for (const reportNum of extractTrackerReportNumbers(row.report)) {
      if (reportNum > 0) occupied.add(reportNum);
    }
  }
  return occupied;
}

// Tracker numbers the ledgers still key on. `tracker.mjs delete` and
// dedup-tracker.mjs remove a row but leave its status-log lines, follow-ups,
// salary observations and contacts under its old number. Handing that number
// to a new row would give the new application the old one's history, so a
// number any of them still names stays taken even once its row is gone.
const LEDGER_NUM_RE = /^\d+$/;
// The three non-table line shapes followup-cadence.mjs reads an application
// number from: a legacy bullet (`- 2026-10-09 · #12 Acme — note`, BULLET_RE),
// a pin (`- next #12 2026-10-20`, OVERRIDE_RE) and a clear
// (`- cleared #12 2026-10-21`, CLEARED_RE). Any other `#N` in the file is
// prose, not a reference.
const FOLLOWUP_LINE_NUM_RES = [
  /^-\s+\d{4}-\d{2}-\d{2}\s+·\s+#(\d+)\s/,
  /^-\s+(?:next|cleared)\s+#(\d+)\s+\d{4}-\d{2}-\d{2}/i,
];

function ledgerPathsFor(trackerPath, options = {}) {
  const dataDir = join(options.rootDir || ROOT, 'data');
  return {
    // Beside the tracker, as lib/status-hooks.mjs statusLogPath() writes it.
    statusLog: join(dirname(trackerPath), 'status-log.tsv'),
    // Every place a follow-up can land. A status change seeds it beside the
    // tracker (lib/status-hooks.mjs seedFollowupOnApplied); followup-seed and
    // the readers default to the data root's data/follow-ups.md or honor
    // CAREER_OPS_FOLLOWUPS. These are one file in the default layout and
    // split when the tracker lives elsewhere, so count each distinct one.
    followups: [...new Set([
      process.env.CAREER_OPS_FOLLOWUPS,
      join(dataDir, 'follow-ups.md'),
      join(dirname(trackerPath), 'follow-ups.md'),
    ].filter(Boolean).map(p => resolve(p)))],
    salary: join(dataDir, 'salary-observations.tsv'),
    contacts: join(dataDir, 'contacts.tsv'),
  };
}

// A missing ledger is normal (most installs never write one). Any other read
// failure propagates: treating an unreadable ledger as empty is exactly how a
// number it names would be handed out again.
function readLines(path) {
  try {
    return readFileSync(path, 'utf-8').split(/\r?\n/);
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

function addLedgerNum(occupied, cell) {
  const raw = String(cell ?? '').trim();
  if (!LEDGER_NUM_RE.test(raw)) return;
  const n = Number(raw);
  if (Number.isSafeInteger(n) && n > 0) occupied.add(n);
}

export function occupiedTrackerNumbersFromLedgers(trackerPath, options = {}) {
  const occupied = new Set();
  const paths = ledgerPathsFor(trackerPath, options);
  // status-log.tsv and salary-observations.tsv: tracker# in column 1.
  for (const path of [paths.statusLog, paths.salary]) {
    for (const line of readLines(path)) addLedgerNum(occupied, line.split('\t')[0]);
  }
  // contacts.tsv: tracker# in column 8, `-` for no application.
  for (const line of readLines(paths.contacts)) addLedgerNum(occupied, line.split('\t')[7]);
  // follow-ups.md: table rows are `| num | appNum | ...`.
  for (const line of paths.followups.flatMap(readLines)) {
    if (line.startsWith('|')) {
      const parts = line.split('|');
      if (LEDGER_NUM_RE.test(String(parts[1] ?? '').trim())) addLedgerNum(occupied, parts[2]);
      continue;
    }
    for (const re of FOLLOWUP_LINE_NUM_RES) {
      const m = line.match(re);
      if (m) { addLedgerNum(occupied, m[1]); break; }
    }
  }
  return occupied;
}

function collectOccupied(reportsDir, trackerPath, batchStateFile, options) {
  const occupied = occupiedFromReports(reportsDir);
  for (const num of occupiedFromTracker(trackerPath)) occupied.add(num);
  for (const num of occupiedFromFailedBatchState(batchStateFile)) occupied.add(num);
  for (const num of occupiedTrackerNumbersFromLedgers(trackerPath, options)) occupied.add(num);
  return occupied;
}

function highestNumber(numbers) {
  let max = 0;
  for (const num of numbers) max = Math.max(max, num);
  return max;
}

function sentinelPath(reportsDir, num) {
  return join(reportsDir, `${formatReportNumber(num)}-RESERVED.md`);
}

function claimSlot(reportsDir, num, occupied, token) {
  if (occupied.has(num)) return false;
  try {
    writeFileSync(sentinelPath(reportsDir, num), JSON.stringify({
      pid: process.pid,
      token,
      created_at: new Date().toISOString(),
    }), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err?.code === 'EEXIST') return false;
    throw err;
  }
}

function readSentinelOwner(sentinel) {
  try {
    return JSON.parse(readFileSync(sentinel, 'utf-8'));
  } catch {
    return null;
  }
}

function releaseSlot(reportsDir, num, { token, force = false } = {}) {
  const sentinel = sentinelPath(reportsDir, num);
  try {
    if (!force && readSentinelOwner(sentinel)?.token !== token) return false;
    unlinkSync(sentinel);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Reserve one or more contiguous report IDs.
 *
 * @param {number} [count=1] Number of IDs to reserve (1-50).
 * @param {object} [options] Path and lock overrides.
 * @returns {Promise<number[]>} Reserved numeric IDs.
 */
export async function reserveReportNumbers(count = 1, options = {}) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new RangeError(`Reservation count must be an integer from 1 to ${MAX_COUNT}`);
  }

  const reportsDir = reportsDirFor(options);
  const trackerPath = trackerPathFor(options);
  const batchStateFile = batchStateFileFor(options);
  mkdirSync(reportsDir, { recursive: true });

  const lock = await acquireTrackerLock(trackerLockDirFor(trackerPath), {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: trackerPath,
    ...options.lockOptions,
  });

  try {
    let occupied = collectOccupied(reportsDir, trackerPath, batchStateFile, options);
    let base = highestNumber(occupied) + 1;
    const token = randomUUID();

    for (let tries = 0; tries < MAX_RETRIES; tries++) {
      const end = base + (count - 1);
      if (!Number.isSafeInteger(base) || !Number.isSafeInteger(end)) {
        throw new RangeError('No safe report-number range remains');
      }
      const claimed = [];
      let failedAt = null;
      for (let num = base; num <= end; num++) {
        if (claimSlot(reportsDir, num, occupied, token)) {
          claimed.push(num);
        } else {
          failedAt = num;
          break;
        }
      }
      if (failedAt == null) {
        Object.defineProperty(claimed, RESERVATION_TOKEN, { value: token });
        return claimed;
      }

      for (const num of claimed) releaseSlot(reportsDir, num, { token });
      occupied = collectOccupied(reportsDir, trackerPath, batchStateFile, options);
      base = Math.max(failedAt + 1, highestNumber(occupied) + 1);
    }
  } finally {
    lock.release();
  }

  throw new Error(`Could not claim ${count} report slot(s) after ${MAX_RETRIES} retries`);
}

/**
 * Release reservation sentinels after report creation or on failure.
 * Only the array returned by reserveReportNumbers owns its sentinels. The CLI
 * uses force mode as an explicit administrative cleanup path.
 */
export async function releaseReportNumbers(numbers, options = {}) {
  const reportsDir = reportsDirFor(options);
  const values = Array.isArray(numbers) ? numbers : [numbers];
  for (const num of values) {
    if (!Number.isSafeInteger(num) || num < 1) {
      throw new TypeError(`Report number must be a positive integer, got ${num}`);
    }
  }
  const force = options.force === true;
  const token = options.reservationToken || numbers?.[RESERVATION_TOKEN];
  if (!force && !token) throw new Error('Reservation ownership token is required for release');
  if (!existsSync(reportsDir)) return 0;

  const trackerPath = trackerPathFor(options);
  const lock = await acquireTrackerLock(trackerLockDirFor(trackerPath), {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: trackerPath,
    ...options.lockOptions,
  });
  try {
    return values.reduce(
      (removed, num) => removed + Number(releaseSlot(reportsDir, num, { token, force })),
      0,
    );
  } finally {
    lock.release();
  }
}

/** Remove reservation sentinels older than the configured TTL. */
export async function gcStaleReportReservations(options = {}) {
  const reportsDir = reportsDirFor(options);
  if (!existsSync(reportsDir)) return 0;

  const trackerPath = trackerPathFor(options);
  const lock = await acquireTrackerLock(trackerLockDirFor(trackerPath), {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: trackerPath,
    ...options.lockOptions,
  });
  const maxAgeMs = options.maxAgeMs ?? MAX_SENTINEL_AGE_MS;
  const now = Date.now();
  let removed = 0;
  try {
    for (const name of readdirSync(reportsDir)) {
      if (!/^\d+-RESERVED\.md$/.test(name)) continue;
      const fullPath = join(reportsDir, name);
      try {
        if (now - statSync(fullPath).mtimeMs > maxAgeMs) {
          const owner = readSentinelOwner(fullPath);
          if (owner?.pid && processIsAlive(owner.pid)) continue;
          unlinkSync(fullPath);
          removed++;
          process.stderr.write(`reserve-report-num: GC stale sentinel ${name}\n`);
        }
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
    }
  } finally {
    lock.release();
  }
  if (removed > 0) {
    process.stderr.write(`reserve-report-num: removed ${removed} stale sentinel(s)\n`);
  }
  return removed;
}

async function runCli() {
  const args = process.argv.slice(2);
  const [cmd, arg] = args;
  const options = {};

  if (cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE_LINES.join('\n'));
    return 0;
  }

  // Each command takes a fixed number of arguments. Anything else (an unknown
  // word, `--count=3`, a stray extra argument) would fall through to the
  // reserve-1 path and claim a number the caller did not ask for.
  const argCounts = new Map([['--count', 2], ['--release', 2], ['--gc', 1]]);
  const allowed = cmd === undefined ? 0 : argCounts.get(cmd);
  const offending = allowed === undefined ? cmd : args[allowed];
  if (offending !== undefined) {
    process.stderr.write(`reserve-report-num: unrecognized argument: ${offending}\n${USAGE_LINES.join('\n')}`);
    return 1;
  }

  if (cmd === '--release') {
    const match = (arg || '').match(/^(\d+)(?:-(\d+))?$/);
    if (!match) {
      process.stderr.write('Usage: node reserve-report-num.mjs --release <NNN>[-<MMM>]\n');
      return 1;
    }
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    const rangeCount = end - start + 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 1 || end < start || rangeCount > MAX_COUNT) {
      process.stderr.write(`reserve-report-num: --release requires a safe ascending range of at most ${MAX_COUNT} slots\n`);
      return 1;
    }
    await releaseReportNumbers(
      Array.from({ length: rangeCount }, (_, index) => start + index),
      { ...options, force: true },
    );
    return 0;
  }

  if (cmd === '--gc') {
    await gcStaleReportReservations(options);
    return 0;
  }

  let count = 1;
  if (cmd === '--count') {
    if (!/^\d+$/.test(arg || '')) {
      process.stderr.write(`Usage: node reserve-report-num.mjs --count <1-${MAX_COUNT}>\n`);
      return 1;
    }
    count = parseInt(arg, 10);
    if (count < 1 || count > MAX_COUNT) {
      process.stderr.write(`Usage: node reserve-report-num.mjs --count <1-${MAX_COUNT}>\n`);
      return 1;
    }
  }

  try {
    const numbers = await reserveReportNumbers(count, options);
    process.stdout.write(count === 1
      ? `${formatReportNumber(numbers[0])}\n`
      : `${formatReportNumber(numbers[0])}-${formatReportNumber(numbers[numbers.length - 1])}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`reserve-report-num: ${err.message}\n`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await runCli();
}
