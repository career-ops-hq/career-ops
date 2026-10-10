// A failed report in the install's batch-state must not leak into an isolated
// merge-tracker fixture that redirects only its additions directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NODE, ROOT, run } from './helpers.mjs';

test('merge-tracker fixtures ignore failed rows from an inherited batch-state', (t) => {
  const work = mkdtempSync(join(tmpdir(), 'career-ops-merge-isolation-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const additions = join(work, 'tracker-additions');
  mkdirSync(additions);
  const tracker = join(work, 'applications.md');
  writeFileSync(tracker, [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|', '',
  ].join('\n'));
  writeFileSync(join(additions, '007-acme.tsv'),
    '7\t2026-10-03\tAcme\tEngineer\tEvaluated\t4.1/5\t❌\t[7](reports/007-acme.md)\tfixture\n');

  const inheritedState = join(work, 'install-batch-state.tsv');
  writeFileSync(inheritedState, 'id\tx\tstatus\tx\tx\treport_num\nworker\t-\tfailed\t-\t-\t007\n');
  const previousState = process.env.CAREER_OPS_BATCH_STATE;
  process.env.CAREER_OPS_BATCH_STATE = inheritedState;
  try {
    const output = run(NODE, ['merge-tracker.mjs'], {
      env: {
        ...process.env,
        CAREER_OPS_TRACKER: tracker,
        CAREER_OPS_ADDITIONS: additions,
      },
    });
    assert.notEqual(output, null, 'merge-tracker should complete against its fixture');
    assert.match(readFileSync(tracker, 'utf-8'), /\|\s*7\s*\|/);
  } finally {
    if (previousState === undefined) delete process.env.CAREER_OPS_BATCH_STATE;
    else process.env.CAREER_OPS_BATCH_STATE = previousState;
  }
});
