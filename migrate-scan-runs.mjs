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

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { SCAN_RUNS_HEADER } from './scan.mjs';

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
    console.log(apply ? `  applied — original saved to ${target}.bak` : '  dry run — nothing written. Re-run with --apply to write.');
  }

  if (apply && result.changed) {
    copyFileSync(target, `${target}.bak`);
    writeFileSync(target, result.text, 'utf-8');
  }
}
