/** Verify both retained Node discovery commands enter Python business storage. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeDiscoveryOffer } from '../src/discovery/ingest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(normalizeDiscoveryOffer({ description: 'Listing preview', scan_jd: { text: 'Captured full JD' } }).description, 'Captured full JD');
for (const operation of ['configured', 'global']) {
  const result = spawnSync(process.execPath, ['scan.mjs', operation, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${operation}: ${result.stderr}`);
  assert.match(result.stdout, /[Uu]sage:/, operation);
}
const sandbox = mkdtempSync(join(tmpdir(), 'career-ops-global-route-'));
try {
  const portals = join(sandbox, 'portals.yml');
  writeFileSync(portals, '{}\n');
  const result = spawnSync(process.execPath, [join(root, 'scan.mjs'), 'global', '--ats=,', '--json'], {
    cwd: sandbox, encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_INPUT_ROOT: sandbox, CAREER_OPS_PORTALS: portals },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).sources, []);
  assert.ok(existsSync(join(sandbox, 'data', 'opportunities.db')));
  const configured = spawnSync(process.execPath, [join(root, 'scan.mjs'), 'configured', '--dry-run'], {
    cwd: sandbox, encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_INPUT_ROOT: sandbox, CAREER_OPS_PORTALS: portals },
  });
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(JSON.parse(configured.stdout).dry_run, true);
  const implicit = spawnSync(process.execPath, [join(root, 'scan.mjs'), '--dry-run'], {
    cwd: sandbox, encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_INPUT_ROOT: sandbox, CAREER_OPS_PORTALS: portals },
  });
  assert.equal(implicit.status, 0, implicit.stderr);
  assert.equal(JSON.parse(implicit.stdout).dry_run, true);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
const unknown = spawnSync(process.execPath, ['scan.mjs', 'typo'], { cwd: root, encoding: 'utf8' });
assert.equal(unknown.status, 2, unknown.stderr);
assert.match(unknown.stderr, /unknown discovery operation/);
console.log('discovery command: configured and global route to Python business storage');
