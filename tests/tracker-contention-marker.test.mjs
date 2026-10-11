import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForContentionMarker } from './helpers/tracker-contention-marker.mjs';

test('retries a contention marker read after incomplete JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-marker-test-'));
  const markerPath = join(dir, 'marker.json');
  const marker = { pid: 123, lockDir: '/tmp/lock', guardCreated: true };
  writeFileSync(markerPath, '{"pid":123');
  const completion = setTimeout(() => writeFileSync(markerPath, JSON.stringify(marker)), 50);

  try {
    assert.deepEqual(await waitForContentionMarker(markerPath, 500), marker);
  } finally {
    clearTimeout(completion);
    rmSync(dir, { recursive: true, force: true });
  }
});
