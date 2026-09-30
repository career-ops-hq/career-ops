#!/usr/bin/env node
/**
 * append-gate3-log.mjs — append-only Gate 3 ledger (data/gate3-log.tsv).
 *
 * WHY A SIDECAR AND NOT A NEW applications.md COLUMN
 *   The tracker is parsed BY INDEX on the Go side
 *   (dashboard/internal/model/career.go — Number/Date/Company/Role/... are
 *   positional fields), and merge-tracker.mjs's buildRow() keeps every row at
 *   the HEADER's width. Adding a column therefore risks shifting indices under
 *   every existing row and unaddressing them, which is exactly the failure its
 *   own comment (merge-tracker.mjs:568-574) records from an earlier fix. The
 *   repo already has nine TSV sidecars for precisely this reason
 *   (status-log.tsv, jev-calibration.tsv, salary-observations.tsv, ...), so
 *   this follows the established shape rather than inventing one.
 *
 * CONTRACT
 *   timestamp \t id \t company \t role \t decision \t reason \n
 *   Written APPEND-ONLY under the same tracker lock every other writer takes,
 *   so two concurrent CV generations cannot interleave a half-line.
 *
 * FAIL-OPEN BY CONSTRUCTION
 *   This runs AFTER the CV has been generated and the run reported done. It is
 *   an observation ledger: if the append fails, the user's PDF is already on
 *   disk and nothing about the run is invalid. So every failure path prints a
 *   warning and still exits 0 — a non-zero exit here would make the caller's
 *   `runCoreScript` report a linter failure that never happened. Exit codes are
 *   reserved for a genuine lock timeout (4, matching set-status.mjs) and a usage
 *   error (2).
 *
 * Usage:
 *   node append-gate3-log.mjs <id> <company> <role> <decision> [reason]
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
// Root-level, NOT scripts/: the web layer reaches core scripts through
// runCoreScript() -> rootScript() (web/src/lib/career-ops.ts:27-29), which
// resolves `<careerOpsRoot>/<name>.mjs` and nothing else. A file under scripts/
// would be unreachable from the pdf lane.
import { acquireTrackerLock, trackerLockDirFor, resolveTrackerPath } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_LOCK_TIMEOUT = 4;

/**
 * Flatten a field to a single TSV cell.
 *
 * The two hazards are structural, not cosmetic: a TAB or NEWLINE would forge an
 * extra column/row, and the ledger is joined to applications.md by its id, so a
 * value carrying a tab is a corrupted join key. Mirrors `cell()` in
 * tracker-utils.mjs (same CR/LF collapse), plus the tab that a markdown cell
 * never had to worry about.
 */
function tsv(value, max = 300) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

/** ISO-8601 with a local offset, so a ledger row sorts and reads unambiguously. */
function stamp(date = new Date()) {
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(off / 60 | 0)}:${pad(off % 60)}`;
}

/** Ledger path: a SIBLING of the tracker, so CAREER_OPS_TRACKER relocates it too. */
export function gate3LogPath() {
  try {
    return join(dirname(resolveTrackerPath()), 'gate3-log.tsv');
  } catch {
    return join(getCareerOpsRoot(), 'data', 'gate3-log.tsv');
  }
}

/** The header row, written once when the file is created. */
export const HEADER = 'timestamp\tid\tcompany\trole\tdecision\treason\n';

/**
 * Append one Gate 3 observation. Returns the path written, or null when the
 * append was abandoned (never throws — see the fail-open note above).
 */
export async function appendGate3Log({ id, company, role, decision, reason }) {
  const logPath = gate3LogPath();
  mkdirSync(dirname(logPath), { recursive: true });

  // Same lock discipline as set-status.mjs/merge-tracker.mjs: one writer at a
  // time against the tracker family, released in a finally.
  const lock = await acquireTrackerLock(trackerLockDirFor(logPath), {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: logPath,
  });
  try {
    const fresh = !existsSync(logPath);
    appendFileSync(
      logPath,
      fresh ? HEADER : '',
      'utf-8',
    );
    appendFileSync(
      logPath,
      `${stamp()}\t${tsv(id, 40)}\t${tsv(company)}\t${tsv(role)}\t${tsv(decision, 20)}\t${tsv(reason)}\n`,
      'utf-8',
    );
    return logPath;
  } finally {
    lock.release();
  }
}

async function main(argv = process.argv.slice(2)) {
  const [id, company, role, decision, ...rest] = argv;
  const reason = rest.join(' ');

  if (!id || !company || !role || !decision) {
    console.error(
      'Usage: node append-gate3-log.mjs <id> <company> <role> <decision> [reason]\n'
      + 'Exits 0 on success AND on a failed append (advisory ledger); 4 on lock timeout; 2 on usage.',
    );
    return EXIT_USAGE;
  }

  try {
    const written = await appendGate3Log({ id, company, role, decision, reason });
    console.log(`gate3: ${written}`);
    return EXIT_OK;
  } catch (err) {
    if (err?.code === 'LOCK_TIMEOUT') {
      console.error(`gate3: lock timeout — ${err.message}`);
      return EXIT_LOCK_TIMEOUT;
    }
    // Advisory: the CV is already generated and the run already reported done.
    console.error(`Warning: gate3-log append failed (the run itself is unaffected): ${err.message}`);
    return EXIT_OK;
  }
}

// isMainModule, not a hand-rolled `import.meta.url === file://${process.argv[1]}`:
// that comparison silently no-ops through a symlinked checkout (#3170), which is
// why lib/is-main-module.mjs exists and why the convention test enforces it.
if (isMainModule(import.meta.url)) {
  process.exitCode = await main();
}