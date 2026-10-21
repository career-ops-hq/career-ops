import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'followup-cadence.mjs');

function runWithTracker(trackerContent) {
  const dir = mkdtempSync(join(tmpdir(), 'cadence-empty-'));
  try {
    mkdirSync(join(dir, 'data'));
    const tracker = join(dir, 'data', 'applications.md');
    writeFileSync(tracker, trackerContent);
    return spawnSync(process.execPath, [SCRIPT, '--json'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_TRACKER: tracker },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an empty tracker exits 0 with noData and a zeroed report', () => {
  const result = runWithTracker('# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n');
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stdout}${result.stderr}`);
  const json = JSON.parse(result.stdout);
  assert.equal(json.error, 'No applications found in tracker.');
  assert.equal(json.noData, true);
  assert.equal(json.cadenceDefaults.applied_first, 7);
  assert.deepEqual(json.entries, []);
  assert.equal(json.metadata.totalTracked, 0);
  assert.equal(json.metadata.actionable, 0);
  assert.equal(json.cadenceConfig.applied_first, 7);
});
