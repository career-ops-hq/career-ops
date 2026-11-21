// A sync failure must leave the original document intact before publication.
// HERMETIC: only synthetic documents in an OS temporary directory are written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('clean preserves the original and removes the temporary copy when fsync fails', {
  skip: process.platform === 'win32' && 'Windows uses an in-place write to preserve its DACL',
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'clean-markers-sync-'));
  try {
    const file = join(dir, 'cv.md');
    const hook = join(dir, 'fail-sync.mjs');
    const original = 'Synthetic experience\u200B retained on sync failure.\n';
    writeFileSync(file, original);
    writeFileSync(hook, `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      fs.fsyncSync = () => {
        const error = new Error('injected fsync failure');
        error.code = 'ENOSPC';
        throw error;
      };
      syncBuiltinESMExports();
    `);
    const result = spawnSync(process.execPath, [
      '--import', pathToFileURL(hook).href, join(ROOT, 'clean-markers.mjs'), 'clean', file,
    ], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(result.status, 0, 'clean must fail when syncing the copy fails');
    assert.match(result.stderr, /injected fsync failure/);
    assert.equal(readFileSync(file, 'utf8'), original, 'the original must remain byte-for-byte intact');
    assert.deepEqual(readdirSync(dir).sort(), ['cv.md', 'fail-sync.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
