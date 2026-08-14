import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail } from './helpers.mjs';
import { boardKey, loadDeadBoards, recordBoardResult, saveDeadBoards, shouldSkipDeadBoard } from '../dead-boards.mjs';

console.log('\nPersistent dead-board memory (#2840)');
const root = mkdtempSync(join(tmpdir(), 'career-ops-dead-boards-'));
const file = join(root, 'data', 'dead-boards.tsv');
const now = Date.parse('2026-08-14T00:00:00Z');
try {
  const rows = loadDeadBoards(file, now);
  const board = boardKey({ careers_url: 'https://jobs.example.test/acme' });
  recordBoardResult(rows, 'lever', board, 500, now);
  recordBoardResult(rows, 'lever', board, 404, now);
  recordBoardResult(rows, 'lever', board, 404, now);
  if (!shouldSkipDeadBoard(rows, 'lever', board, now)) pass('fewer than three 404s never retires a board');
  else fail('a board was retired before three consecutive 404s');
  recordBoardResult(rows, 'lever', board, 404, now);
  if (shouldSkipDeadBoard(rows, 'lever', board, now)) pass('three 404s retire a board for the re-probe window');
  else fail('three 404s did not retire a board');
  recordBoardResult(rows, 'lever', board, 429, now);
  if (shouldSkipDeadBoard(rows, 'lever', board, now)) pass('429 does not create or clear a dead-board record');
  else fail('429 incorrectly changed dead-board state');
  recordBoardResult(rows, 'lever', board, 200, now);
  if (!shouldSkipDeadBoard(rows, 'lever', board, now)) pass('a successful response clears a retired board');
  else fail('a successful response left a board retired');
  recordBoardResult(rows, 'lever', board, 404, now);
  recordBoardResult(rows, 'lever', board, 404, now);
  recordBoardResult(rows, 'lever', board, 404, now);
  saveDeadBoards(file, rows);
  if (/^ats\tboard\tmisses\tlast_checked\nlever\t/.test(readFileSync(file, 'utf8'))) pass('dead-board store persists the safe TSV contract');
  else fail('dead-board store wrote an invalid TSV contract');
} finally {
  rmSync(root, { recursive: true, force: true });
}
