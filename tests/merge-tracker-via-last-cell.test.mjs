import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeTracker } from '../merge-tracker.mjs';
import { resolveColumns, parseTrackerRow } from '../tracker-parse.mjs';

const columns = ['#', 'Date', 'Company', 'Role', 'Score', 'Status', 'PDF', 'Report', 'Notes'];
const values = ['7', '2026-10-12', 'Acme', 'Engineer', '4.0/5', 'Applied', '❌', '—', 'Recruiter promised an interview'];
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const row = (cells, trailingPipe) => `| ${cells.join(' | ')}${trailingPipe ? ' |' : ''}`;

// A closing pipe is optional Markdown syntax. Adding Via must preserve the last
// real cell, whether it is Notes, a posting URL, or a user-owned custom column.
for (const extra of [null, ['URL', 'https://careers.acme.example/jobs/7'], ['Contact', 'recruiter@example.test']]) {
  for (const trailingPipe of [false, true]) {
    const label = `Via migration preserves ${extra?.[0] ?? 'Notes'} (${trailingPipe ? 'closing pipe' : 'no closing pipe'})`;
    const dir = mkdtempSync(join(tmpdir(), 'career-ops-via-last-cell-'));
    try {
      const appsFile = join(dir, 'applications.md');
      const labels = [...columns, ...(extra ? [extra[0]] : [])];
      const cells = [...values, ...(extra ? [extra[1]] : [])];
      const original = [
        '# Applications Tracker', '', row(labels, trailingPipe),
        row(labels.map(() => '---'), trailingPipe), row(cells, trailingPipe), '',
      ].join('\n');
      writeFileSync(appsFile, original);
      const options = {
        appsFile, dataRoot: dir, additionsDir: join(dir, 'additions'),
        batchStateFile: join(dir, 'batch-state.tsv'), logger: quiet,
      };

      assert.equal(await mergeTracker({ ...options, flags: { migrateVia: true, dryRun: true } }), 0);
      assert.equal(readFileSync(appsFile, 'utf8'), original, 'dry run must leave tracker bytes intact');
      assert.equal(await mergeTracker({ ...options, flags: { migrateVia: true } }), 0);
      const migrated = readFileSync(appsFile, 'utf8');
      const lines = migrated.split('\n');
      const dataLine = lines.find(line => line.startsWith('| 7 |'));
      assert.ok(dataLine.includes(cells.at(-1)), `last cell lost: ${dataLine}`);
      const migratedCells = dataLine.split('|').slice(1, -1).map(cell => cell.trim());
      assert.deepEqual(migratedCells, [...cells.slice(0, 3), '—', ...cells.slice(3)]);
      assert.deepEqual(lines[2].split('|').slice(1, -1).map(cell => cell.trim()), [...labels.slice(0, 3), 'Via', ...labels.slice(3)]);
      const parsed = parseTrackerRow(dataLine, resolveColumns(lines));
      assert.ok(parsed, 'migrated row must remain readable');
      assert.equal(parsed.notes, values.at(-1));

      assert.equal(await mergeTracker({ ...options, flags: { migrateVia: true } }), 0);
      assert.equal(readFileSync(appsFile, 'utf8'), migrated, 'migration must remain idempotent');
      pass(label);
    } catch (error) {
      fail(`${label}: ${error.message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}
