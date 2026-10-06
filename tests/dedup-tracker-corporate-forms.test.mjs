import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pass, fail } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEDUP = join(HERE, '..', 'dedup-tracker.mjs');
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';
const dir = mkdtempSync(join(tmpdir(), 'dedup-corporate-forms-'));
const tracker = join(dir, 'applications.md');

try {
  writeFileSync(tracker, [
    '# Applications Tracker',
    '',
    HEADER,
    SEP,
    '| 1 | 2026-09-01 | Acme Widgets, APC | Fullstack Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-09-01.md) | first |',
    '| 2 | 2026-09-02 | Acme Widgets | Fullstack Engineer | 3.8/5 | Evaluated | ❌ | [2](reports/002-acme-2026-09-02.md) | second |',
    '',
  ].join('\n'));

  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [DEDUP], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_TRACKER: tracker },
  });

  const rows = readFileSync(tracker, 'utf-8').split('\n').filter(line => line.startsWith('|')
    && !/^\|[\s|:-]+\|\s*$/.test(line)
    && !/^\|\s*#\s*\|/.test(line));
  assert.deepEqual(rows.map(row => row.split('|')[1].trim()), ['1']);
  pass('dedup merges same-role rows differing only by the APC corporate suffix');
} catch (error) {
  process.exitCode = 1;
  fail(`dedup should merge Acme Widgets, APC with Acme Widgets — ${error.message}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
