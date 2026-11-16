// A status the state list does not name used to be stored as Evaluated.
// The addition stays pending, and the tracker does not gain that row.
//
// Run: node --test tests/merge-tracker-unknown-status.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedBatchStatePath } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '',
].join('\n');

const HEADED = [
  'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes',
  '1\t2026-02-01\tFixture Co\tEngineer\tPhone screen\t4.0/5\t❌\t[1](reports/001.md)\tscreen',
  '',
].join('\n');

function run(tsv) {
  const work = mkdtempSync(join(tmpdir(), 'cops-merge-status-'));
  const tracker = join(work, 'applications.md');
  const addsDir = join(work, 'adds');
  mkdirSync(addsDir);
  writeFileSync(tracker, HEADER);
  writeFileSync(join(addsDir, '1-fixture.tsv'), tsv);
  const r = spawnSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], {
    encoding: 'utf-8',
    timeout: 30_000,
    env: {
      ...process.env,
      CAREER_OPS_TRACKER: tracker,
      CAREER_OPS_ADDITIONS: addsDir,
      CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(addsDir),
    },
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const after = readFileSync(tracker, 'utf-8');
  const pending = readdirSync(addsDir).filter((name) => name.endsWith('.tsv'));
  rmSync(work, { recursive: true, force: true });
  return { status: r.status, output, after, pending };
}

test('an unknown status is left pending and is not stored as Evaluated', () => {
  const result = run(HEADED);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /status "Phone screen" is not a tracker state/);
  assert.match(result.output, /left pending/);
  assert.doesNotMatch(result.output, /defaulting to "Evaluated"/);
  assert.doesNotMatch(result.after, /Phone screen/);
  assert.doesNotMatch(result.after, /\|\s*Evaluated\s*\|/);
  assert.deepEqual(result.pending, ['1-fixture.tsv']);
});

test('a canonical status still merges', () => {
  const tsv = HEADED.replace('Phone screen', 'Applied');
  const result = run(tsv);
  assert.equal(result.status, 0, result.output);
  assert.match(result.after, /Fixture Co/);
  assert.match(result.after, /\|\s*Applied\s*\|/);
  assert.deepEqual(result.pending, []);
});
