import path from 'node:path';
import { detectColumns, parseTrackerRow, isHeaderRow, isSeparatorRow } from '../tracker-parse.mjs';
import { postingKey } from '../url-key.mjs';

/** Header-aware update of a specific application; all workflow cells stay intact. */
export function attachEvaluationToRow(content, { target, url, score, reportPath, trackerPath, reportNum }) {
  if (!target || !/^[1-9]\d*$/.test(String(target.num)) || typeof target.expectedReport !== 'string'
    || typeof target.expectedCompany !== 'string' || typeof target.expectedRole !== 'string') throw new Error('Invalid target application.');
  const chunks = content.split(/(\r?\n)/);
  let columns = null, width = 0;
  const matches = [];
  for (let i = 0; i < chunks.length; i += 2) {
    const line = chunks[i];
    if (!line.trim().startsWith('|')) { columns = null; continue; }
    if (isHeaderRow(line)) { columns = detectColumns([line]); width = line.split('|').length; continue; }
    if (!columns || isSeparatorRow(line)) continue;
    const cells = line.split('|');
    if (!/^\d+$/.test(cells[columns.num]?.trim() || '') || Number(cells[columns.num]) !== Number(target.num)) continue;
    if (cells.length !== width || columns.score == null || columns.report == null) throw new Error('The target tracker row is malformed or missing score/report columns.');
    const row = parseTrackerRow(line, columns);
    if (!row) throw new Error('The target tracker row could not be read.');
    matches.push({ i, cells, columns, row });
  }
  if (matches.length !== 1) throw new Error('The target application is missing or duplicated. Refresh before retrying.');
  const { i, cells, columns: map, row } = matches[0];
  if (row.company !== target.expectedCompany || row.role !== target.expectedRole || row.report !== target.expectedReport) {
    throw new Error('This application changed during evaluation. The existing report was kept; refresh before retrying.');
  }
  const existingUrl = postingKey(row.url);
  if (existingUrl && existingUrl !== postingKey(url)) throw new Error('The posting URL no longer matches this application.');
  function set(key, value) {
    const old = cells[map[key]];
    cells[map[key]] = old.match(/^\s*/)[0] + value + old.match(/\s*$/)[0];
  }
  const relative = path.relative(path.dirname(trackerPath), reportPath).split(path.sep).join('/');
  if (/[|\r\n]/.test(relative)) throw new Error('The report path cannot be stored in the tracker.');
  set('score', score);
  // Keep prior versions linked from this same row, newest first, so the
  // canonical verifier can distinguish retained versions from orphan reports.
  const previous = /\[\d+\]\([^)]+\)/.test(row.report) ? ` · ${row.report}` : '';
  set('report', `[${reportNum}](${relative})${previous}`);
  if (!existingUrl && map.url != null) set('url', url.replace(/\|/g, '%7C'));
  chunks[i] = cells.join('|');
  return chunks.join('');
}
