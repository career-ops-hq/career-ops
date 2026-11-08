// #6671: a board that failed on a transient fetch error gets one more attempt
// after the concurrent sweep, alone and after a short gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import {
  DEFAULT_RETRY_GAP_MS,
  isRetryableFetchFailure,
  resolveRetryGapMs,
  retryGapWithJitter,
  retryTransientFailures,
} from '../scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = join(ROOT, 'scan.mjs');

// ── unit ────────────────────────────────────────────────────────────

test('only a transient fetch failure is retryable', () => {
  assert.equal(isRetryableFetchFailure({ stage: 'fetch', kind: 'network' }), true);
  assert.equal(isRetryableFetchFailure({ stage: 'fetch', kind: 'server' }), true);
  for (const kind of ['auth', 'slug_gone', 'unknown', undefined]) {
    assert.equal(isRetryableFetchFailure({ stage: 'fetch', kind }), false, String(kind));
  }
  assert.equal(isRetryableFetchFailure({ stage: 'process', kind: 'network' }), false);
  assert.equal(isRetryableFetchFailure({ stage: 'process', kind: 'server' }), false);
  assert.equal(isRetryableFetchFailure({ kind: 'network' }), false);
  assert.equal(isRetryableFetchFailure(undefined), false);
});

test('retries run one at a time, once each, with a gap before each', async () => {
  const events = [];
  let active = 0;
  let maxActive = 0;
  const result = await retryTransientFailures(['a', 'b', 'c'], {
    gapMs: 1000,
    random: () => 0.5,
    sleep: async (ms) => { events.push(`sleep:${ms}`); },
    retryOne: async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      events.push(`try:${item}`);
      await Promise.resolve();
      active--;
      return item !== 'b';
    },
  });
  assert.deepEqual(events, [
    'sleep:1150', 'try:a',
    'sleep:1150', 'try:b',
    'sleep:1150', 'try:c',
  ]);
  assert.equal(maxActive, 1, 'never two retries in flight');
  assert.deepEqual(result, { attempted: 3, recovered: 2 });
});

test('an empty queue sleeps and retries nothing', async () => {
  let slept = 0;
  const result = await retryTransientFailures([], {
    sleep: async () => { slept++; },
    retryOne: async () => { throw new Error('must not run'); },
  });
  assert.equal(slept, 0);
  assert.deepEqual(result, { attempted: 0, recovered: 0 });
});

test('the gap carries bounded jitter', () => {
  assert.equal(retryGapWithJitter(1000, () => 0), 1000);
  assert.equal(retryGapWithJitter(1000, () => 0.999999), 1299);
});

test('resolveRetryGapMs accepts 0 and falls back on anything unusable', () => {
  assert.equal(resolveRetryGapMs(undefined), DEFAULT_RETRY_GAP_MS);
  assert.equal(resolveRetryGapMs(''), DEFAULT_RETRY_GAP_MS);
  assert.equal(resolveRetryGapMs('0'), 0);
  assert.equal(resolveRetryGapMs('250'), 250);
  for (const bad of ['-1', 'abc', '1.5', 'Infinity']) {
    assert.equal(resolveRetryGapMs(bad), DEFAULT_RETRY_GAP_MS, bad);
  }
});

// ── end to end ──────────────────────────────────────────────────────

const parserEntry = (name, script) => [
  `  - name: ${name}`,
  '    careers_url: https://self-hosted.example.com/careers',
  '    parser:',
  '      command: node',
  `      script: ${script}`,
];

function runScan(entries, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-scan-retry-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'profile.yml'), '{}\n');
  const portals = [
    'title_filter:', '  positive:', '    - "Engineer"',
    'tracked_companies:', ...entries.flat(), 'job_boards: []', '',
  ].join('\n');
  writeFileSync(join(dir, 'portals.yml'), portals);
  const marker = join(dir, 'parser-runs.txt');
  const base = { ...process.env };
  for (const name of Object.keys(base)) if (name.toUpperCase().startsWith('CAREER_OPS_')) delete base[name];
  const result = spawnSync(process.execPath, [SCAN, '--quiet'], {
    cwd: dir,
    env: {
      ...base,
      CAREER_OPS_ROOT: dir,
      CAREER_OPS_PORTALS: join(dir, 'portals.yml'),
      CAREER_OPS_SCAN_RETRY_GAP_MS: '0',
      CO_TEST_PARSER_MARKER: marker,
      ...env,
    },
    encoding: 'utf-8',
  });
  const runs = () => {
    try { return readFileSync(marker, 'utf-8').split('\n').filter(Boolean).length; } catch { return 0; }
  };
  return { dir, result, runs };
}

const FLAKY = 'tests/fixtures/flaky-parser.mjs';
const errorsColumn = (dir) => {
  const rows = readFileSync(join(dir, 'data', 'scan-runs.tsv'), 'utf-8').trim().split('\n').map(l => l.split('\t'));
  return rows[1][rows[0].indexOf('errors')];
};

test('a target that fails once on a transient error is recovered by the retry', () => {
  const { dir, result, runs } = runScan([parserEntry('Flaky Co', FLAKY)], { CO_TEST_FAIL_TIMES: '1' });
  try {
    assert.equal(result.status, 0, describeSpawn(result));
    assert.equal(runs(), 2, 'one first attempt, one retry');
    assert.match(result.stdout, /Retrying 1 target\(s\)/);
    assert.match(result.stdout, /Flaky Co: recovered/);
    assert.match(result.stdout, /New offers added:\s+1/);
    assert.doesNotMatch(result.stdout, /✗ Flaky Co:/);
    assert.equal(errorsColumn(dir), '0');
    assert.match(readFileSync(join(dir, 'data', 'portal-health.tsv'), 'utf-8'), /Flaky Co\treachable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a target that fails twice is retried once, not more, and stays an error', () => {
  const { dir, result, runs } = runScan([parserEntry('Flaky Co', FLAKY)], { CO_TEST_FAIL_TIMES: '5' });
  try {
    assert.equal(result.status, 2, describeSpawn(result));
    assert.equal(runs(), 2, 'at most one extra attempt');
    assert.match(result.stdout, /Flaky Co: failed again/);
    assert.match(result.stdout, /Network errors \(1\)/);
    assert.equal(errorsColumn(dir), '1', 'counted once, not once per attempt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-transient failure is never retried', () => {
  const { dir, result, runs } = runScan([parserEntry('Broken Co', 'tests/fixtures/failing-parser.mjs')]);
  try {
    assert.equal(result.status, 2, describeSpawn(result));
    assert.equal(runs(), 1, 'an unclassified failure gets no second attempt');
    assert.doesNotMatch(result.stdout, /Retrying/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('when every target fails transiently the scan skips the retry as an outage', () => {
  const { dir, result, runs } = runScan(
    [parserEntry('Flaky A', FLAKY), parserEntry('Flaky B', FLAKY)],
    { CO_TEST_FAIL_TIMES: '99' },
  );
  try {
    assert.equal(result.status, 2, describeSpawn(result));
    assert.equal(runs(), 2, 'each target attempted once; no retry pass');
    assert.match(result.stdout, /Skipping retry: all 2 targets failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only the failed target is retried; a healthy one is not scanned again', () => {
  const working = parserEntry('Working Co', 'tests/providers/_fixture-local-parser.mjs');
  const { dir, result, runs } = runScan([parserEntry('Flaky Co', FLAKY), working], { CO_TEST_FAIL_TIMES: '1' });
  try {
    assert.equal(result.status, 0, describeSpawn(result));
    assert.equal(runs(), 2, 'flaky ran twice');
    assert.match(result.stdout, /Retrying 1 target\(s\)/);
    assert.match(result.stdout, /1 of 1 recovered/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});