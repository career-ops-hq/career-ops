// The company evidence card must not turn "not checked" into "nothing found".
//
// company-history.mjs draws that distinction itself and says why in its own
// comment — an aggregator that was skipped "must still not claim
// `none-detected`, which claims a negative result from a check that never ran".
// The card is where that could quietly be lost, because both labels want to
// render as one reassuring line.

import test from "node:test";
import assert from "node:assert/strict";
import { companyCardModel, verdictFor, isConclusion, factLine } from "../../src/lib/company-history.mjs";

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

test("reposts-detected is a finding, not an unrecognised label", () => {
  // The label the core emits when it HAS found re-listings. It was missing from
  // the table, so the card fell through to "Not evaluated" — silent at the one
  // moment it had something to say.
  const m = companyCardModel(card({ postingChurn: { label: "reposts-detected", clusters: [{ title: "Platform Lead" }] } }));
  assert.equal(m.churn.kind, "finding");
  assert.equal(isConclusion(m.churn), true);
  assert.match(m.churn.headline, /re-listed/i);
  assert.doesNotMatch(m.churn.headline, /not evaluated/i);
});

test("every churn label the core emits is mapped", () => {
  // This file already promises "every label the core emits" for responsiveness;
  // the churn side needs the same, since that is how reposts-detected was missed.
  for (const [label, kind] of [
    ["reposts-detected", "finding"],
    ["none-detected", "absence"],
    ["no-scan-data", "not-checked"],
    ["aggregator-not-evaluated", "not-checked"],
  ]) {
    const m = companyCardModel(card({ postingChurn: { label, clusters: [] } }));
    assert.equal(m.churn.kind, kind, label);
    assert.doesNotMatch(m.churn.headline, /not evaluated/i, `${label} must not read as unrecognised`);
  }
});

test("a silent fact renders its own fields, not an empty outcome", () => {
  // Two fact shapes. A responded fact has outcome+date; a SILENT one has
  // silentDays/appliedDate/followupsSent and neither — so printing only the
  // first pair gave "#4 · —" with no date.
  const silent = factLine({ num: 4, appliedDate: "2026-07-02", status: "Applied", silentDays: 61, followupsSent: 2 });
  assert.match(silent, /#4/);
  assert.match(silent, /no reply in 61 days/);
  assert.match(silent, /applied 2026-07-02/);
  assert.match(silent, /2 follow-ups sent/);
  assert.doesNotMatch(silent, /—|undefined|NaN/);

  // One follow-up is singular; zero is not mentioned at all.
  assert.match(factLine({ num: 5, silentDays: 30, followupsSent: 1 }), /1 follow-up sent/);
  assert.doesNotMatch(factLine({ num: 5, silentDays: 30, followupsSent: 0 }), /follow-up/);

  // The responded shape still reads the way it did.
  const responded = factLine({ num: 2, outcome: "Interview", date: "2026-09-03" });
  assert.equal(responded, "#2 · Interview · 2026-09-03");

  // stale is appended to either shape.
  assert.match(factLine({ num: 9, silentDays: 400, stale: true }), /stale$/);
  assert.match(factLine({ num: 9, outcome: "Applied", date: "2025-01-01", stale: true }), /stale$/);

  // A fact with nothing but its own number is dropped rather than rendered as
  // punctuation.
  assert.equal(factLine({ num: 7 }), null);
  assert.equal(factLine({}), null);
  assert.equal(factLine(null), null);
  assert.equal(factLine("nope"), null);
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
