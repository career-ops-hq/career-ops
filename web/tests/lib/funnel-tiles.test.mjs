// Tests for the analytics headline tiles' cumulative counters.
// Imports directly from funnel-tiles.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/funnel-tiles.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { cumulativeTiles, cumulativeTilesWithHistory } from "../../src/lib/funnel-tiles.mjs";
import { canonStatus } from "../../src/lib/status-alias.mjs";
import { parseApplications } from "../../src/lib/tracker-table.mjs";
import { recoverFunnelStages, parseStatusLogStages } from '../../../funnel-stages.mjs';
import { fileURLToPath } from 'node:url';
const coreRoot = fileURLToPath(new URL('../../../', import.meta.url));

test("an offer-holder has already interviewed", () => {
  // The bug: a snapshot count reported interviews=0 here, so the tile showed
  // the "Interviews follow replies — keep follow-ups warm" nudge to someone
  // holding an offer.
  const t = cumulativeTiles(["OFFER"]);
  assert.equal(t.interviews, 1);
  assert.equal(t.offers, 1);
});

test("a hire counts as both an interview and an offer", () => {
  // Landing the job proves the offer and everything before it (stats.mjs
  // computeFunnel: everOffer = Offer + Hired). Previously BOTH tiles read 0
  // and BOTH nudges fired at a candidate who had just been hired.
  const t = cumulativeTiles(["HIRED"]);
  assert.equal(t.interviews, 1);
  assert.equal(t.offers, 1);
});

test("stages accumulate across a realistic pipeline", () => {
  const t = cumulativeTiles(["HIRED", "OFFER", "INTERVIEW", "APPLIED", "APPLIED", "EVALUATED"]);
  assert.equal(t.interviews, 3); // interview + offer + hired
  assert.equal(t.offers, 2); // offer + hired
});

test("stages that never reached an interview are not counted", () => {
  const t = cumulativeTiles(["EVALUATED", "APPLIED", "RESPONDED", "DISCARDED", "SKIP"]);
  assert.equal(t.interviews, 0);
  assert.equal(t.offers, 0);
});

test("a rejection is not folded in — its stage is unknowable from a snapshot", () => {
  // stats.mjs calls the middle stages lower bounds for exactly this reason: a
  // Rejected row proves a reply, but without history cannot distinguish an
  // early rejection from one after onsites.
  const t = cumulativeTiles(["REJECTED", "REJECTED"]);
  assert.equal(t.interviews, 0);
  assert.equal(t.offers, 0);
});

test("an empty or absent pipeline is zero, not a crash", () => {
  assert.deepEqual(cumulativeTiles([]), { interviews: 0, offers: 0 });
  assert.deepEqual(cumulativeTiles(undefined), { interviews: 0, offers: 0 });
});

test('terminal states retain distinct ledger achievements, never orphan rows', async () => {
  const apps = [{n:'1',status:'REJECTED'}, {n:'2',status:'DISCARDED'}, {n:'3',status:'REJECTED'}];
  const log = '1\t2026-09-01\tInterview\tRejected\n2\t2026-09-01\tOffer\tDiscarded\n1\t2026-09-01\tInterview\tRejected\n99\t2026-09-01\tOffer\tHired\n3junk\t2026-09-01\tOffer\tHired\n3\t\tOffer\tHired';
  assert.deepEqual(await cumulativeTilesWithHistory(apps, log, coreRoot), {interviews:2,offers:1});
  assert.deepEqual(await cumulativeTilesWithHistory(apps, null, coreRoot), {interviews:0,offers:0});
});

test('backfill IDs do not share history and snapshots include hired', async () => {
  assert.deepEqual(await cumulativeTilesWithHistory([{n:'N/A',status:'HIRED'}, {n:'N/A',status:'INTERVIEW'}], '', coreRoot), {interviews:2,offers:1});
});

test('markdown-formatted canonical tracker status retains snapshot achievements', async () => {
  const tracker = `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-09-22 | Example | Engineer | 5 | **Offer** | - | - | |`;
  const applications = parseApplications(tracker, coreRoot)
    .map((app) => ({ ...app, status: canonStatus(app.status) }));
  assert.equal(applications[0].status, 'OFFER');
  assert.deepEqual(await cumulativeTilesWithHistory(applications, '', coreRoot), { interviews: 1, offers: 1 });
});

test('web tiles consume the core recovered-stage contract, including case normalization', async () => {
  const states = [...Array(10).fill('Applied'), ...Array(5).fill('Responded'), ...Array(2).fill('Interview'), ...Array(12).fill('Rejected')];
  const apps = states.map((status,i) => ({n:String(i+1),status}));
  const log = [18,19,20].map(n => `${n}\t2026-09-01\tinterview\tREJECTED`).join('\n');
  const ranks = [...recoverFunnelStages(new Map(states.map((s,i) => [i+1,s])), parseStatusLogStages(log)).values()];
  assert.deepEqual(await cumulativeTilesWithHistory(apps, log, coreRoot), {interviews:ranks.filter(r => r >= 3).length, offers:ranks.filter(r => r >= 4).length});
  assert.equal((await cumulativeTilesWithHistory(apps, log, coreRoot)).interviews, 5);
  assert.deepEqual(await cumulativeTilesWithHistory([{n:'1',status:'Discarded'}], '1\t2026-09-01\toffer\tDiscarded', coreRoot), {interviews:1,offers:1});
});
