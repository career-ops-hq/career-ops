import { pass, fail, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEDUP = join(dirname(fileURLToPath(import.meta.url)), '..', 'dedup-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

ok('a hand-typed decimal-comma score wins the dedup keeper pick', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-comma-test-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, ['# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-03-02 | ExampleCorp | Platform Engineer | 4.1/5 | Evaluated | ❌ | [1](reports/001-examplecorp-2026-03-02.md) | |',
      '| 2 | 2026-03-02 | ExampleCorp | Platform Engineer | 4,2/5 | Evaluated | ❌ | [1](reports/001-examplecorp-2026-03-02.md) | |', ''].join('\n'));
    execFileSync(process.execPath, [DEDUP], { encoding: 'utf-8', env: { ...process.env, CAREER_OPS_TRACKER: tracker } });
    const rows = readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
    assert.deepEqual(rows.map(r => r.split('|')[5].trim()), ['4,2/5']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
