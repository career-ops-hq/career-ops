// tests/board-truncation.test.mjs — lib/board-truncation.mjs, the one reading
// of "this board was only partly read" that scan.mjs uses to log a board
// `partial` instead of `reachable` (Google AIP-217: report what was not reached).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { boardTruncation, markTruncated, describeTruncation } from '../lib/board-truncation.mjs';
import { computeConsecutiveFailures } from '../scan.mjs';

test('a whole board reads as not truncated', () => {
  assert.equal(boardTruncation([{ title: 'a' }]), null);
  assert.equal(boardTruncation([]), null);
  assert.equal(boardTruncation(undefined), null);
});

test('canonical truncated object carries reason and counts', () => {
  const jobs = markTruncated([{ title: 'a' }], 'page-cap', { fetched: 100, total: 340 });
  assert.deepEqual(boardTruncation(jobs), { reason: 'page-cap', fetched: 100, total: 340, source: 'truncated' });
});

test('markTruncated keeps its reason argument even if counts carries one', () => {
  const jobs = markTruncated([], 'page-cap', /** @type {any} */ ({ fetched: 5, reason: 'other' }));
  assert.equal(boardTruncation(jobs)?.reason, 'page-cap');
});

test('legacy per-provider tags are recognized without provider changes', () => {
  const eightfold = Object.assign([{ title: 'a' }], { eightfoldTruncated: true });
  assert.deepEqual(boardTruncation(eightfold), { reason: 'cap-or-fetch-error', source: 'eightfoldTruncated' });
  const workday = Object.assign([], { workdayTruncated: 'transient' });
  assert.equal(boardTruncation(workday)?.reason, 'transient');
  const jobstreet = Object.assign([], { jobstreetTruncated: { reason: 'cap' } });
  assert.equal(boardTruncation(jobstreet)?.reason, 'cap');
  const peoplesoft = Object.assign([{ title: 'a' }], { peoplesoftIncomplete: { complete: false, reason: 'load-more-failed' } });
  assert.deepEqual(boardTruncation(peoplesoft), { reason: 'load-more-failed', source: 'peoplesoftIncomplete' });
});

test('a falsy legacy tag and unrelated properties are ignored', () => {
  assert.equal(boardTruncation(Object.assign([], { workdayTruncated: false })), null);
  assert.equal(boardTruncation(Object.assign([], { Truncated: true, workdayNoDateSkip: 3 })), null);
});

test('summary fragment names counts when known', () => {
  assert.equal(describeTruncation('Apple', { reason: 'page-cap', fetched: 100, total: 340, source: 'truncated' }), 'Apple (page-cap, 100 of 340)');
  assert.equal(describeTruncation('Netflix', { reason: 'rate-limited', fetched: 100, source: 'truncated' }), 'Netflix (rate-limited, 100 read)');
  assert.equal(describeTruncation('X', { reason: 'incomplete', source: 'xTruncated' }), 'X (incomplete)');
});

test('a partial board counts toward the persistent-failure streak; a whole read resets it', () => {
  const streaks = computeConsecutiveFailures([
    { company: 'Apple', status: 'partial' },
    { company: 'Apple', status: 'partial' },
    { company: 'Apple', status: 'partial' },
    { company: 'Cisco', status: 'partial' },
    { company: 'Cisco', status: 'reachable' },
  ]);
  assert.equal(streaks.get('Apple'), 3);
  assert.equal(streaks.get('Cisco'), 0);
});

test('scan logs a partly-read board `partial` in health and the --json receipt, even when it read nothing', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-partial-board-'));
  try {
    mkdirSync(join(dataRoot, 'config'));
    writeFileSync(join(dataRoot, 'config', 'profile.yml'), '{}\n');
    writeFileSync(join(dataRoot, 'portals.yml'), [
      'tracked_companies:',
      '  - name: Capped Board',
      '    provider: builtin',
      '  - name: Empty Tagged Board',
      '    provider: builtin',
      '  - name: Whole Board',
      '    provider: builtin',
      'job_boards: []',
      '',
    ].join('\n'));
    const preload = join(dataRoot, 'stub-provider.mjs');
    writeFileSync(preload, [
      `import provider from ${JSON.stringify(new URL('../providers/builtin.mjs', import.meta.url).href)};`,
      `provider.fetch = async (entry) => {`,
      `  const job = { title: 'Some Role', url: 'https://builtin.com/job/' + encodeURIComponent(entry.name), company: entry.name, location: 'Remote' };`,
      `  if (entry.name === 'Capped Board') return Object.assign([job], { truncated: { reason: 'page-cap', fetched: 1, total: 40 } });`,
      `  if (entry.name === 'Empty Tagged Board') return Object.assign([], { workdayTruncated: 'transient' });`,
      `  return [job];`,
      `};`,
    ].join('\n'));
    // Drop every inherited CAREER_OPS_* override (pipeline, scan history,
    // tracker, profile, data dir, cache, ...) so the scan reads and writes only
    // inside dataRoot, never a developer's real files.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CAREER_OPS_')));
    const result = spawnSync(process.execPath, [
      '--import', pathToFileURL(preload).href, fileURLToPath(new URL('../scan.mjs', import.meta.url)), '--json', '--quiet',
    ], {
      cwd: dataRoot,
      env: { ...env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_PORTALS: join(dataRoot, 'portals.yml') },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, describeSpawn(result));
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(receipt.partial, [
      { company: 'Capped Board', reason: 'page-cap', fetched: 1, total: 40 },
      { company: 'Empty Tagged Board', reason: 'transient' },
    ]);
    const health = readFileSync(join(dataRoot, 'data', 'portal-health.tsv'), 'utf8');
    assert.match(health, /\tCapped Board\tpartial(?:\r?\n|$)/);
    assert.match(health, /\tEmpty Tagged Board\tpartial(?:\r?\n|$)/);
    assert.match(health, /\tWhole Board\treachable(?:\r?\n|$)/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
