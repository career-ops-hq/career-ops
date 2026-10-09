import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePortalStats } from '../stats.mjs';

test('a portal switched to websearch no longer reports its frozen failure streak', () => {
  const config = `portal_health_threshold: 3
tracked_companies:
  - name: Acme
    scan_method: websearch
`;
  const health = [
    'timestamp\tcompany\tstatus',
    '2026-09-01T00:00:00Z\tAcme\tslug_gone',
    '2026-09-02T00:00:00Z\tAcme\tslug_gone',
    '2026-09-03T00:00:00Z\tAcme\tslug_gone',
  ].join('\n');

  assert.equal(computePortalStats(config, null, [], health).persistentlyDead, 0);
});
