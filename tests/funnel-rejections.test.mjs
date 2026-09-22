import assert from 'node:assert/strict';
import { pass, fail } from './helpers.mjs';
import { computeFunnel, computeFunnelWithHistory, parseStatusLogStages } from '../stats.mjs';
import { cumulativeTilesWithHistory } from '../web/src/lib/funnel-tiles.mjs';

try {
  const states = [...Array(10).fill('Applied'), ...Array(5).fill('Responded'), ...Array(2).fill('Interview'), ...Array(12).fill('Rejected')];
  const apps = new Map(states.map((s,i) => [i+1,s]));
  const log = [18,19,20].map(n => `${n}\t2026-09-01\tInterview\tRejected\tset-status\t`).join('\n');
  const f = computeFunnelWithHistory(apps, parseStatusLogStages(log + '\n' + log));
  assert.equal(f.everApplied, 29);
  assert.equal(f.everResponded, 19);
  assert.equal(f.everInterview, 5);
  assert.equal(f.responseRate, 65.5);
  assert.equal(f.interviewRate, 17.2);
  assert.deepEqual(cumulativeTilesWithHistory(states.map((status,i) => ({n:String(i+1),status})), log), {interviews:f.everInterview, offers:f.everOffer});
  assert.equal(computeFunnel({Rejected:2, Discarded:3}).everResponded, 2);
  assert.equal(computeFunnelWithHistory(new Map([[1,'Discarded']]), [{num:1,from:'Rejected',to:'Discarded'}]).everResponded, 1);
  pass('rejections count as replies and distinct ledger interviews agree across CLI/web');
} catch (e) { fail(`cumulative rejection funnel: ${e.message}`); }
