// A checkout with no tracker used to exit 0 before reading portals.yml, so an
// unknown provider never reached the coverage check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function run(dataRoot) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CAREER_OPS_')));
  env.CAREER_OPS_ROOT = dataRoot;
  return spawnSync(process.execPath, [join(ROOT, 'verify-pipeline.mjs')], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    env,
  });
}

test('verify-pipeline reports an unknown portal provider before the fresh-setup exit', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'co-vp-portals-'));
  try {
    writeFileSync(join(dataRoot, 'portals.yml'), [
      'tracked_companies:',
      '  - name: Example Co',
      '    careers_url: https://boards.example.com/example',
      '    enabled: true',
      '    provider: not-a-real-provider',
      '',
    ].join('\n'));
    const r = run(dataRoot);
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /Example Co/);
    assert.match(out, /unknown provider/);
    assert.match(out, /No applications\.md found/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('verify-pipeline still exits 0 for a fresh setup with no portals.yml', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'co-vp-fresh-'));
  try {
    const r = run(dataRoot);
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 0, out);
    assert.match(out, /No applications\.md found/);
    assert.match(out, /No portals\.yml yet/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
