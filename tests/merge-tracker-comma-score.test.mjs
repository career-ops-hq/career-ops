import { pass, fail, NODE, ROOT, rmSync, isolatedBatchStatePath } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

// Read period-only, a hand-typed 4,2 is 4, so a 4.1 re-eval would look like an
// upgrade and lose its superseded note.
ok('merge reads a decimal-comma tracker score as 4.2, not 4', () => {
  const work = mkdtempSync(join(tmpdir(), 'merge-comma-test-'));
  try {
    const tracker = join(work, 'applications.md');
    const adds = join(work, 'adds');
    mkdirSync(adds);
    writeFileSync(tracker, ['# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 7 | 2026-02-01 | ExampleCorp | Payments PM | 4,2/5 | Evaluated | ✅ | [7](../reports/7-examplecorp-2026-02-01.md) | original eval |', ''].join('\n'));
    writeFileSync(join(adds, '11-examplecorp.tsv'),
      '11\t2026-03-03\tExampleCorp\tPayments PM\tEvaluated\t4.1/5\t✅\t[11](reports/11-examplecorp-2026-03-03.md)\tre-scored\n');
    const output = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: adds, CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(adds) },
    });
    const row = readFileSync(tracker, 'utf-8').split('\n').find(l => /\bExampleCorp\b/.test(l)) || '';
    assert.match(row, /Superseded report/);
    assert.match(output, /DOWNGRADE/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
