import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('doctor finds the CLI extractor in the code checkout with a separate data root', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-extractor-'));
  try {
    mkdirSync(join(dataRoot, 'config'));
    writeFileSync(join(dataRoot, 'config', 'profile.yml'), 'scan:\n  extractor: cli\n');
    const result = spawnSync(process.execPath, [join(root, 'doctor.mjs'), '--target', dataRoot], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.signal, null, result.stderr);
    assert.match(result.stdout, /✓ Scan extractor: cli \(browser-extract\.mjs\)/);
    assert.doesNotMatch(result.stdout, /browser-extract\.mjs is missing/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
