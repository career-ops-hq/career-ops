import assert from 'node:assert/strict';
import test from 'node:test';
import { computePortalStats } from '../stats.mjs';

test('a portal moved to websearch no longer counts as persistently dead', () => {
  const portals = `portal_health_threshold: 3
tracked_companies:
  - name: Acme
    scan_method: websearch
`;
  const health = `timestamp\tcompany\tstatus
2026-09-01T00:00:00Z\tAcme\tslug_gone
2026-09-02T00:00:00Z\tAcme\tslug_gone
2026-09-03T00:00:00Z\tAcme\tslug_gone
`;

  assert.equal(computePortalStats(portals, null, [], health).persistentlyDead, 0);
});
