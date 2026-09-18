// Persistent board-existence memory for reverse ATS sweeps (#2840).
// Only a real HTTP 404 may advance a miss counter. Throttles, transport
// failures and DNS errors mean "unknown", never "dead".

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEAD_BOARD_HEADER = 'ats\tboard\tmisses\tlast_checked';
export const DEAD_BOARD_MISSES = 3;
export const DEAD_BOARD_RECHECK_DAYS = 30;

function key(ats, board) { return `${ats}\t${board}`; }

export function loadDeadBoards(file, now = Date.now()) {
  const rows = new Map();
  if (!existsSync(file)) return rows;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/).slice(1)) {
    const [ats, board, missesRaw, checked] = line.split('\t');
    const misses = Number(missesRaw);
    const lastChecked = Date.parse(checked || '');
    if (!ats || !board || !Number.isInteger(misses) || misses < 1 || !Number.isFinite(lastChecked)) continue;
    rows.set(key(ats, board), { ats, board, misses, lastChecked, now });
  }
  return rows;
}

export function boardKey(entry) {
  return String(entry?.careers_url || entry?.name || '').trim();
}

export function shouldSkipDeadBoard(rows, ats, board, now = Date.now()) {
  const row = rows.get(key(ats, board));
  return Boolean(row && row.misses >= DEAD_BOARD_MISSES && now - row.lastChecked < DEAD_BOARD_RECHECK_DAYS * 86_400_000);
}

export function recordBoardResult(rows, ats, board, status, now = Date.now()) {
  const rowKey = key(ats, board);
  if (status === 200) {
    rows.delete(rowKey);
    return;
  }
  const previous = rows.get(rowKey);
  if (status !== 404) {
    if (!previous || previous.misses < DEAD_BOARD_MISSES) {
      rows.delete(rowKey);
    } else {
      rows.set(rowKey, { ...previous, lastChecked: now });
    }
    return;
  }
  const misses = Math.min(DEAD_BOARD_MISSES, (previous?.misses || 0) + 1);
  rows.set(rowKey, { ats, board, misses, lastChecked: now });
}

export function saveDeadBoards(file, rows) {
  mkdirSync(dirname(file), { recursive: true });
  const body = [...rows.values()]
    .sort((a, b) => a.ats.localeCompare(b.ats) || a.board.localeCompare(b.board))
    .map((row) => `${row.ats}\t${row.board}\t${row.misses}\t${new Date(row.lastChecked).toISOString()}`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${DEAD_BOARD_HEADER}\n${body.length ? `${body.join('\n')}\n` : ''}`, 'utf8');
  renameSync(tmp, file);
}
