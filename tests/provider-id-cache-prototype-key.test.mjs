import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openProviderIdCache } from '../provider-id-cache.mjs';

test('a cache key named __proto__ survives save and reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-id-cache-proto-'));
  try {
    const first = openProviderIdCache(dir);
    const cache = first.forProvider('acme');
    cache.set('__proto__', { id: 'kept' });
    cache.set('normal', { id: 'also-kept' });
    await first.save();

    const second = openProviderIdCache(dir);
    assert.deepEqual(second.forProvider('acme').get('__proto__'), { id: 'kept' });
    assert.deepEqual(second.forProvider('acme').get('normal'), { id: 'also-kept' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
