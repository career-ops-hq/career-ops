#!/usr/bin/env node

/**
 * reserve-report-num.mjs — Atomically reserve the next report number.
 *
 * Fixes the race condition described in #749: when two Claude Code windows
 * (or batch workers) run simultaneously they each compute `max(existing)+1`
 * independently and collide on the same report-number slot.
 *
 * ## How it works
 *
 * Uses `fs.writeFileSync(path, data, { flag: 'wx' })` — which maps to
 * `open(O_CREAT|O_EXCL)` on POSIX and `CreateFile(CREATE_NEW)` on Windows —
 * to create a sentinel file atomically.  If two processes try to claim the
 * same number simultaneously only one succeeds; the loser increments and
 * retries.  No external lock daemon or advisory file is needed.
 *
 * The sentinel is a zero-byte marker named `NNN-RESERVED.md` inside
 * `reports/`.  The caller (mode file or agent) must:
 *   1. Run this script to get a number.
 *   2. Write the real report file `NNN-{slug}-{date}.md`.
 *   3. Delete the sentinel (or let verify-pipeline.mjs GC it on next run).
 *
 * ## Usage
 *
 *   node reserve-report-num.mjs
 *   # stdout: 035           (zero-padded, 3 digits)
 *
 *   node reserve-report-num.mjs --count 8
 *   # stdout: 042-049       (reserves a contiguous range — for multi-agent
 *   #                        fan-outs: reserve first, hand each parallel
 *   #                        worker its own number. On collision the whole
 *   #                        range restarts past the taken slot, so skipped
 *   #                        numbers become permanent gaps — expected, not
 *   #                        corruption. Range protection follows the normal
 *   #                        sentinel TTL: reserve right before spawning.)
 *
 *   node reserve-report-num.mjs --release 035
 *   node reserve-report-num.mjs --release 042-049
 *   # Deletes the sentinel(s) (call after writing the real report(s)).
 *
 *   node reserve-report-num.mjs --gc
 *   # Removes all stale sentinels older than MAX_SENTINEL_AGE_MS.
 *   # Called automatically by verify-pipeline.mjs.
 *
 * The script exits with code 0 on success, non-zero on fatal error.
 */

import { readdirSync, writeFileSync, unlinkSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = process.env.CAREER_OPS_REPORTS_DIR || join(__dirname, 'reports');

// Sentinels older than this are considered stale and may be GC'd.
// 4 hours covers any reasonable interactive or batch session.
const MAX_SENTINEL_AGE_MS = 4 * 60 * 60 * 1000;

// Maximum number of retries before giving up (guards against pathological
// contention — in practice 2-3 parallel windows will resolve in < 5 tries).
const MAX_RETRIES = 50;

// Maximum range size for --count (guards typos like --count 800).
const MAX_COUNT = 50;

// ── helpers ─────────────────────────────────────────────────────────────────

function pad(n) {
  return String(n).padStart(3, '0');
}

/** Return the highest numeric slot currently taken in reports/ (files + sentinels). */
function maxSlot() {
  if (!existsSync(REPORTS_DIR)) return 0;
  const entries = readdirSync(REPORTS_DIR);
  let max = 0;
  for (const name of entries) {
    const m = name.match(/^(\d{3})-/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/**
 * One readdir pass → Set of numeric prefixes currently occupying slots
 * (e.g. "042" from "042-acme-2026-07-02.md" or "042-RESERVED.md").
 * Advisory only — real atomicity comes from claimSlot's O_CREAT|O_EXCL write.
 */
function takenPrefixes() {
  const taken = new Set();
  if (!existsSync(REPORTS_DIR)) return taken;
  for (const name of readdirSync(REPORTS_DIR)) {
    const m = name.match(/^(\d+)-/);
    if (m) taken.add(m[1]);
  }
  return taken;
}

/**
 * Attempt to atomically claim slot `n`. Returns true on success.
 * `taken` is an optional pre-scanned Set from takenPrefixes(); without it,
 * the occupancy pre-check scans REPORTS_DIR itself. Either way the check is
 * only advisory — the 'wx' write below is what guarantees atomicity.
 */
function claimSlot(n, taken = null) {
  // Check if any file (real report or sentinel) already occupies this slot
  const occupied = taken
    ? taken.has(pad(n))
    : existsSync(REPORTS_DIR) && readdirSync(REPORTS_DIR).some(name => name.startsWith(`${pad(n)}-`));
  if (occupied) return false;

  const sentinel = join(REPORTS_DIR, `${pad(n)}-RESERVED.md`);
  try {
    // 'wx' = O_CREAT | O_EXCL — fails if file already exists.
    writeFileSync(sentinel, '', { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false; // another process beat us
    throw err; // unexpected FS error
  }
}

/** Release (delete) the sentinel for slot `n`. */
function releaseSlot(n) {
  const sentinel = join(REPORTS_DIR, `${pad(n)}-RESERVED.md`);
  if (existsSync(sentinel)) unlinkSync(sentinel);
}

/**
 * Reserve `count` contiguous slots. All-or-nothing per attempt: if any slot
 * in the candidate range is already taken, release the slots claimed so far
 * and restart past the collision. Each slot claim is individually atomic
 * (O_CREAT|O_EXCL), which is all the pipeline needs — contiguity is an
 * ergonomic property, not a correctness one. Skipped numbers become
 * permanent gaps; report numbers are opaque IDs, so gaps are harmless.
 * Returns the array of reserved numbers, or null if MAX_RETRIES attempts
 * were exhausted. Terminates under contention: `base` strictly advances
 * past every collision, so two racing ranges can never livelock.
 */
function reserveRange(count) {
  let base = maxSlot() + 1;
  let tries = 0;
  // One directory scan per attempt, shared by every per-slot check;
  // refreshed only after a collision forces a retry.
  let taken = takenPrefixes();
  while (tries < MAX_RETRIES) {
    const claimed = [];
    let failedAt = -1;
    for (let n = base; n < base + count; n++) {
      if (claimSlot(n, taken)) {
        claimed.push(n);
      } else {
        failedAt = n;
        break;
      }
    }
    if (failedAt === -1) return claimed;
    for (const n of claimed) releaseSlot(n);
    base = failedAt + 1;
    tries++;
    taken = takenPrefixes();
  }
  return null;
}

/** GC stale sentinels (no real report was written within MAX_SENTINEL_AGE_MS). */
function gc() {
  if (!existsSync(REPORTS_DIR)) return;
  const now = Date.now();
  let removed = 0;
  for (const name of readdirSync(REPORTS_DIR)) {
    if (!name.endsWith('-RESERVED.md')) continue;
    const full = join(REPORTS_DIR, name);
    try {
      const { mtimeMs } = statSync(full);
      if (now - mtimeMs > MAX_SENTINEL_AGE_MS) {
        unlinkSync(full);
        removed++;
        process.stderr.write(`reserve-report-num: GC stale sentinel ${name}\n`);
      }
    } catch {
      // Already gone — fine.
    }
  }
  if (removed > 0) {
    process.stderr.write(`reserve-report-num: removed ${removed} stale sentinel(s)\n`);
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const [,, cmd, arg] = process.argv;

if (cmd === '--release') {
  const m = (arg || '').match(/^(\d{1,3})(?:-(\d{1,3}))?$/);
  if (!m) {
    process.stderr.write('Usage: node reserve-report-num.mjs --release <NNN>[-<MMM>]\n');
    process.exit(1);
  }
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : start;
  if (end < start) {
    process.stderr.write('reserve-report-num: --release range end must be >= start\n');
    process.exit(1);
  }
  for (let n = start; n <= end; n++) releaseSlot(n);
  process.exit(0);
}

if (cmd === '--gc') {
  gc();
  process.exit(0);
}

// Default (or --count N): reserve the next slot(s).
let count = 1;
if (cmd === '--count') {
  if (!/^\d+$/.test(arg || '')) {
    process.stderr.write(`Usage: node reserve-report-num.mjs --count <1-${MAX_COUNT}>\n`);
    process.exit(1);
  }
  count = parseInt(arg, 10);
  if (count < 1 || count > MAX_COUNT) {
    process.stderr.write(`Usage: node reserve-report-num.mjs --count <1-${MAX_COUNT}>\n`);
    process.exit(1);
  }
}
// Any other/unknown cmd falls through to a single reserve — unchanged
// legacy behavior.

mkdirSync(REPORTS_DIR, { recursive: true });

const nums = reserveRange(count);
if (!nums) {
  process.stderr.write(`reserve-report-num: could not claim ${count} slot(s) after ${MAX_RETRIES} retries\n`);
  process.exit(1);
}

process.stdout.write(
  count === 1
    ? pad(nums[0]) + '\n'
    : `${pad(nums[0])}-${pad(nums[nums.length - 1])}\n`
);
process.exit(0);
