import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, describeSpawn } from './helpers.mjs';

function trackerRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'tracker-min-score-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-09-01 | Acme | Analytics Engineer | 4.6/5 | Evaluated | ❌ | — | fictional |',
    '| 2 | 2026-09-02 | Globex | Data Analyst | 4.0/5 | Evaluated | ❌ | — | fictional |',
    '| 3 | 2026-09-03 | Initech | BI Engineer | 3.9/5 | Evaluated | ❌ | — | fictional |',
    '| 4 | 2026-09-04 | Hooli | Product Analyst | — | Evaluated | ❌ | — | fictional |',
    '| 5 | 2026-09-05 | Umbrella | Analytics Lead | 4.8/5 | Applied | ✅ | — | fictional |',
    '| 6 | 2026-09-06 | Vandelay | Data Analyst | 4,5/5 | Evaluated | ❌ | — | fictional |',
  ].join('\n') + '\n');
  return root;
}

function query(root, args) {
  return spawnSync(process.execPath, [join(ROOT, 'tracker.mjs'), 'query', '--json', ...args], {
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root }, encoding: 'utf8', timeout: 20_000,
  });
}

test('--min-score keeps rows scored at or above the threshold', (t) => {
  const root = trackerRoot(t);
  const result = query(root, ['--min-score', '4']);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.deepEqual(JSON.parse(result.stdout).map((r) => r.id).sort((a, b) => a - b), [1, 2, 5, 6]);
});

test('--min-score combines with --status to list the best rows not yet applied to', (t) => {
  const root = trackerRoot(t);
  const result = query(root, ['--status', 'Evaluated', '--min-score=4.5']);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.deepEqual(JSON.parse(result.stdout).map((r) => r.id).sort((a, b) => a - b), [1, 6]);
});

test('--min-score rejects a value that is not a score from 0 to 5', (t) => {
  const root = trackerRoot(t);
  for (const bad of ['high', '6', '-1', '']) {
    const result = query(root, ['--min-score', bad]);
    assert.equal(result.status, 1, describeSpawn(result, `--min-score ${bad}`));
    assert.match(result.stderr, /--min-score must be a number from 0 to 5/);
  }
});
