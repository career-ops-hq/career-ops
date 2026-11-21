// A bare company name used to be ignored, and scan.mjs scanned every company.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OVERRIDES = ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_FOLLOWUPS', 'CAREER_OPS_REPORTS', 'CAREER_OPS_CV', 'CAREER_OPS_JDS', 'CAREER_OPS_ADDITIONS'];

function scan(...args) {
  const root = mkdtempSync(join(tmpdir(), 'scan-unexpected-'));
  const env = { ...process.env, CAREER_OPS_ROOT: root };
  delete env.FORCE_COLOR;
  for (const key of OVERRIDES) env[key] = '';
  try {
    return spawnSync(process.execPath, [join(ROOT, 'scan.mjs'), ...args], {
      cwd: root, encoding: 'utf8', timeout: 30000, env,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a bare company name exits 1 and names --company', () => {
  const r = scan('Acme', '--dry-run');
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /unexpected argument "Acme"/);
  assert.match(r.stderr, /--company Acme/);
  assert.equal(r.stdout, '');
  assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /portals\.yml not found/);
});

test('--company still accepts the name that follows it', () => {
  const r = scan('--company', 'Acme', '--dry-run');
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(`${r.stdout}\n${r.stderr}`, /portals\.yml not found/);
  assert.doesNotMatch(r.stderr, /unexpected argument/);
});

test('--since still accepts the number that follows it', () => {
  const r = scan('--since', '7', '--dry-run');
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(`${r.stdout}\n${r.stderr}`, /portals\.yml not found/);
  assert.doesNotMatch(r.stderr, /unexpected argument/);
});
