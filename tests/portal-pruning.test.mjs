import assert from 'node:assert/strict';
import { pass, fail } from './helpers.mjs';
import { computePortalRecommendations as recommend } from '../stats.mjs';

const now = Date.parse('2026-09-22T12:00:00Z');
const config = `tracked_companies:
  - {name: Never}
  - {name: Rot}
  - {name: Quiet}
  - {name: Recent}
  - {name: Disabled, enabled: false}
  - {name: Search, scan_method: websearch}
  - {name: Stale}
  - {name: Unknown}
`;
const scan = ['Rot', 'Quiet', 'Stale'].map(n => `https://example.com/${n}\t2026-07-01\tats\tEngineer\t${n}\tadded`).join('\n');
const health = [
  '2026-07-01\tNever\treachable', '2026-09-22\tNever\tempty',
  '2026-09-20\tRot\tslug_gone', '2026-09-21\tRot\tserver', '2026-09-22\tRot\tnetwork',
  '2026-09-22T10:00:00.000Z\tQuiet\treachable', '2026-09-22\tRecent\treachable',
  '2026-07-01\tStale\tslug_gone', '2026-07-02\tStale\tslug_gone', '2026-07-03\tStale\tslug_gone',
  ...['Disabled', 'Search'].flatMap(n => [`2026-07-01\t${n}\treachable`, `2026-09-22\t${n}\tempty`]),
].join('\r\n');
const check = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name}: ${e.message}`); } };
check('pruning separates never-produced, rotted and healthy quiet companies', () => {
  const r = recommend(config, scan, health, now);
  assert.deepEqual(r.neverProduced.map(x => x.company), ['Never']);
  assert.deepEqual(r.rotted.map(x => x.company), ['Rot']);
  assert.deepEqual(r.healthyButQuiet.map(x => x.company), ['Quiet']);
});
check('pruning requires history and recent evidence, not configuration age guesses', () => {
  const r = recommend(config, null, null, now);
  assert.equal(r.neverProduced.length + r.rotted.length + r.healthyButQuiet.length, 0);
  assert.equal(recommend(config, null, health, now).neverProduced.length, 0);
  assert.equal(recommend('invalid: [', scan, health, now), null);
});
check('pruning honors thresholds and healthy streak resets', () => {
  assert.equal(recommend(config + 'portal_health_threshold: 4\n', scan, health, now).rotted.length, 0);
  assert.equal(recommend(config, scan, health + '\n2026-09-22\tRot\treachable', now).rotted.length, 0);
  assert.equal(recommend(config + 'portal_prune_quiet_days: 100\n', scan, health, now).neverProduced.length, 0);
});
check('pruning orders health evidence chronologically before computing the streak', () => {
  const reversed = [
    '2026-09-22\tRot\treachable',
    '2026-09-20T03:00:00.000Z\tRot\tnetwork',
    '2026-09-20T02:00:00.000Z\tRot\tserver',
    '2026-09-20T01:00:00.000Z\tRot\tslug_gone',
  ].join('\n');
  const r = recommend(config, scan, reversed, now);
  assert.equal(r.rotted.length, 0);
  assert.deepEqual(r.healthyButQuiet.map(x => x.company), ['Rot']);
  assert.equal(r.healthyButQuiet[0].lastObserved, '2026-09-22');
});
check('pruning tolerates torn/future rows and keeps exact name matching', () => {
  const r = recommend(config, scan.replace(/Quiet/g, 'Quiet Inc.'), health + '\n2027-01-01\tQuiet\tslug_gone\ntorn', now);
  assert.equal(r.healthyButQuiet.length, 0);
  assert.equal(r.rotted.length, 1);
});
