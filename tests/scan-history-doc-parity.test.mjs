// tests/scan-history-doc-parity.test.mjs — modes/scan.md must document the
// scan-history.tsv layout scan.mjs actually writes.
//
// modes/scan.md documents the scan-history.tsv column layout an agent-driven
// scan has to reproduce by hand. It drifted once already: the doc said "nine
// columns" and step 8b spelled out a six-column row while formatScanHistoryRow
// emits twelve (#3458). Nothing tied the doc to the writer. This asserts both
// surfaces under "## Scan History" — the fenced ```tsv header and the ordered
// "| N | `name` |" column table — match, position for position,
// SCAN_HISTORY_COLUMNS (the list appendToScanHistory writes as the header on
// fresh-file creation and formatScanHistoryRow writes every row through), and
// that step 8b no longer carries the short literal that can drift again.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';

const scanMode = readFileSync(join(ROOT, 'modes/scan.md'), 'utf-8');

const writerCols = [...SCAN_HISTORY_COLUMNS];
// Scope to the "## Scan History" section only (up to the next `##`/`###`
// heading) so the table parse can't pick up a numbered list elsewhere.
const sectionMatch = scanMode.match(/##\s*Scan History\b([\s\S]*?)(?:\r?\n#{2,3}\s|$)/);
const section = sectionMatch ? sectionMatch[1] : '';
const docMatch = section.match(/```tsv\r?\n([^\r\n]+)\r?\n/);
// Ordered column names from the "| N | `name` | ... |" table rows.
const tableCols = [...section.matchAll(/^\|\s*\d+\s*\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]);
if (!docMatch) {
  fail('scan-history header parity: could not find the fenced tsv header block under "## Scan History" in modes/scan.md');
} else if (tableCols.length === 0) {
  fail('scan-history header parity: could not parse the "| N | `name` |" column table under "## Scan History" in modes/scan.md');
} else {
  const docCols = docMatch[1].split('\t');
  const shortLiteral = scanMode.includes('{company}\\tadded');
  const tsvMatchesWriter = docCols.join('\\t') === writerCols.join('\\t');
  const tableMatchesWriter = tableCols.join('\\t') === writerCols.join('\\t');
  if (tsvMatchesWriter && tableMatchesWriter && !shortLiteral) {
    pass(`scan.md documents the scan-history.tsv layout matching formatScanHistoryRow (${writerCols.length} columns, in writer order)`);
  } else if (shortLiteral) {
    fail('scan.md step 8b still spells out the pre-#3458 six-column scan-history row (`{company}\\tadded`) — write the row through formatScanHistoryRow instead');
  } else if (!tsvMatchesWriter) {
    fail(`scan.md scan-history tsv example header drifted from SCAN_HISTORY_COLUMNS: doc has [${docCols.join(', ')}], writer emits [${writerCols.join(', ')}]`);
  } else {
    fail(`scan.md scan-history column table drifted from SCAN_HISTORY_COLUMNS (missing/extra/reordered): table has [${tableCols.join(', ')}], writer emits [${writerCols.join(', ')}]`);
  }
}
