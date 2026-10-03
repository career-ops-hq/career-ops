// The "gone quiet" panel reports elapsed time, not misconduct.
//
// rejection-latency.mjs measures days since the last interview round and ships
// the sentence that bounds the claim: "Elapsed-time observation only — not legal
// advice or a claim that the employer did anything wrong." This panel names
// third-party employers in a tool whose output people paste into messages, so
// the bound has to survive the trip.

import test from "node:test";
import assert from "node:assert/strict";
import { quietModel, checkRan } from "../../src/lib/quiet-companies.mjs";

const DISCLAIMER =
  "Elapsed-time observation only — not legal advice or a claim that the employer did anything wrong.";

const payload = (over = {}) => ({
  available: true,
  reason: null,
  data: {
    metadata: { today: "2026-09-29", courtesyDays: 30, companiesChecked: 3, flagged: 2, disclaimer: DISCLAIMER },
    flags: [
      {
        company: "Tyrell Corp", role: "Platform Lead", trackerNums: [8],
        lastInterviewDate: "2026-07-10", daysSinceLastInterview: 81, tier: "courtesy",
        reason: "81 days post-interview silence exceeds the 30-day courtesy threshold",
        blacklistSuggestion: "| Tyrell Corp | 2026-09-29 | company | 81 days … |",
      },
      {
        company: "Globex", role: "Staff Platform Engineer", trackerNums: [2],
        lastInterviewDate: "2026-06-02", daysSinceLastInterview: 119, tier: "courtesy",
        reason: "119 days post-interview silence exceeds the 30-day courtesy threshold",
        blacklistSuggestion: "| Globex | 2026-09-29 | company | 119 days … |",
      },
    ],
    warnings: [],
    ...over,
  },
});

test("the disclaimer is carried, not reconstructed", () => {
  const m = quietModel(payload());
  assert.equal(m.disclaimer, DISCLAIMER);
  // Read from the payload so a reworded or withdrawn disclaimer upstream moves
  // the panel with it, instead of leaving it asserting a sentence the core no
  // longer stands behind.
  const reworded = quietModel(payload({ metadata: { disclaimer: "Reworded upstream.", courtesyDays: 30, companiesChecked: 1 } }));
  assert.equal(reworded.disclaimer, "Reworded upstream.");
  const none = quietModel(payload({ metadata: { courtesyDays: 30, companiesChecked: 1 } }));
  assert.equal(none.disclaimer, null, "an absent disclaimer must read as absent, not as a hardcoded default");
});

test("longest silence first", () => {
  // The only prioritisation this panel offers, and the core does not guarantee
  // an order.
  const m = quietModel(payload());
  assert.deepEqual(m.companies.map((c) => c.company), ["Globex", "Tyrell Corp"]);
  assert.deepEqual(m.companies.map((c) => c.days), [119, 81]);
});

test("a flag is mapped without inventing anything", () => {
  const [first] = quietModel(payload()).companies;
  assert.equal(first.company, "Globex");
  assert.equal(first.role, "Staff Platform Engineer");
  assert.equal(first.lastDate, "2026-06-02");
  assert.deepEqual(first.trackerNums, [2]);
  assert.match(first.reason, /courtesy threshold/);
  assert.match(first.blacklistRow, /^\| Globex \|/);
});

test("a missing role is null rather than an empty label", () => {
  const m = quietModel(payload({
    flags: [{ company: "Acme", role: "   ", daysSinceLastInterview: 40, lastInterviewDate: "2026-08-01" }],
  }));
  assert.equal(m.companies[0].role, null);
  assert.equal(m.companies[0].blacklistRow, null, "an absent suggestion is null, never an empty row to paste");
  assert.deepEqual(m.companies[0].trackerNums, []);
});

test("malformed flags cannot reach the panel", () => {
  const m = quietModel(payload({
    flags: [null, {}, { company: "" }, { company: "   " }, { company: "Real", daysSinceLastInterview: 33 }],
  }));
  assert.deepEqual(m.companies.map((c) => c.company), ["Real"]);
  // A non-numeric day count reads as 0, never as NaN in the sentence.
  const nan = quietModel(payload({ flags: [{ company: "X", daysSinceLastInterview: "many" }] }));
  assert.equal(nan.companies[0].days, 0);
});

test("nothing quiet is different from the check not running", () => {
  const clean = quietModel(payload({ flags: [] }));
  assert.equal(clean.available, true);
  assert.equal(checkRan(clean), true, 'an empty list still means "we looked"');
  assert.deepEqual(clean.companies, []);
  assert.equal(clean.checked, 3);

  for (const reason of ["no-script", "unparseable"]) {
    const broken = quietModel({ available: false, reason, data: null });
    assert.equal(checkRan(broken), false);
    assert.equal(broken.reason, reason);
    assert.equal(broken.disclaimer, null);
  }
  assert.equal(quietModel(null).available, false);
  assert.equal(quietModel(undefined).reason, "unavailable");
});

test("warnings from the core survive", () => {
  // The core warns about placeholder interview rows it had to skip; dropping
  // that would present a partial check as a complete one.
  const m = quietModel(payload({ warnings: ["2 interview rounds have a placeholder company", 7, null] }));
  assert.deepEqual(m.warnings, ["2 interview rounds have a placeholder company"]);
});

test("the list is capped", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ company: `c${i}`, daysSinceLastInterview: 100 - i }));
  assert.equal(quietModel(payload({ flags: many })).companies.length, 10);
  assert.equal(quietModel(payload({ flags: many }), 3).companies.length, 3);
});
