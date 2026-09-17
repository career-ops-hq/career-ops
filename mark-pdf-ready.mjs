#!/usr/bin/env node

/**
 * mark-pdf-ready.mjs — canonical CLI to flip a tracker row's PDF column ❌→✅ (#2172).
 *
 * data/applications.md is a shared surface with multiple readers and writers.
 * Before this script, the PDF column had NO canonical writer at all — every
 * caller (the web dashboard's "pdf" mode) hand-edited the markdown table via
 * an LLM prompt instruction. This gives it the same one-canonical-write-path
 * treatment set-status.mjs already gives the Status column: same lock, same
 * atomic write, same shared tracker-parse/tracker-utils primitives.
 *
 * Usage:
 *   node mark-pdf-ready.mjs <report#> [--dry-run] [--json]
 *
 * Row resolution is by REPORT NUMBER (the NNN in reports/NNN-{slug}-{date}.md),
 * not the tracker `#` column — those two numbers differ by design (see
 * modes/pdf.md step 19's own comment), and callers of this script always have
 * the report number, not the tracker row id. Resolution matches
 * extractTrackerReportNumbers(row.report) against the given report number;
 * zero or 2+ matches fail closed rather than guessing.
 *
 * Idempotent: a row whose PDF cell is already ✅ is a no-op success (changed:
 * false), so a retried render never fails this step.
 *
 * The read-modify-write runs under the shared tracker lock (tracker-utils.mjs,
 * same lock as merge-tracker.mjs / set-status.mjs) and the file is replaced
 * atomically. Only the PDF cell of the matched row changes; every other byte
 * of the tracker round-trips untouched.
 *
 * Exit codes: 0 success (including no-op re-runs) · 1 usage error, no PDF
 * column, or non-retryable lock/write failure · 2 row not found, missing
 * tracker, or unreadable tracker · 3 ambiguous match (2+ rows link the same
 * report number) · 4 tracker lock timeout (busy — retry later).
 */

import { readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractTrackerReportNumbers, resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import {
  rebuildRow, resolveTrackerPath, writeFileAtomic, CLI_EXIT, makeCliFailWith, acquireTrackerLockForCli,
} from './tracker-utils.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));

// LOCK_TIMEOUT is not destructured here — that exit path is raised inside
// acquireTrackerLockForCli() itself (tracker-utils.mjs), via CLI_EXIT.LOCK_TIMEOUT.
const { OK: EXIT_OK, USAGE: EXIT_USAGE, NOT_FOUND: EXIT_NOT_FOUND, AMBIGUOUS: EXIT_AMBIGUOUS } = CLI_EXIT;

const USAGE = `Usage: node mark-pdf-ready.mjs <report#> [--dry-run] [--json]

  <report#>    The NNN from reports/NNN-{slug}-{date}.md (NOT the tracker # column)
  --dry-run    Resolve and validate, but write nothing
  --json       Machine-readable output on stdout (errors included)`;

// ── argument parsing ─────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const positional = [];
const flags = { dryRun: false, json: false };

for (const a of rawArgs) {
  if (a === '--dry-run') { flags.dryRun = true; }
  else if (a === '--json') { flags.json = true; }
  else if (a.startsWith('--')) { failUsage(`Unknown flag: ${a}`); }
  else { positional.push(a); }
}

if (positional.length !== 1) {
  failUsage(positional.length === 0 ? null : `Expected 1 argument (report#), got ${positional.length}`);
}

const [reportSelector] = positional;

// Shared with set-status.mjs (tracker-utils.mjs) so the JSON-vs-human error
// contract can't drift between the two canonical tracker-writer CLIs.
const failWith = makeCliFailWith(flags.json);

/**
 * Print usage (plus an optional specific complaint) and exit 1.
 *
 * @param {string|null} message - What was wrong with the invocation, if known.
 * @returns {never}
 */
function failUsage(message) {
  const msg = message ?? 'Expected 1 argument: <report#>';
  if (rawArgs.includes('--json')) {
    console.log(JSON.stringify({ error: msg, code: 'usage' }));
    console.error(`❌ ${msg}`);
  } else {
    if (message) console.error(`❌ ${message}\n`);
    console.error(USAGE);
  }
  process.exit(EXIT_USAGE);
}

if (!/^\d+$/.test(reportSelector)) {
  failUsage(`"${reportSelector}" is not a valid report number`);
}
const targetReportNum = parseInt(reportSelector, 10);

// ── tracker access ───────────────────────────────────────────────

const APPS_FILE = resolveTrackerPath(CAREER_OPS);
if (!existsSync(APPS_FILE)) {
  failWith(EXIT_NOT_FOUND, 'no-tracker', `No tracker found at ${APPS_FILE}`);
}

// Shared with set-status.mjs (tracker-utils.mjs): dry-run never writes, so it
// must not hold the exclusive lock — a read-only preview should not block
// (or be blocked by) merge-tracker or another writer.
const lock = await acquireTrackerLockForCli(APPS_FILE, { dryRun: flags.dryRun, failWith });

let content;
try {
  content = readFileSync(APPS_FILE, 'utf-8');
} catch (err) {
  failWith(EXIT_NOT_FOUND, 'read-failure', `Cannot read tracker at ${APPS_FILE}: ${err.message}`);
}
const lines = content.split('\n');
const colmap = resolveColumns(lines);
if (colmap.pdf == null) {
  failWith(EXIT_USAGE, 'no-pdf-column', 'Tracker has no PDF column — cannot mark a PDF ready');
}

const rows = [];
for (let i = 0; i < lines.length; i++) {
  const row = parseTrackerRow(lines[i], colmap);
  if (row) rows.push({ ...row, lineIdx: i });
}
if (rows.length === 0) {
  failWith(EXIT_NOT_FOUND, 'empty-tracker', `Tracker at ${APPS_FILE} has no data rows`);
}

const matches = rows.filter(r => extractTrackerReportNumbers(r.report).includes(targetReportNum));
if (matches.length === 0) {
  failWith(EXIT_NOT_FOUND, 'not-found', `No tracker row links report #${targetReportNum}`);
}
if (matches.length > 1) {
  // An ambiguous report-number-to-row mapping is a tracker data bug (two rows
  // linking the same report), not a legitimate disambiguation case — refuse
  // to guess which one to mark, same fail-closed stance as set-status.mjs's
  // duplicate-# guard.
  const candidates = matches.map(r => ({ num: r.num, company: r.company, role: r.role }));
  const listing = candidates.map(c => `#${c.num}\t${c.company}\t${c.role}`).join('\n');
  failWith(EXIT_AMBIGUOUS, 'ambiguous',
    `Report #${targetReportNum} is linked by ${matches.length} tracker rows — repair the Report cells:\n${listing}`,
    { candidates });
}
const target = matches[0];

// ── locked read-modify-write ─────────────────────────────────────

const alreadyReady = target.pdf.trim() === '✅';
// Matches set-status.mjs's contract: `changed` reflects whether a write WOULD
// happen, computed independent of --dry-run, so a preview call can tell "would
// mark" apart from "already ✅" without actually writing.
const changed = !alreadyReady;

if (changed && !flags.dryRun) {
  const parts = lines[target.lineIdx].split('|').map(s => s.trim());
  while (parts.length <= colmap.pdf) parts.push('');
  parts[colmap.pdf] = '✅';
  lines[target.lineIdx] = rebuildRow(parts);
  try {
    writeFileAtomic(APPS_FILE, lines.join('\n'));
  } catch (err) {
    failWith(EXIT_USAGE, 'write-failure', `Cannot write tracker at ${APPS_FILE}: ${err.message}`);
  }
}
lock?.release();

// ── report ───────────────────────────────────────────────────────

const result = {
  changed,
  num: target.num,
  company: target.company,
  role: target.role,
  reportNum: targetReportNum,
  ...(flags.dryRun ? { dryRun: true } : {}),
  tracker: APPS_FILE,
};

if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const verb = flags.dryRun ? (alreadyReady ? 'already' : 'would mark') : changed ? 'marked' : 'already';
  console.log(`✅ #${target.num} ${target.company} — ${target.role}: ${verb} PDF ready`);
}
process.exit(EXIT_OK);
