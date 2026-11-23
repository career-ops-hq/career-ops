// tests/update-legacy-reexec-lock.test.mjs — a stale `.update-lock` is not proof
// that a parent updater is running.
//
// `isLegacyReexec()` arms the fast path for children started before the
// authenticated reexec marker existed. It used to accept the mere existence of
// `.update-lock` plus any old `backup-pre-update-*` branch, which is durable state:
// a lock survives a crash, so after one crashed update the environment variable
// alone skipped `--confirm`, created no backup branch, and trusted the
// `_TARGET_REF`/`_SHA` it was given without the target-identity check.
//
// The lock file holds the ISO timestamp its claimer wrote, so "could that parent
// still be running?" is answerable: it has to be recent. Unreadable content
// answers no — a lock this code cannot date is not evidence.
//
// Run:  node --test tests/update-legacy-reexec-lock.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { legacyLockLooksLive } = await import(pathToFileURL(join(ROOT, 'update-system.mjs')).href);

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const at = (msAgo) => new Date(NOW - msAgo).toISOString();

test('a lock stamped seconds or minutes ago counts as a live parent', () => {
  assert.equal(legacyLockLooksLive(at(5_000), NOW), true);
  assert.equal(legacyLockLooksLive(at(5 * 60_000), NOW), true);
  assert.equal(legacyLockLooksLive(at(29 * 60_000), NOW), true);
});

test('a lock left behind by a crashed update does not', () => {
  assert.equal(legacyLockLooksLive(at(31 * 60_000), NOW), false);
  assert.equal(legacyLockLooksLive(at(24 * 3600_000), NOW), false);
  assert.equal(legacyLockLooksLive(at(30 * 24 * 3600_000), NOW), false);
});

test('a little clock skew is tolerated, a lot is not', () => {
  assert.equal(legacyLockLooksLive(new Date(NOW + 30_000).toISOString(), NOW), true);
  assert.equal(legacyLockLooksLive(new Date(NOW + 10 * 60_000).toISOString(), NOW), false);
});

test('unreadable content is not evidence of a live parent', () => {
  for (const text of ['', '   ', 'not-a-date', 'null', undefined, null]) {
    assert.equal(legacyLockLooksLive(text, NOW), false, `${JSON.stringify(text)} must not arm the fast path`);
  }
});