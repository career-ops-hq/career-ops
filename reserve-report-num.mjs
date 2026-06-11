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
 *   node reserve-report-num.mjs --release 035
 *   # Deletes the sentinel for 035 (call after writing the real report).
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
const REPORTS_DIR = join(__dirname, 'reports');

// Sentinels older than this are considered stale and may be GC'd.
// 4 hours covers any reasonable interactive or batch session.
const MAX_SENTINEL_AGE_MS = 4 * 60 * 60 * 1000;

// Maximum number of retries before giving up (guards against pathological
// contention — in practice 2-3 parallel windows will resolve in < 5 tries).
const MAX_RETRIES = 50;

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

/** Attempt to atomically claim slot `n`. Returns true on success. */
function claimSlot(n) {
  // Check if any file (real report or sentinel) already occupies this slot
  if (existsSync(REPORTS_DIR)) {
    const prefix = `${pad(n)}-`;
    const alreadyExists = readdirSync(REPORTS_DIR).some(name => name.startsWith(prefix));
    if (alreadyExists) return false;
  }

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
  if (!arg || !/^\d{1,3}$/.test(arg)) {
    process.stderr.write('Usage: node reserve-report-num.mjs --release <NNN>\n');
    process.exit(1);
  }
  releaseSlot(parseInt(arg, 10));
  process.exit(0);
}

if (cmd === '--gc') {
  gc();
  process.exit(0);
}

// Default: reserve next slot.
mkdirSync(REPORTS_DIR, { recursive: true });

let candidate = maxSlot() + 1;
let tries = 0;

while (tries < MAX_RETRIES) {
  if (claimSlot(candidate)) {
    process.stdout.write(pad(candidate) + '\n');
    process.exit(0);
  }
  // Slot already taken (sentinel or real file appeared) — try next.
  candidate++;
  tries++;
}

process.stderr.write(`reserve-report-num: could not claim a slot after ${MAX_RETRIES} retries\n`);
process.exit(1);
