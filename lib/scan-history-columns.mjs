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
  'listing_key',
  'closes_at',
]);

/**
 * Statuses recorded for VISIBILITY only, which must never pin a URL for dedup.
 *
 * Every other skipped status describes the posting: a dead URL stays dead
 * until the configured recheck window releases it (see
 * RECHECKABLE_SCAN_HISTORY_STATUSES), a blocked host stays blocked, so pinning
 * saves a later scan the work. These four describe something else.
 *
 * `skipped_title`, `skipped_location` and `skipped_age` describe the user's
 * CONFIG — `title_filter`, `location_filter` and `max_posting_age_days` are
 * settings they edit. Pinning would mean a role dropped under the old setting
 * never resurfaces under the new one, which is the opposite of what recording
 * the drop is for: a keyword added to `title_filter.positive` has to hand back
 * the titles it now matches. For those three, not pinning is also free: each
 * cut runs on data the provider already returned, before any liveness
 * verification, so a re-scan of one of these URLs costs no extra request.
 *
 * `skipped_no_apply_control` describes the CHECK: the browser classifier did
 * not see an Apply control, which is not proof the posting is closed. On
 * boards whose button it does not recognise, pinning would drop a live posting
 * once and never offer it again (#4832). Unlike the other two, this verdict
 * comes from a browser load, so every `--verify` scan re-opens the posting for
 * as long as the provider lists it. That is the accepted price: a slower
 * `--verify` beats a posting lost for good, and it shrinks as the classifier
 * learns each board, since a posting that reads `active` gets an `added` row
 * and stops coming back.
 *
 * `skipped_content`, `skipped_visa` and `skipped_country_eligibility` are
 * scan-dayforce.mjs's rows for its `content_filter`, visa and
 * `country_eligibility_filter` cuts: CONFIG again, by the same reasoning as the
 * first three. They were missing here, so they fell through to the permanent
 * pin, and widening one of those filters never handed back a Dayforce posting
 * it had dropped. (scan.mjs counts the same cuts and records no row for them.)
 *
 * `collectSeenCompanyRoles` needs no companion change — it already seeds from
 * `added` rows alone.
 */
export const OBSERVATIONAL_SCAN_HISTORY_STATUSES = new Set([
  'skipped_title',
  'skipped_location',
  'skipped_age',
  'skipped_no_apply_control',
  'skipped_content',
  'skipped_visa',
  'skipped_country_eligibility',
  'skipped_experience',
]);


/**
 * The data lines of a scan-history.tsv text, with line 0 dropped only when it
 * IS the header. A headerless legacy file starts with a data row, and a reader
 * that always dropped line 0 lost that row. #4807 fixed this in scan.mjs's
 * collectSeenUrls; the other readers kept the blind `.slice(1)`, so one file
 * could be read with its first row in one place and without it in another.
 *
 * @param {string|null|undefined} text - Raw scan-history.tsv content.
 * @returns {string[]}
 */
export function scanHistoryDataLines(text) {
  const lines = String(text ?? '').split('\n');
  if (lines[0].startsWith('url\t')) lines.shift();
  return lines;
}
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
  const row = {};
  for (let i = 0; i < SCAN_HISTORY_COLUMNS.length; i++) {
    row[SCAN_HISTORY_COLUMNS[i]] = unescapeFormulaCell(cells[i] ?? '');
  }
  return row;
}

/**
 * Every data row of a scan-history file, parsed once.
 *
 * Callers that need several views (seen URLs, posting attributes, company
 * roles, fingerprints) share this array. Parsing the text again would repeat
 * the split and the formula unescape for every view. The header rule stays in
 * {@link scanHistoryDataLines}, so a headerless file still keeps its first row.
 *
 * @param {string|null|undefined} text - Raw scan-history.tsv content.
 * @returns {Array<Record<string, string>>}
 */
export function parsedScanHistory(text) {
  const rows = [];
  for (const line of scanHistoryDataLines(text)) {
    rows.push(parseScanHistoryLine(line));
  }
  return rows;
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
