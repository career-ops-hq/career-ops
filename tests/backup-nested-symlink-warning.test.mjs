// tests/backup-nested-symlink-warning.test.mjs — a backup says what it did not copy.
//
// `walkTree` skips symlinks, which is deliberate: following one can leave the
// data root. The skip was reported for a top-level entry and silent for a link
// nested inside a copied directory, so a junction one level down disappeared
// while the run reported success. The gap is found at restore time, which is the
// worst moment for it.
//
// The warning is routed through the callback `listEntry` already receives rather
// than reaching for the caller's result object, which is not in scope there and
// would have thrown on the first nested link.
//
// A directory junction is used because creating one needs no
// SeCreateSymbolicLinkPrivilege on Windows, so the case runs on an ordinary
// account instead of skipping. `lstat` reports a junction as a symbolic link.
//
// Run:  node --test tests/backup-nested-symlink-warning.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { runBackup } = await import(pathToFileURL(join(ROOT, 'backup.mjs')).href);

test('a link nested inside a copied directory is reported, not swallowed', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'co-backup-nested-'));
  const dest = mkdtempSync(join(tmpdir(), 'co-backup-dest-'));
  try {
    // One real file so the directory is worth copying, and a link one level down.
    mkdirSync(join(dataRoot, 'data', 'nested'), { recursive: true });
    writeFileSync(join(dataRoot, 'data', 'real.md'), 'x');
    mkdirSync(join(dataRoot, 'elsewhere'), { recursive: true });
    symlinkSync(join(dataRoot, 'elsewhere'), join(dataRoot, 'data', 'nested', 'alias-dir'), 'junction');

    const result = await runBackup({ dataRoot, dest });

    assert.ok(Array.isArray(result.warnings), 'runBackup must report warnings');
    const named = result.warnings.filter((w) => /symlink/i.test(w) && /alias-dir/.test(w));
    assert.equal(named.length, 1,
      `expected one warning naming the skipped link, got: ${JSON.stringify(result.warnings)}`);

    // The warning must describe a link that was skipped, not a backup that failed:
    // the file beside it is copied, and nothing is recorded as failed.
    assert.deepEqual(result.failed, [], `nothing should fail: ${JSON.stringify(result.failed)}`);
    assert.ok(result.copied >= 1, `the real file should be copied (copied: ${result.copied})`);
    assert.ok(existsSync(join(dest, 'data', 'real.md')), 'data/real.md should be in the destination');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

test('an ordinary nested directory produces no skip warning', async () => {
  // The control: the new callback must fire for a link, not for every directory
  // it descends into.
  const dataRoot = mkdtempSync(join(tmpdir(), 'co-backup-plain-'));
  const dest = mkdtempSync(join(tmpdir(), 'co-backup-dest2-'));
  try {
    mkdirSync(join(dataRoot, 'data', 'nested'), { recursive: true });
    writeFileSync(join(dataRoot, 'data', 'nested', 'real.md'), 'x');

    const result = await runBackup({ dataRoot, dest });
    const named = (result.warnings || []).filter((w) => /symlink/i.test(w) && /nested/.test(w));
    assert.deepEqual(named, [],
      `a real directory must not be reported as a skipped link: ${JSON.stringify(result.warnings)}`);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});