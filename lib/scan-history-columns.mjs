/**
 * scan-history-columns.mjs — the column layout of `scan-history.tsv`, and the
 * way to read a row by column name instead of by position.
 *
 * The file is positional and append-only. Every scanner appends one row per
 * posting it has seen; a column added later goes at the END of every newer
 * row, and rows written before it existed simply stop short. The header is
 * written only when the file is created and never rewritten, so an existing
 * file can carry an older, shorter header than its newest rows — or none at
 * all. That makes the order declared here, not the file's own header, the
 * authority on what each position means.
 *
 * What each column holds is documented in the Scan History table of
 * `modes/scan.md`. Adding a column: append its name to
 * {@link SCAN_HISTORY_COLUMNS}, fill it in the scanner's row writer
 * (`formatScanHistoryRow` in `scan.mjs`), and add a row to that table.
 *
 * Neither helper recognises the header row: its `url` cell is the literal
 * `url`, and callers skip it.
 *
 * Cells are stored with reversible spreadsheet-formula escaping
 * (`lib/tsv-formula-escape.mjs`), which {@link parseScanHistoryLine} undoes. A
 * reader that splits lines itself sees the stored form.
 *
 * No dependency beyond `lib/tsv-formula-escape.mjs`, so any script can import
 * it without loading the scanner.
 */

import { unescapeFormulaCell } from './tsv-formula-escape.mjs';

/**
 * The columns of `scan-history.tsv`, in file order — shared by the scanner's
 * row writer, the header of a freshly created file and every reader that goes
 * through {@link parseScanHistoryLine}.
 *
 * Append only: a new name goes at the END, never in between, and existing
 * names never move. Readers that still index the file by position rely on
 * that; list every scan-history reader with
 * `grep -rln "scan-history" --include=*.mjs --include=*.ts .`.
 */
export const SCAN_HISTORY_COLUMNS = Object.freeze([
  'url',
  'first_seen',
  'portal',
  'title',
  'company',
  'status',
  'location',
  'fingerprint',
  'posted_at',
  'trust_score',
  'trust_flags',
  'normalized_company',
  'requisition_id',
  'language',
]);

/**
 * One scan-history line as a record keyed by {@link SCAN_HISTORY_COLUMNS},
 * each cell with the formula escaping undone. A cell the line is too short to
 * carry is ''.
 *
 * @param {string} line - One raw line of scan-history.tsv.
 * @returns {Record<string, string>}
 */
export function parseScanHistoryLine(line) {
  const cells = String(line ?? '').split('\t');
  return Object.fromEntries(SCAN_HISTORY_COLUMNS.map((name, i) => [name, unescapeFormulaCell(cells[i] ?? '')]));
}

/**
 * Whether a scan-history line reaches the named column at all (the cell itself
 * may still be empty). {@link parseScanHistoryLine} reads a missing cell as '',
 * so a reader that must tell "absent" from "empty" asks this instead.
 *
 * @param {string} line - One raw line of scan-history.tsv.
 * @param {string} column - A name from {@link SCAN_HISTORY_COLUMNS}.
 * @returns {boolean}
 */
export function scanHistoryLineHasColumn(line, column) {
  const index = SCAN_HISTORY_COLUMNS.indexOf(column);
  if (index === -1) throw new Error(`scan-history-columns: unknown column "${column}"`);
  return String(line ?? '').split('\t').length > index;
}
