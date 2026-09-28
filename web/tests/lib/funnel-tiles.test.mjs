// Tests for the analytics headline tiles' cumulative counters.
// Imports directly from funnel-tiles.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/funnel-tiles.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { cumulativeTiles } from "../../src/lib/funnel-tiles.mjs";

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
  // Rejected row that never got a reply is indistinguishable from one rejected
  // after onsites, so counting it would overstate the funnel.
  const t = cumulativeTiles(["REJECTED", "REJECTED"]);
  assert.equal(t.interviews, 0);
  assert.equal(t.offers, 0);
});

test("an empty or absent pipeline is zero, not a crash", () => {
  assert.deepEqual(cumulativeTiles([]), { interviews: 0, offers: 0 });
  assert.deepEqual(cumulativeTiles(undefined), { interviews: 0, offers: 0 });
});
