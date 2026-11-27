// A board that fails on a transient error (timeout, reset, 5xx) during the
// concurrent sweep gets one more attempt, alone, after the sweep — the
// contention that caused the failure is gone by then (Marvell, 2026-11-07:
// four page-0 timeouts mid-sweep, a clean 26 s read on its own). A permanent
// failure is not retried.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = join(ROOT, 'scan.mjs');

function run(script) {
  const dir = mkdtempSync(join(tmpdir(), 'co-scan-transient-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'profile.yml'), '{}\n');
  writeFileSync(join(dir, 'portals.yml'), [
    'title_filter:', '  positive:', '    - "Engineer"',
    'tracked_companies:',
    '  - name: Flaky Co',
    '    careers_url: https://self-hosted.example.com/careers',
    '    parser:', '      command: node', `      script: ${script}`,
    'job_boards: []', '',
  ].join('\n'));
  const marker = join(dir, 'runs.txt');
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith('CAREER_OPS_')) delete env[name];
  const result = spawnSync(process.execPath, [SCAN, '--quiet', '--dry-run'], {
    cwd: dir,
    env: { ...env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: join(dir, 'portals.yml'), CO_TEST_PARSER_MARKER: marker },
    encoding: 'utf-8',
  });
  let runs = 0;
  try { runs = readFileSync(marker, 'utf-8').trim().split('\n').filter(Boolean).length; } catch { /* never ran */ }
  return { dir, result, runs };
}

test('a board that failed on a transient error is retried once, alone, and its jobs count', () => {
  const { dir, result, runs } = run('tests/fixtures/flaky-parser.mjs');
  try {
    assert.equal(result.status, 0, describeSpawn(result));
    assert.equal(runs, 2, 'one failed attempt in the sweep, one retry after it');
    assert.match(result.stderr, /retrying 1 board\(s\) that failed on a transient error/);
    assert.match(result.stdout + result.stderr, /Total jobs found:\s+1\b/);
    assert.doesNotMatch(result.stdout + result.stderr, /Errors \(\d+\)|Network errors/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a permanent failure is not retried', () => {
  const { dir, result, runs } = run('tests/fixtures/failing-parser.mjs');
  try {
    assert.equal(runs, 1, describeSpawn(result));
    assert.doesNotMatch(result.stderr, /retrying/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
