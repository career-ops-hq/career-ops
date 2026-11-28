import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanHistoryLine, parsedScanHistory, scanHistoryDataLines, SCAN_HISTORY_COLUMNS } from '../lib/scan-history-columns.mjs';

const shortRow = 'https://jobs.example.com/acme/1\t2026-11-01\tgreenhouse\tPlatform Engineer\tAcme\tadded';

test('scanHistoryDataLines strips the carriage return from CRLF lines', () => {
  const text = `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\r\n${shortRow}\r\n`;
  const lines = scanHistoryDataLines(text);
  assert.equal(lines[0], shortRow);
  assert.equal(lines.some((line) => line.endsWith('\r')), false);
});

test('a short CRLF scan-history row reads its status without a carriage return', () => {
  const text = `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\r\n${shortRow}\r\n`;
  const row = parseScanHistoryLine(scanHistoryDataLines(text)[0]);
  assert.equal(row.status, 'added');
  assert.equal(row.url, 'https://jobs.example.com/acme/1');
});

test('a full CRLF scan-history row reads its last column without a carriage return', () => {
  const cells = SCAN_HISTORY_COLUMNS.map((name) => name === 'employment_type' ? 'full-time' : `${name}-value`);
  const text = `${SCAN_HISTORY_COLUMNS.join('\t')}\r\n${cells.join('\t')}\r\n`;
  const rows = parsedScanHistory(text);
  assert.equal(rows[0].employment_type, 'full-time');
});
