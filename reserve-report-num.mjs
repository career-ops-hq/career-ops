#!/usr/bin/env node

/**
 * reserve-report-num.mjs - shared atomic report-number allocator.
 *
 * The CLI and every evaluator use the exported API below. Reservations account
 * for report files, reservation sentinels, tracker row IDs, and report links in
 * the tracker. The tracker scan and sentinel creation run under the same lock
 * as tracker writers, while O_CREAT|O_EXCL keeps claims atomic across processes.
 *
 * Usage:
 *   node reserve-report-num.mjs
 *   node reserve-report-num.mjs --count 8
 *   node reserve-report-num.mjs --release 035
 *   node reserve-report-num.mjs --release 042-049
 *   node reserve-report-num.mjs --gc
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  statSync, unlinkSync, writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  extractTrackerReportNumbers, parseTrackerRow, resolveColumns,
} from './tracker-parse.mjs';
import {
  acquireTrackerLock, canonicalizeTrackerPath, resolveTrackerPath, trackerLockDirFor,
} from './tracker-utils.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_SENTINEL_AGE_MS = 4 * 60 * 60 * 1000;
const MAX_RETRIES = 50;
const MAX_COUNT = 50;
const RESERVATION_TOKEN = Symbol('career-ops-report-reservation-token');

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

function occupiedFromReports(reportsDir) {
  const occupied = new Set();
  if (!existsSync(reportsDir)) return occupied;
  for (const name of readdirSync(reportsDir)) {
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

function collectOccupied(reportsDir, trackerPath) {
  const occupied = occupiedFromReports(reportsDir);
  for (const num of occupiedFromTracker(trackerPath)) occupied.add(num);
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
  mkdirSync(reportsDir, { recursive: true });

  const lock = await acquireTrackerLock(trackerLockDirFor(trackerPath), {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: trackerPath,
    ...options.lockOptions,
  });

  try {
    let occupied = collectOccupied(reportsDir, trackerPath);
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
      occupied = collectOccupied(reportsDir, trackerPath);
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
  const [,, cmd, arg] = process.argv;
  const options = {};

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

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  }
}

if (isDirectInvocation()) {
  process.exitCode = await runCli();
}
