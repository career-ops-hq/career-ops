// The ATS coverage panel presents keyword-match.mjs's verdict without
// double-counting it or turning a diagnostic into a grade.

import test from "node:test";
import assert from "node:assert/strict";
import { splitTiers, coverageModel, coverageBand } from "../../src/lib/keyword-coverage.mjs";

// The shape emitted by older core versions.
const REAL = {
  total: 9,
  presentCount: 5,
  coveragePct: 56,
  present: ["Go", "PostgreSQL", "AWS", "CI/CD", "distributed systems"],
  thin: ["Go", "PostgreSQL", "AWS", "CI/CD", "distributed systems"],
  missing: ["Kubernetes", "Terraform", "GraphQL", "Prometheus"],
};

test("legacy frequency data leaves all present terms covered", () => {
  const tiers = splitTiers(REAL);
  const counts = Object.fromEntries(tiers.map((t) => [t.key, t.terms.length]));
  assert.deepEqual(counts, { covered: 5, missing: 4 });
  assert.equal(counts.covered + counts.missing, REAL.total);
  assert.match(tiers.find((t) => t.key === "missing").hint, /may describe the skill in other words/);
});

test("malformed lists cannot invent keywords", () => {
  const tiers = splitTiers({ present: ["Go", "", "   ", null, 7], missing: "nope" });
  assert.deepEqual(tiers.find((t) => t.key === "covered").terms, ["Go"]);
  assert.deepEqual(tiers.find((t) => t.key === "missing").terms, []);
});

test("coverage over no keywords is absent, not 0%", () => {
  const m = coverageModel({ available: true, result: { total: 0, presentCount: 0, coveragePct: 0, present: [], missing: [] } });
  assert.equal(m.coveragePct, null, "0% over an empty keyword list is no measurement, not a bad score");
  assert.equal(coverageBand(m.coveragePct), "unknown");
});

test("an unavailable result keeps the reason the route gave", () => {
  for (const reason of ["no-keywords", "no-script", "no-report", "failed"]) {
    const m = coverageModel({ available: false, reason, result: null });
    assert.equal(m.available, false);
    assert.equal(m.reason, reason);
    assert.deepEqual(m.tiers, []);
  }
  // A missing payload still yields a usable model rather than throwing.
  assert.equal(coverageModel(undefined).reason, "unavailable");
  assert.equal(coverageModel(null).available, false);
});

test("the band is coarse on purpose and never a pass/fail", () => {
  assert.equal(coverageBand(100), "high");
  assert.equal(coverageBand(75), "high");
  assert.equal(coverageBand(74), "mid");
  assert.equal(coverageBand(50), "mid");
  assert.equal(coverageBand(49), "low");
  assert.equal(coverageBand(0), "low");
  assert.equal(coverageBand(null), "unknown");
  assert.equal(coverageBand(NaN), "unknown");
  // Three bands, not a threshold: keyword-match.mjs is diagnostic, and a red
  // "fail" would push the reader toward stuffing the CV with terms — the exact
  // behaviour "keywords get reformulated, never fabricated" forbids.
  assert.equal(new Set([coverageBand(10), coverageBand(60), coverageBand(90)]).size, 3);
});

test("a real payload round-trips into the model", () => {
  const m = coverageModel({ available: true, reason: null, result: REAL });
  assert.equal(m.available, true);
  assert.equal(m.total, 9);
  assert.equal(m.presentCount, 5);
  assert.equal(m.coveragePct, 56);
  assert.equal(coverageBand(m.coveragePct), "mid");
});
