#!/usr/bin/env node

/**
 * migrate-scan-runs.mjs — bring an existing data/scan-runs.tsv onto the current
 * schema so runs recorded under an older header keep counting (#4423).
 *
 * appendScanRunSummary writes SCAN_RUNS_HEADER only when the file does not yet
 * exist. A release that adds a counter therefore leaves every pre-existing file
 * with a header that no longer describes its own rows. #3280 fixed the reading
 * side — computeRunStats detects the drift instead of reporting a neighbouring
 * counter — but detecting it means excluding those rows: wider rows count as
 * drift, narrower ones as torn. Either way the run drops out of the lifetime
 * figures, and the file is append-only, so nothing can regenerate it.
 *
 * The schema key is the ROW's width, not the header's. An append-only file
 * accumulates rows from several releases, so the header tells you only which
 * release last created a file — the row tells you which release wrote the row.
 * Rewriting the header alone would misalign every historical row; remapping
 * each row by column NAME into the current order is what makes this safe.
 *
 * Only one schema change was ever an insertion: filtered_posting_age at index
 * 8, which is why width 14 needs its own entry below. Every other change
 * appended, so generations 15..N are prefixes of the current header and are
 * derived rather than listed. A future append therefore needs no edit here; a
 * future insertion needs one new entry.
 *
 * A row whose width matches no known generation is passed through untouched and
 * reported. Guessing at it would be the one outcome worse than leaving it out.
 *
 * A counter a row's schema never recorded is left EMPTY, not zero: the run did
 * not filter zero postings by age, it predates that counter. Number('') is 0,
 * so stats.mjs folds it exactly as a 0 would, and the file keeps saying
 * "unrecorded" instead of asserting a measurement that was never taken.
 *
 * Usage:
 *   node migrate-scan-runs.mjs                   # dry run (default) — reports, writes nothing
 *   node migrate-scan-runs.mjs --apply           # rewrite in place, after saving <file>.bak
 *   node migrate-scan-runs.mjs --file <path>     # target a file other than the resolved default
 *   node migrate-scan-runs.mjs --json            # machine-readable summary
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { SCAN_RUNS_HEADER, atomicWriteFile } from './scan.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';

/** Current column order, taken from scan.mjs so this can never drift from the writer. */
export const CURRENT_COLUMNS = SCAN_RUNS_HEADER.trim().split('\t');

/**
 * The only generation that is not a prefix of the current header:
 * filtered_posting_age was INSERTED at index 8 rather than appended.
 */
const GEN_14 = ['timestamp', 'status', 'companies', 'boards', 'found', 'filtered_title',
  'filtered_tier', 'filtered_location', 'filtered_salary', 'filtered_content',
  'filtered_cooldown', 'dupes', 'new_added', 'errors'];

/** width → the column names the release that wrote a row of that width used. */
export function schemasByWidth() {
  const byWidth = new Map([[GEN_14.length, GEN_14]]);
  for (let n = GEN_14.length + 1; n <= CURRENT_COLUMNS.length; n++) {
    byWidth.set(n, CURRENT_COLUMNS.slice(0, n));
  }
  return byWidth;
}

/**
 * Migrate scan-runs.tsv text onto the current schema.
 *
 * Pure and idempotent: migrating already-migrated text returns it unchanged.
 *
 * @param {string} text - Full contents of scan-runs.tsv.
 * @returns {{text: string, changed: boolean, headerMigrated: boolean,
 *            migratedRows: number, passedThrough: number, refused: string|null}}
 */
export function migrateScanRuns(text) {
  const raw = String(text ?? '');
  const unchanged = (refused = null) => ({
    text: raw, changed: false, headerMigrated: false, migratedRows: 0, passedThrough: 0, refused,
  });
  if (!raw.trim()) return unchanged('empty file');

  // Normalize CRLF before splitting on tabs. A CRLF file leaves the CR on the
  // LAST cell of each row, and remapping moves that cell into the middle of the
  // row, embedding a CR inside the line. computeRunStats strips \r globally and
  // would still parse it, but the file itself would be malformed for every
  // other reader. Output is LF, which is what appendScanRunSummary writes.
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const endsWithNewline = lines[lines.length - 1] === '';
  if (endsWithNewline) lines.pop();

  // Refuse a file whose first line is not a header. Replacing it would destroy a
  // data row, and this tool exists to save history, not to spend it.
  if (!lines[0].split('\t').includes('timestamp')) return unchanged('first line is not a header');

  const byWidth = schemasByWidth();
  const currentLine = CURRENT_COLUMNS.join('\t');
  const out = [currentLine];
  let migratedRows = 0;
  let passedThrough = 0;

  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    if (!line.trim() || cells.length === CURRENT_COLUMNS.length) { out.push(line); continue; }
    const schema = byWidth.get(cells.length);
    if (!schema) { out.push(line); passedThrough++; continue; }
    const byName = new Map(schema.map((name, i) => [name, cells[i]]));
    out.push(CURRENT_COLUMNS.map((name) => byName.get(name) ?? '').join('\t'));
    migratedRows++;
  }

  const migrated = out.join('\n') + (endsWithNewline ? '\n' : '');
  return {
    text: migrated,
    changed: migrated !== raw,
    headerMigrated: lines[0] !== currentLine,
    migratedRows,
    passedThrough,
    refused: null,
  };
}

/**
 * Replace the scan-runs file with migrated text, but only if it still holds the
 * snapshot the migration was computed from.
 *
 * appendScanRunSummary() appends a run with a bare appendFileSync and takes no
 * lock, so a scan finishing mid-migration would otherwise be erased: the
 * snapshot is read, the scan appends its row, and the replacement writes back a
 * file that never contained it. The .bak does not help — it holds the snapshot,
 * which is missing that run too — and an atomic replace does not either, since
 * atomicity is about torn writes, not about staleness.
 *
 * Locked AND compared, because neither alone is enough.
 *
 * An earlier version of this comment claimed a lock here would be theatre and
 * that comparing made the losing case "a refusal, never a lost run". Both were
 * wrong. scan.mjs already imports withPipelineLock and already wraps the
 * sibling append-only TSV in it at appendToScanHistory, so the pattern was one
 * function away, not a new hot-path cost. And the compare alone left a window
 * between the read and the rename: measured at about 9ms, and reproduced at 48
 * lost rows over 120 trials, every one of them reporting written: true.
 *
 * So the completed-run append in scan.mjs now takes this same lock, and this
 * side takes it too. The compare stays inside the lock: it still catches an
 * append that landed before the lock was acquired, and it is what makes the
 * refusal meaningful rather than decorative.
 *
 * One writer stays outside it. writeRunFailureRow runs from the SIGINT and
 * fatal paths, which exit with nothing able to await, so a failure row can
 * still be lost to a concurrent migration. That is stated at its definition.
 *
 * @param {string} target - Path to scan-runs.tsv.
 * @param {string} snapshot - Exact text the migration was computed from.
 * @param {string} text - Migrated text to write.
 * @returns {{written: boolean, reason: string|null}}
 */
export async function writeMigrated(target, snapshot, text, lockOptions = {}) {
  // lockOptions is the same escape hatch acquirePipelineLock documents: a
  // caller (or a test standing in for a mid-append scan) can shorten the wait
  // without threading options through every frame.
  return withPipelineLock(target, () => {
    if (readFileSync(target, 'utf-8') !== snapshot) {
      return { written: false, reason: 'file changed since it was read' };
    }
    // The backup is written from the snapshot already in memory, so the live
    // file is not read again between the check above and the replace below.
    writeFileSync(`${target}.bak`, snapshot, 'utf-8');
    atomicWriteFile(target, text);
    return { written: true, reason: null };
  }, lockOptions);
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const asJson = argv.includes('--json');
  const fileArg = argv.indexOf('--file');
  // getCareerOpsRoot, not CAREER_OPS_ROOT directly: the data root also honours
  // CAREER_OPS_DATA_DIR and a .career-ops-data marker file, and falls back to
  // the REPO root rather than the cwd. Resolving it by hand here would miss the
  // marker and would target the wrong file when run from a subdirectory.
  const target = fileArg !== -1 && argv[fileArg + 1]
    ? path.resolve(argv[fileArg + 1])
    : path.join(getCareerOpsRoot(), 'data/scan-runs.tsv');

  if (!existsSync(target)) {
    console.error(`No scan-runs file at ${target} — nothing to migrate.`);
    process.exit(1);
  }

  const before = readFileSync(target, 'utf-8');
  const result = migrateScanRuns(before);

  if (asJson) {
    console.log(JSON.stringify({ file: target, applied: apply && result.changed, ...result, text: undefined }, null, 2));
  } else if (result.refused) {
    console.log(`Refused: ${result.refused} (${target})`);
  } else if (!result.changed) {
    console.log(`Already on the current schema: ${target}`);
  } else {
    console.log(`${target}`);
    console.log(`  header migrated: ${result.headerMigrated}`);
    console.log(`  rows migrated:   ${result.migratedRows}`);
    console.log(`  rows passed through (unrecognized width): ${result.passedThrough}`);
    console.log(apply ? `  applying — original saved to ${target}.bak` : '  dry run — nothing written. Re-run with --apply to write.');
  }

  if (apply && result.changed) {
    const { written, reason } = await writeMigrated(target, before, result.text);
    if (!written) {
      console.error(`Refused to write ${target}: ${reason}. A scan most likely appended a run `
        + 'while this was migrating. Nothing was changed — re-run the command.');
      process.exit(2);
    }
  }
}
