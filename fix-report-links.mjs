#!/usr/bin/env node
/**
 * fix-report-links.mjs — Repair tracker rows whose Report link points at a missing file
 *
 * verify-pipeline.mjs (Check 3) reports `Report not found: ...` for every row
 * whose Report cell links to a file that is not on disk, but it is read-only.
 * This script is the explicit, previewed, backed-up repair: it rewrites ONLY
 * that one cell to `—` (the tracker's existing "no report" value). Every other
 * cell, the row order, the cell padding and the file's line endings (LF/CRLF)
 * are left byte-for-byte as they were; nothing is re-sorted or re-formatted.
 *
 * "Broken" is decided by findDeadReportLink() in tracker-utils.mjs, the same
 * function verify-pipeline and merge-tracker use, so the tools always agree on
 * which rows are broken. It does not guess WHY a report is missing (#4748).
 *
 * A Report cell that is anything other than exactly one markdown link (two
 * links, link plus text) is never rewritten: it is listed under "skipped,
 * please check by hand" instead.
 *
 * Run: node fix-report-links.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { openTrackerTransaction, findDeadReportLink } from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const NO_REPORT = '—';

// A Report cell that is exactly one markdown link, nothing else around it.
const SINGLE_LINK_RE = /^\[[^\]]*\]\([^)]+\)$/;

/**
 * Scan tracker lines and rewrite dead single-link Report cells to `—`.
 * Pure: touches no files. Exported so tests can call it directly.
 *
 * @param {string[]} lines - Tracker content split on '\n' (a CR stays on its line).
 * @param {string} trackerDir - Directory containing the tracker file.
 * @param {string} dataRoot - Data root.
 * @param {{stat?: Function}} [options] - Test seam for filesystem inspection.
 * @returns {{lines: string[], changed: object[], skipped: object[], inspectionErrors: object[], hasReportColumn: boolean}}
 */
export function fixReportLinks(lines, trackerDir, dataRoot, options = {}) {
  const COLS = resolveColumns(lines);
  if (COLS.report == null) return { lines, changed: [], skipped: [], inspectionErrors: [], hasReportColumn: false };

  const out = lines.slice();
  const changed = [];
  const skipped = [];
  const inspectionErrors = [];
  for (let i = 0; i < lines.length; i++) {
    const row = parseTrackerRow(lines[i], COLS);
    if (!row) continue; // header, separator, non-row, or a row missing cells

    const firstLink = String(row.report).match(/\]\(([^)]+)\)/)?.[1] ?? null;
    // Any Report cell that contains a link but is not exactly one bare link is
    // ambiguous by contract. Surface it for manual review before inspecting the
    // first target: otherwise a live first link hides a dead later link.
    if (firstLink !== null && !SINGLE_LINK_RE.test(row.report)) {
      skipped.push({
        num: row.num, company: row.company, role: row.role,
        link: firstLink, cell: row.report, line: i + 1,
      });
      continue;
    }

    let inspectionFailure = null;
    const link = findDeadReportLink(row.report, trackerDir, dataRoot, {
      stat: options.stat,
      onInspectionError: (failure) => { inspectionFailure = failure; },
    });
    if (inspectionFailure) {
      inspectionErrors.push({
        num: row.num, company: row.company, role: row.role, cell: row.report,
        line: i + 1, ...inspectionFailure,
      });
      continue;
    }
    if (link === null) continue; // no link (—, N/A, empty) or it resolves

    const info = { num: row.num, company: row.company, role: row.role, link, cell: row.report, line: i + 1 };

    // Replace just this cell in the raw (untrimmed) split, keeping its padding,
    // so no other byte of the line moves. parseTrackerRow trims the same split.
    const parts = lines[i].split('|');
    const raw = parts[COLS.report];
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    parts[COLS.report] = `${lead}${NO_REPORT}${trail}`;
    out[i] = parts.join('|');
    changed.push(info);
  }
  return { lines: out, changed, skipped, inspectionErrors, hasReportColumn: true };
}

const KNOWN_FLAGS = ['--help', '-h', '--dry-run'];
const USAGE = `Usage: node fix-report-links.mjs [options]

  Rewrites the Report cell of tracker rows whose markdown link points at a
  missing file to "${NO_REPORT}". Nothing else in the file changes.

  Options:
  --dry-run        List the rows that would change without writing applications.md
  -h, --help       Show this help and exit
  `;

function describe(info) {
  return `#${info.num} ${info.company} — ${info.role}: ${info.link}`;
}

const IS_CLI = isMainModule(import.meta.url);

if (IS_CLI) {
const args = process.argv.slice(2);

// Unrecognized flags exit 1 naming the flag; --help/-h print USAGE and exit 0.
validateFlags(args, KNOWN_FLAGS, USAGE);

const DRY_RUN = args.includes('--dry-run');
const CAREER_OPS = getCareerOpsRoot();
const APPS_FILE = resolveTrackerPath(CAREER_OPS);

if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to fix.');
  process.exit(0);
}

let trackerTransaction = null;
if (!DRY_RUN) {
  try {
    trackerTransaction = await openTrackerTransaction(APPS_FILE);
  } catch (err) {
    console.error(`Cannot acquire tracker lock: ${err.message}`);
    process.exit(1);
  }
  process.once('exit', () => {
    try { trackerTransaction.close(); } catch {}
  });
}
try {
const content = trackerTransaction ? trackerTransaction.read() : readFileSync(APPS_FILE, 'utf-8');
const result = fixReportLinks(content.split('\n'), dirname(APPS_FILE), CAREER_OPS);

if (!result.hasReportColumn) {
  console.log('The tracker has no Report column. Nothing to fix.');
  process.exit(0);
}

for (const c of result.changed) {
  console.log(`${DRY_RUN ? 'Would rewrite' : 'Rewrote'} ${describe(c)}`);
}

if (result.skipped.length > 0) {
  console.log(`\n⚠️  ${result.skipped.length} row(s) skipped, please check by hand (Report cell is not a single link):`);
  for (const s of result.skipped) {
    console.log(`  #${s.num} (line ${s.line}) ${s.company} — ${s.role}: "${s.cell}"`);
  }
}

if (result.inspectionErrors.length > 0) {
  console.log(`\n⚠️  ${result.inspectionErrors.length} row(s) preserved because the report target could not be inspected:`);
  for (const item of result.inspectionErrors) {
    const details = item.errors.map(({ path, error }) => `${path} (${error.code ?? error.message})`).join('; ');
    console.log(`  #${item.num} (line ${item.line}) ${item.company} — ${item.role}: ${details}`);
  }
}

console.log(`\n📊 ${result.changed.length} dead report link(s) ${DRY_RUN ? 'found' : 'fixed'}`);

if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else if (result.changed.length > 0) {
  // Backup first. Written from the bytes this run parsed (read inside the
  // lock), next to the transaction's canonical path: copying APPS_FILE again
  // would follow a CAREER_OPS_TRACKER symlink and put the .bak beside the
  // link, or capture an edit made by a writer that bypasses the lock.
  const backupPath = `${trackerTransaction.path}.bak`;
  writeFileSync(backupPath, content);
  trackerTransaction.replace(result.lines.join('\n'));
  console.log(`✅ Written to ${trackerTransaction.path} (backup: ${backupPath})`);
} else {
  console.log('✅ No changes needed');
}
} finally {
  trackerTransaction?.close();
}
} // end IS_CLI
