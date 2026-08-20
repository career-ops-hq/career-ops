// Tests for the "new matches this week" company-suppression predicate.
//
// The supply loop hides an offer whose company already sits in the tracker. The
// bug this guards against: the predicate used to ignore `status` entirely, so a
// Rejected row (the employer's verdict on ONE role) or a Discarded row (the
// candidate's own pass on ONE role) hid every other posting at that employer,
// including ones published later on different teams.
//
// Run:  node --test tests/lib/whats-new-suppression.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { suppressesCompany } from "../../src/lib/whats-new-suppression.mjs";

test("Rejected and Discarded do not suppress the employer", () => {
  assert.equal(suppressesCompany("Rejected"), false);
  assert.equal(suppressesCompany("Discarded"), false);
});

test("every other canonical state still suppresses", () => {
  for (const s of ["Evaluated", "Applied", "Responded", "Interview", "Offer", "Hired", "SKIP"]) {
    assert.equal(suppressesCompany(s), true, `${s} should suppress`);
  }
});

test("matching is case- and whitespace-insensitive", () => {
  for (const s of ["rejected", "REJECTED", "  Rejected  ", "\tdiscarded\n"]) {
    assert.equal(suppressesCompany(s), false, `${JSON.stringify(s)} should not suppress`);
  }
});

test("a missing or empty status suppresses (unknown rows stay hidden)", () => {
  for (const s of ["", "   ", undefined, null]) {
    assert.equal(suppressesCompany(s), true);
  }
});

test("substring lookalikes are not treated as Rejected/Discarded", () => {
  // Guards against a bare /rejected/ test: a status column carrying extra text
  // is non-canonical and must not silently unsuppress.
  assert.equal(suppressesCompany("Rejected after interview"), true);
  assert.equal(suppressesCompany("Not rejected"), true);
});
