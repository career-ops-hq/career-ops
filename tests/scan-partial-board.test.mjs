// tests/scan-partial-board.test.mjs — a partly-read board is logged `partial`,
// not `reachable` (#6632).
//
// The stub provider below returns two jobs for "Partial Board" with the
// legacy `eightfoldTruncated` tag set, and one job for "Complete Board"
// with no tag. The scan must: log `partial` for the first board and
// `reachable` for the second in data/portal-health.tsv, list the partial
// board in the --json receipt and in the summary, and — after the streak
// threshold — in the PARTIAL BOARDS line.
//
// Run:  node --test tests/scan-partial-board.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeConsecutiveFailures } from '../scan.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

test('computeConsecutiveFailures counts partial like any other non-healthy status', () => {
  assert.equal(computeConsecutiveFailures([
    { company: 'Partial', status: 'partial' },
    { company: 'Partial', status: 'partial' },
    { company: 'Healthy', status: 'reachable' },
    { company: 'Partial', status: 'partial' },
  ]).get('Partial'), 3);
  assert.equal(computeConsecutiveFailures([
    { company: 'Partial', status: 'partial' },
    { company: 'Partial', status: 'reachable' },
  ]).get('Partial'), 0);
});

const STUB = [
  `import provider from ${JSON.stringify(new URL('../providers/builtin.mjs', import.meta.url).href)};`,
  `provider.fetch = async (entry, _ctx) => {`,
  `  if (entry.name === 'Partial Board') {`,
  `    const jobs = [`,
  `      { title: 'Software Engineer', url: 'https://example.com/jobs/1', company: 'Partial Board' },`,
  `      { title: 'Software Engineer', url: 'https://example.com/jobs/2', company: 'Partial Board' },`,
  `    ];`,
  `    jobs.eightfoldTruncated = true;`,
  `    return jobs;`,
  `  }`,
  `  return [{ title: 'Software Engineer', url: 'https://example.com/jobs/3', company: 'Complete Board' }];`,
  `};`,
].join('\n');

function workspace({ seedHealth = null } = {}) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-partial-board-'));
  mkdirSync(join(dataRoot, 'config'));
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  writeFileSync(join(dataRoot, 'config', 'profile.yml'), '{}\n');
  writeFileSync(join(dataRoot, 'portals.yml'), [
    'tracked_companies:',
    '  - name: Partial Board',
    '    provider: builtin',
    '  - name: Complete Board',
    '    provider: builtin',
    'job_boards: []',
    '',
  ].join('\n'));
  const preload = join(dataRoot, 'stub-provider.mjs');
  writeFileSync(preload, STUB);
  if (seedHealth !== null) writeFileSync(join(dataRoot, 'data', 'portal-health.tsv'), seedHealth);
  return { dataRoot, preload };
}

function runScan({ dataRoot, preload }) {
  return spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href, fileURLToPath(new URL('../scan.mjs', import.meta.url)), '--json', '--quiet',
  ], {
    cwd: dataRoot,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_PORTALS: join(dataRoot, 'portals.yml') },
    encoding: 'utf8',
    timeout: 30000,
  });
}

test('scan logs a truncated board partial and a complete board reachable', () => {
  const { dataRoot, preload } = workspace();
  try {
    const result = runScan({ dataRoot, preload });
    assert.equal(result.status, 0, describeSpawn(result));
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(receipt.partial, [{ company: 'Partial Board', reason: 'unknown', fetched: 2 }]);
    assert.deepEqual(receipt.unverified_zero, []);
    assert.deepEqual(receipt.errors, []);
    const health = readFileSync(join(dataRoot, 'data', 'portal-health.tsv'), 'utf8');
    assert.match(health, /\tPartial Board\tpartial(?:\r?\n|$)/);
    assert.match(health, /\tComplete Board\treachable(?:\r?\n|$)/);
    assert.match(result.stderr, /partly read.*Partial Board \(unknown, 2\)/);
    // Below the streak threshold, no PARTIAL BOARDS escalation yet.
    assert.doesNotMatch(result.stderr, /PARTIAL BOARDS/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('a partial streak at the threshold reaches the PARTIAL BOARDS line', () => {
  const { dataRoot, preload } = workspace({
    seedHealth: [
      'timestamp\tcompany\tstatus',
      '2026-11-06T00:00:00.000Z\tPartial Board\tpartial',
      '2026-11-07T00:00:00.000Z\tPartial Board\tpartial',
      '',
    ].join('\n'),
  });
  try {
    const result = runScan({ dataRoot, preload });
    assert.equal(result.status, 0, describeSpawn(result));
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(receipt.partial, [{ company: 'Partial Board', reason: 'unknown', fetched: 2 }]);
    assert.match(result.stderr, /PARTIAL BOARDS: 1 target\(s\) have been partly read for 3\+ runs/);
    assert.match(result.stderr, /Partial Board/);
    const health = readFileSync(join(dataRoot, 'data', 'portal-health.tsv'), 'utf8');
    assert.equal(health.split('\n').filter((l) => l.includes('\tPartial Board\tpartial')).length, 3);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
