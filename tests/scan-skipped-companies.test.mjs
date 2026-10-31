// scan.mjs used to fold every unmatched portal into one count:
// "24 skipped — no provider matched", with no company name and no URL.
// --company "Nope Labs" then printed a normal success summary and exited 0.
// --company "Acme Labs, Inc." missed a row named "Acme Labs", because the
// filter was a substring check and a legal suffix is not a substring.
// enabled: "false" (a string) stayed in the run, which validate-portals
// already warns about, but the scan itself never named the company.
//
// Offline. One local parser over an in-repo fixture, plus careers URLs on
// boards.example.com that no provider claims. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = join(ROOT, 'scan.mjs');

const PORTALS = [
  'title_filter:',
  '  positive:',
  '    - "Engineer"',
  'tracked_companies:',
  '  - name: Brassbound Freight',
  '    careers_url: https://boards.example.com/brassbound',
  '  - name: Acme Labs',
  '    careers_url: https://self-hosted.example.com/jobs',
  '    parser:',
  '      command: node',
  '      script: tests/providers/_fixture-local-parser.mjs',
  '  - name: Closed Co',
  '    careers_url: https://boards.example.com/closed',
  '    enabled: false',
  '  - name: String Off',
  '    careers_url: https://boards.example.com/string-off',
  '    enabled: "false"',
  'job_boards: []',
  '',
].join('\n');

function runScan(args) {
  const dir = mkdtempSync(join(tmpdir(), 'co-scan-skipped-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'profile.yml'), '{}\n');
  writeFileSync(join(dir, 'portals.yml'), PORTALS);
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith('CAREER_OPS_')) delete env[name];
  const result = spawnSync(process.execPath, [SCAN, '--dry-run', '--quiet', ...args], {
    cwd: dir,
    env: { ...env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: join(dir, 'portals.yml') },
    encoding: 'utf-8',
    timeout: 20000,
  });
  rmSync(dir, { recursive: true, force: true });
  return { ...result, text: `${result.stdout || ''}${result.stderr || ''}` };
}

test('names each company no provider claims, and warns when enabled is not a boolean', () => {
  const result = runScan([]);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.match(result.text, /Brassbound Freight/);
  assert.match(result.text, /https:\/\/boards\.example\.com\/brassbound/);
  assert.match(result.text, /String Off/);
  assert.match(result.text, /enabled is "false"/);
  assert.match(result.text, /still scanned/);
  assert.doesNotMatch(result.text, /Closed Co/);
});

test('--company with no matching tracked company exits non-zero', () => {
  const result = runScan(['--company', 'Nope Labs']);
  assert.notEqual(result.status, 0, describeSpawn(result));
  assert.match(result.text, /no tracked company matches "Nope Labs"/);
  assert.doesNotMatch(result.text, /New offers/);
});

test('--company matches a row when only the legal suffix differs', () => {
  const result = runScan(['--company', 'Acme Labs, Inc.']);
  assert.equal(result.status, 0, describeSpawn(result));
  assert.match(result.text, /Scanning 1 companies/);
  assert.doesNotMatch(result.text, /Brassbound Freight/);
  assert.doesNotMatch(result.text, /no tracked company matches/);
});
