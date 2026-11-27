// tests/company-history-missing-override.test.mjs — an explicit --scan-history
// or --followups that does not exist is an error, not "no history".
//
// The card read a missing override as an empty file, printed
// responsiveness "no-history" and postingChurn "no-scan-data" and exited 0, so
// a mistyped path looked like a company with nothing on record. As in #7840
// and #7781, only the default paths may be absent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'company-history-missing-'));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));
mkdirSync(join(root, 'data'));
const followups = join(root, 'follow-ups.md');
writeFileSync(followups, '# Follow-ups\n');

function run(...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const r = spawnSync(process.execPath, [join(ROOT, 'company-history.mjs'), '--company', 'Acme', ...args], { cwd: root, encoding: 'utf-8', env, timeout: 60_000 });
  assert.equal(r.error, undefined, describeSpawn(r));
  return r;
}

test('a --scan-history that does not exist exits 1 and names it', () => {
  const r = run('--scan-history', join(root, 'scan-histroy.tsv'));
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /--scan-history not found: .*scan-histroy\.tsv/);
  assert.equal(r.stdout, '');
});

test('a --followups that does not exist exits 1 and names it', () => {
  const r = run('--followups', join(root, 'folow-ups.md'));
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /--followups not found: .*folow-ups\.md/);
});

test('control: an existing override, and absent defaults, still print the card', () => {
  for (const args of [['--followups', followups], []]) {
    const r = run(...args);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.equal(JSON.parse(r.stdout).company, 'Acme');
  }
});
