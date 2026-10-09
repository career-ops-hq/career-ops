// What the Analytics views may claim from the core's payloads.
//
// stats.mjs and analyze-patterns.mjs both ship honesty signals next to their
// numbers — smallSample, sufficientSample, minSampleForClaim, coveragePct — and
// a view that renders the number while dropping the caveat turns a hedged figure
// into a confident one. These assertions pin the gating, not the arithmetic:
// the arithmetic is the core's and is not reimplemented here.

import test from "node:test";
import assert from "node:assert/strict";
import { progressModel, statsModel, rateOrNull, isUnlabelled } from "../../src/lib/analytics/view-model.mjs";

test("a rate over nothing is absent, not zero", () => {
  // The failure this prevents: a user who has not applied yet being shown
  // "0% response rate", i.e. the app reporting their search as failing before it
  // has begun.
  assert.equal(rateOrNull(0, 0), null);
  assert.equal(rateOrNull(50, 0), null);
  assert.equal(rateOrNull(0, undefined), null);
  assert.equal(rateOrNull(undefined, 10), null);
  // A real zero over a real denominator is a finding and must survive.
  assert.equal(rateOrNull(0, 12), 0);
  assert.equal(rateOrNull(50, 4), 50);
});

test("progress model mirrors the core's cumulative funnel, in order", () => {
  const m = progressModel({
    tracker: { total: 9, activeApps: 3, avgScore: 4.4, topScore: 4.9 },
    funnel: { everApplied: 4, everResponded: 2, everInterview: 2, everOffer: 1, responseRate: 50, interviewRate: 50, offerRate: 25, smallSample: true },
  });
  assert.equal(m.available, true);
  assert.deepEqual(m.funnel.stages.map((s) => s.value), [4, 2, 2, 1]);
  // Lifecycle order, so a later stage can never render larger than an earlier
  // one — the nesting stats.mjs guarantees is visible in the shape.
  assert.deepEqual(m.funnel.stages.map((s) => s.key), ["everApplied", "everResponded", "everInterview", "everOffer"]);
  assert.deepEqual(m.funnel.rates.map((r) => r.value), [50, 50, 25]);
  assert.equal(m.provisional, true, "smallSample must carry through to the view");
});

test("an empty tracker yields no rates at all", () => {
  const m = progressModel({
    tracker: { total: 0, activeApps: 0, avgScore: 0, topScore: 0 },
    funnel: { everApplied: 0, everResponded: 0, everInterview: 0, everOffer: 0, responseRate: 0, interviewRate: 0, offerRate: 0, smallSample: true },
  });
  assert.deepEqual(m.funnel.rates.map((r) => r.value), [null, null, null]);
  // And no score claims either: avg/top of 0 over an empty tracker is not a 0.0
  // average, it is the absence of one.
  assert.equal(m.totals.avgScore, null);
  assert.equal(m.totals.topScore, null);
});

test("missing stats degrade to unavailable rather than to zeroes", () => {
  for (const input of [null, {}, { tracker: null, funnel: null }]) {
    const m = progressModel(input);
    assert.equal(m.available, false);
    assert.deepEqual(m.funnel.stages, []);
  }
});

test("an absent core and an empty tracker are not the same unavailable", () => {
  // The failure this prevents: the Conversion block rendering as absolutely
  // nothing for a brand-new user, which is every user on day one. "I could not
  // run" and "I ran and you have not applied yet" are different sentences, and
  // only the first is a reason to stay silent.
  assert.equal(progressModel(null).reason, "no-core");

  // stats.mjs answering with its own metadata, honestly reporting no tracker —
  // the shape /api/stats actually returns on a fresh checkout.
  const fresh = { metadata: { sources: { tracker: false } }, tracker: null, funnel: null };
  assert.equal(progressModel(fresh).reason, "no-data");
  assert.equal(progressModel(fresh).available, false);

  // A usable payload carries no reason at all, so the view cannot branch on a
  // stale one.
  const ready = progressModel({
    tracker: { total: 12, activeApps: 3, avgScore: 4.1, topScore: 4.8 },
    funnel: { everApplied: 10, everResponded: 4, everInterview: 2, everOffer: 1, responseRate: 40 },
  });
  assert.equal(ready.available, true);
  assert.equal(ready.reason, null);
});

test("below-threshold is a result, not a failure", () => {
  const m = statsModel({ error: "Not enough data: 4/5 applications sent.", current: 4, threshold: 5 });
  assert.equal(m.state, "below-threshold");
  assert.equal(m.progress.current, 4);
  assert.equal(m.progress.threshold, 5);
  assert.match(m.progress.message, /Not enough data/);
  assert.deepEqual(m.sections, []);
});

test("an unsupported threshold keeps its reasoning but loses its number", () => {
  const ready = statsModel({
    scoreThreshold: { recommended: 4.7, sufficientSample: true, sampleSize: 12, reasoning: "because" },
  });
  const t1 = ready.sections.find((s) => s.key === "threshold");
  assert.equal(t1.value, 4.7);
  assert.equal(t1.provisional, false);

  const thin = statsModel({
    scoreThreshold: { recommended: 4.7, sufficientSample: false, sampleSize: 3, reasoning: "because" },
  });
  const t2 = thin.sections.find((s) => s.key === "threshold");
  // The number is withheld: "recommended 4.7" off three outcomes reads as a rule
  // rather than as an observation.
  assert.equal(t2.value, null);
  assert.equal(t2.provisional, true);
  assert.equal(t2.note, "because", "the reasoning is still worth showing");
});

test("an Unknown-only breakdown is not rendered as an insight", () => {
  const m = statsModel({
    archetypeBreakdown: [{ archetype: "Unknown", total: 9, conversionRate: 38 }],
    remotePolicy: [
      { policy: "unknown", total: 8, conversionRate: 29 },
      { policy: "hybrid/onsite", total: 1, conversionRate: 100 },
    ],
  });
  // All-Unknown means the reports carry no metadata for that axis; one Unknown
  // bar at 100% invites a conclusion drawn from a missing field.
  assert.equal(m.sections.find((s) => s.key === "archetype"), undefined);
  // A breakdown with at least one real label is kept — including its unknown
  // row, so the counts still add up — and marked partial.
  const remote = m.sections.find((s) => s.key === "remote");
  assert.ok(remote);
  assert.equal(remote.rows.length, 2);
  assert.equal(remote.partial, true);
});

test("the ATS panel makes no claim below the core's own sample bar", () => {
  const thin = statsModel({
    vendorAnalysis: { identified: 0, minSampleForClaim: 8, coveragePct: 0, breakdown: [], overallAdvanceRate: 38 },
  });
  const v1 = thin.sections.find((s) => s.key === "vendor");
  assert.equal(v1.claimable, false);
  assert.deepEqual(v1.rows, []);
  assert.equal(v1.coveragePct, 0);

  const solid = statsModel({
    vendorAnalysis: {
      identified: 12, minSampleForClaim: 8, coveragePct: 80,
      breakdown: [{ vendor: "greenhouse", advanceRate: 40 }],
      citation: "Bommasani et al.",
    },
  });
  const v2 = solid.sections.find((s) => s.key === "vendor");
  assert.equal(v2.claimable, true);
  assert.equal(v2.rows.length, 1);
  assert.equal(v2.citation, "Bommasani et al.", "the core's citation travels with the claim");
});

test("isUnlabelled covers every way the core says it does not know", () => {
  for (const s of ["", "  ", "Unknown", "unknown", "N/A", "—", "-"]) assert.equal(isUnlabelled(s), true, s);
  for (const s of ["greenhouse", "remote", "IC", "0"]) assert.equal(isUnlabelled(s), false, s);
});

test("unavailable patterns render nothing rather than an empty chart", () => {
  const m = statsModel(null);
  assert.equal(m.state, "unavailable");
  assert.deepEqual(m.sections, []);
});
