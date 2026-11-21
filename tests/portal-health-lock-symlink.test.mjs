// Two writers that open data/portal-health.tsv through a symlink must take the
// same lock. A lock built from the spelling rather than from the file lets both
// read-modify-write, and one side's rows are dropped.
//
// pipeline-lock.mjs fixed this for data/pipeline.md (#4957/#5358); this suite
// holds the portal-health lock to the same rule now that it shares the resolver
// in lib/lock-path.mjs.
//
// Run:  node --test tests/portal-health-lock-symlink.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquirePortalHealthLock, LockTimeoutError } from '../portal-health-lock.mjs';

// A file symlink needs SeCreateSymbolicLinkPrivilege on Windows, which a
// non-elevated account without Developer Mode lacks, and a junction cannot point
// at a file. Where symlinkSync throws EPERM the case needs one, so it skips with
// that reason instead of failing.
const canSymlinkFiles = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-health-symlink-probe-'));
  try {
    writeFileSync(join(dir, 'target.tsv'), '');
    symlinkSync(join(dir, 'target.tsv'), join(dir, 'link.tsv'));
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return false;
    throw err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
const skip = !canSymlinkFiles && 'needs a file symlink, which this account cannot create (EPERM)';

test('a symlink and the real path share one portal-health lock', { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-health-symlink-'));
  const real = join(root, 'portal-health.tsv');
  const link = join(root, 'alias.tsv');
  try {
    writeFileSync(real, 'portal\treachable\n');
    symlinkSync(real, link);

    const held = await acquirePortalHealthLock(link, { timeoutMs: 200, retryMs: 20 });
    try {
      // If the lock were keyed on the spelling, this second acquisition would
      // succeed immediately and both writers would edit the file at once.
      await assert.rejects(
        () => acquirePortalHealthLock(real, { timeoutMs: 200, retryMs: 20 }),
        (err) => err instanceof LockTimeoutError,
        'the real path took its own lock while the symlink held one',
      );
    } finally {
      held.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a path that does not exist yet locks beside its existing parent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-health-missing-'));
  try {
    // The file is created by the same writer that takes the lock, so the resolver
    // must fall back to the parent that does exist instead of throwing ENOENT.
    const target = join(root, 'portal-health.tsv');
    const held = await acquirePortalHealthLock(target, { timeoutMs: 200, retryMs: 20 });
    try {
      await assert.rejects(
        () => acquirePortalHealthLock(target, { timeoutMs: 200, retryMs: 20 }),
        (err) => err instanceof LockTimeoutError,
      );
    } finally {
      held.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});