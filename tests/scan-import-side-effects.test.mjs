import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN_URL = pathToFileURL(join(ROOT, 'scan.mjs')).href;

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'scan-import-'));
}

test('importing scan.mjs does not create the data directory', () => {
  const root = makeRoot();
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(SCAN_URL)});`], {
      cwd: root,
      env: { ...process.env, CAREER_OPS_ROOT: root },
      stdio: 'pipe',
    });
    assert.equal(existsSync(join(root, 'data')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('appendScanRunSummary creates the parent directory at write time', () => {
  const root = makeRoot();
  const output = join(root, 'nested', 'data', 'scan-runs.tsv');
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      const { appendScanRunSummary } = await import(${JSON.stringify(SCAN_URL)});
      appendScanRunSummary({ timestamp: '2026-09-07T00:00:00Z', companies: 0, boards: 0, found: 0,
        filteredTitle: 0, filteredTier: 0, filteredLocation: 0, filteredPostingAge: 0,
        filteredSalary: 0, filteredContent: 0, filteredCooldown: 0, dupes: 0, newAdded: 0, errors: 0 },
        ${JSON.stringify(output)});
    `], {
      cwd: root,
      env: { ...process.env, CAREER_OPS_ROOT: root },
      stdio: 'pipe',
    });
    assert.equal(existsSync(output), true);
    assert.equal(readFileSync(output, 'utf8').split('\n').length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
