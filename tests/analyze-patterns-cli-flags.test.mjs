// tests/analyze-patterns-cli-flags.test.mjs -- CLI flag validation for
// analyze-patterns.mjs (#2979).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'analyze-patterns.mjs');
const VALID_FLAGS = [
  '--min-threshold',
  '--min-vendor-n',
  '--self-test',
  '--summary',
  '--help',
  '-h',
];

function runAnalyze(...args) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-analyze-flags-'));
  try {
    // Analysis requires a nonempty tracker even when the minimum is zero.
    // One fictional submitted application stays below the default floor of 5
    // but permits analysis when the test explicitly lowers the floor to 1.
    mkdirSync(join(dataRoot, 'data'));
    writeFileSync(join(dataRoot, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-01 | Example Co | Engineer | 4.0 | Applied | - | - | - |',
      '',
    ].join('\n'), 'utf-8');

    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
    });
    assert.equal(result.error, undefined, `analyze-patterns.mjs failed to spawn: ${result.error?.message}`);
    assert.equal(result.signal, null, `analyze-patterns.mjs was killed by ${result.signal} (timeout?)`);
    return { ...result, all: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

test('analyze-patterns rejects an unrecognized flag and lists the valid flags', () => {
  const result = runAnalyze('--no-such-flag');

  assert.equal(result.status, 1, `exited ${result.status}, want 1`);
  assert.match(result.all, /unrecognized flag\(s\): --no-such-flag/i);
  for (const flag of VALID_FLAGS) {
    assert.ok(result.all.includes(flag), `valid flag ${flag} was not listed`);
  }
});

test('analyze-patterns help exits before reading application data', () => {
  for (const flag of ['--help', '-h']) {
    const result = runAnalyze(flag);

    assert.equal(result.status, 0, `${flag} exited ${result.status}, want 0`);
    assert.match(result.stdout, /Usage:/i, `${flag} printed no usage block`);
    assert.match(result.stdout, /node analyze-patterns\.mjs/, `${flag} did not identify the command`);
    assert.doesNotMatch(result.all, /Not enough data/i, `${flag} continued into application analysis`);
  }
});

test('analyze-patterns rejects an unrecognized flag before handling help', () => {
  const result = runAnalyze('--help', '--no-such-flag');

  assert.equal(result.status, 1, `exited ${result.status}, want 1`);
  assert.match(result.all, /unrecognized flag\(s\): --no-such-flag/i);
  assert.doesNotMatch(result.stdout, /Usage:/i, 'help hid the unrecognized flag error');
});

test('analyze-patterns preserves valid value flags in spaced and equals forms', () => {
  const spaced = runAnalyze('--min-threshold', '1', '--min-vendor-n', '12');
  const equals = runAnalyze('--min-threshold=1', '--min-vendor-n=12');

  assert.equal(spaced.status, 0, `spaced flags exited ${spaced.status}, want 0: ${spaced.all}`);
  assert.equal(equals.status, 0, `equals flags exited ${equals.status}, want 0: ${equals.all}`);

  const spacedResult = JSON.parse(spaced.stdout);
  const equalsResult = JSON.parse(equals.stdout);
  assert.equal(spacedResult.vendorAnalysis.minSampleForClaim, 12);
  assert.equal(equalsResult.vendorAnalysis.minSampleForClaim, 12);
});
