// A scan in which every target fails read nothing, yet `node scan.mjs` exited
// 0, so a cron job or the web scheduler recorded an outage as a clean run with
// zero new offers. It now exits 2 when every target it tried failed, and keeps
// exiting 0 when at least one target was read or nothing was tried.
//
// Offline: the targets are local parsers over in-repo fixtures, one that always
// exits 1 and one that prints a job list. No provider claims their careers_url,
// so the failing parser has no API fallback to reach for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = join(ROOT, 'scan.mjs');

const FAILING = [
  '  - name: Failing Co',
  '    careers_url: https://self-hosted.example.com/careers',
  '    parser:',
  '      command: node',
  '      script: tests/fixtures/failing-parser.mjs',
];
const WORKING = [
  '  - name: Working Co',
  '    careers_url: https://self-hosted.example.com/jobs',
  '    parser:',
  '      command: node',
  '      script: tests/providers/_fixture-local-parser.mjs',
];

function portals(...entries) {
  const companies = entries.length ? ['tracked_companies:', ...entries.flat()] : ['tracked_companies: []'];
  return ['title_filter:', '  positive:', '    - "Engineer"', ...companies, 'job_boards: []', ''].join('\n');
}

function runScan(portalsYml, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'co-scan-all-failed-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'profile.yml'), '{}\n');
  writeFileSync(join(dir, 'portals.yml'), portalsYml);
  // Dropped by prefix, so a CAREER_OPS_* override added later cannot point the
  // run at the developer's real data.
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith('CAREER_OPS_')) delete env[name];
  const result = spawnSync(process.execPath, [SCAN, '--quiet', ...args], {
    cwd: dir,
    env: { ...env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: join(dir, 'portals.yml') },
    encoding: 'utf-8',
  });
  return { dir, result };
}

const lastLine = (text) => text.trim().split('\n').at(-1) || '';

test('exits 2 when every target failed, after writing the scan-runs row', () => {
  const { dir, result } = runScan(portals(FAILING));
  try {
    assert.equal(result.status, 2, describeSpawn(result));
    assert.match(lastLine(result.stderr), /^Error: every scan target failed \(1 of 1\)/);

    const runs = join(dir, 'data', 'scan-runs.tsv');
    assert.ok(existsSync(runs), 'the run is still recorded');
    const [header, row] = readFileSync(runs, 'utf-8').trim().split('\n').map(line => line.split('\t'));
    assert.equal(row[header.indexOf('status')], 'completed');
    assert.equal(row[header.indexOf('errors')], '1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exits 0 when at least one target was read', () => {
  const { dir, result } = runScan(portals(FAILING, WORKING), ['--dry-run']);
  try {
    assert.equal(result.status, 0, describeSpawn(result));
    assert.match(result.stdout, /Failing Co/, 'the failure is still reported');
    assert.doesNotMatch(result.stderr, /every scan target failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exits 0 when no target was configured', () => {
  const { dir, result } = runScan(portals(), ['--dry-run']);
  try {
    assert.equal(result.status, 0, describeSpawn(result));
    assert.doesNotMatch(result.stderr, /every scan target failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an entry whose provider cannot be resolved counts as a failed target', () => {
  const unknown = ['  - name: Broken Co', '    provider: provider-that-does-not-exist'];
  const { dir, result } = runScan(portals(unknown), ['--dry-run']);
  try {
    assert.equal(result.status, 2, describeSpawn(result));
    assert.match(lastLine(result.stderr), /every scan target failed \(1 of 1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
