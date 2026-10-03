// The company evidence card must not turn "not checked" into "nothing found".
//
// company-history.mjs draws that distinction itself and says why in its own
// comment — an aggregator that was skipped "must still not claim
// `none-detected`, which claims a negative result from a check that never ran".
// The card is where that could quietly be lost, because both labels want to
// render as one reassuring line.

import test from "node:test";
import assert from "node:assert/strict";
import { companyCardModel, verdictFor, isConclusion } from "../../src/lib/company-history.mjs";

const card = (over = {}) => ({
  available: true,
  reason: null,
  card: {
    company: "Globex",
    key: "globex",
    responsiveness: { label: "responded-before", facts: [{ num: 2, outcome: "Interview", date: "2026-09-03" }] },
    postingChurn: { label: "none-detected", clusters: [] },
    explanations: [],
    ...over,
  },
});

test("a checked-and-empty result is a conclusion; an unchecked one is not", () => {
  const checked = companyCardModel(card({ postingChurn: { label: "none-detected", clusters: [] } }));
  assert.equal(checked.churn.kind, "absence");
  assert.equal(isConclusion(checked.churn), true);
  assert.match(checked.churn.headline, /No repeat postings found/);

  for (const label of ["no-scan-data", "aggregator-not-evaluated"]) {
    const unchecked = companyCardModel(card({ postingChurn: { label, clusters: [] } }));
    assert.equal(unchecked.churn.kind, "not-checked", label);
    assert.equal(isConclusion(unchecked.churn), false, label);
    // The headline must not read as a finding about the company.
    assert.doesNotMatch(unchecked.churn.headline, /no repeat postings found/i, label);
    assert.match(unchecked.churn.headline, /not checked/i, label);
  }
});

test("every responsiveness label the core emits is mapped", () => {
  for (const [label, kind] of [
    ["responded-before", "finding"],
    ["silent-on-you", "finding"],
    ["mixed", "finding"],
    ["no-history", "absence"],
  ]) {
    const m = companyCardModel(card({ responsiveness: { label, facts: [] } }));
    assert.equal(m.responsiveness.kind, kind, label);
    assert.ok(m.responsiveness.headline.length > 0, label);
  }
});

test("a label added to the core later is not guessed at", () => {
  // Silence about an unrecognised state is safer than a phrasing that may be
  // its opposite — "silent-on-you" and "responded-before" are one word apart in
  // a label and opposite in meaning.
  const v = verdictFor({ known: { kind: "finding", headline: "k", detail: null } }, "brand-new-label");
  assert.equal(v.kind, "not-checked");
  assert.equal(isConclusion(v), false);
  assert.match(v.detail, /brand-new-label/);
});

test("a missing or empty label yields no verdict at all", () => {
  assert.equal(verdictFor({}, undefined), null);
  assert.equal(verdictFor({}, ""), null);
  assert.equal(verdictFor({}, 7), null);
  const m = companyCardModel(card({ responsiveness: { facts: [] }, postingChurn: {} }));
  assert.equal(m.responsiveness, null);
  assert.equal(m.churn, null);
});

test("facts and explanations pass through, filtered", () => {
  const m = companyCardModel(card({ explanations: ["An aggregator listing.", 7, null] }));
  assert.deepEqual(m.explanations, ["An aggregator listing."]);
  assert.equal(m.facts.length, 1);
  assert.equal(m.facts[0].outcome, "Interview");
  // A non-array facts field must not crash the card.
  assert.deepEqual(companyCardModel(card({ responsiveness: { label: "no-history", facts: "nope" } })).facts, []);
});

test("an unavailable payload keeps its reason and claims nothing", () => {
  for (const reason of ["no-company", "no-script", "unparseable"]) {
    const m = companyCardModel({ available: false, reason, card: null });
    assert.equal(m.available, false);
    assert.equal(m.reason, reason);
    assert.equal(m.responsiveness, null);
    assert.equal(m.churn, null);
  }
  assert.equal(companyCardModel(null).available, false);
  assert.equal(companyCardModel(undefined).reason, "unavailable");
});

test("isConclusion is closed against kinds added later", () => {
  assert.equal(isConclusion(null), false);
  assert.equal(isConclusion({ kind: "not-checked" }), false);
  assert.equal(isConclusion({ kind: "speculative" }), false);
});
