// Tests for isScannerMissing() using Node's built-in test runner.
// Imports directly from explore-error.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/explore-error.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isScannerMissing,
  scannerMissingBody,
  SCANNER_MISSING_CODE,
  SCANNER_MISSING_STATUS,
} from "../../src/lib/explore-error.mjs";

// The data-only / pre-onboarding checkout has no scanner. /api/explore signals it
// with an explicit code in the response body. This is the only failure the
// "Discovery needs the full toolkit" panel (call to action: update career-ops)
// should ever cover.
test("the scanner-missing code is scanner-missing", () => {
  assert.equal(isScannerMissing({ code: SCANNER_MISSING_CODE }), true);
  assert.equal(isScannerMissing(scannerMissingBody()), true);
});

// The reason this keys on a code and not on HTTP 400.
//
// 400 is a SHARED channel. /api/explore/ai returns three structurally different
// 400s, and the AI call site in explore-provider.tsx classified all of them as
// "your checkout has no scanner":
//
//   { error: "bad json" }
//   { error: "query and cliId required" }
//   { code: "MODE_MISSING", error: "AI search needs a newer career-ops — …" }
//
// So a malformed request rendered the "Discovery needs the full toolkit" panel
// and told the user to update career-ops when nothing was wrong with their
// checkout. MODE_MISSING is the sharpest case: it is a real, DIFFERENT missing
// -capability error with its own copy, and it was overwritten by the scanner
// panel's.
test("the other 400s on the shared channel are NOT scanner-missing", () => {
  assert.equal(isScannerMissing({ code: "MODE_MISSING", error: "AI search needs a newer career-ops — update to enable it." }), false);
  assert.equal(isScannerMissing({ error: "bad json" }), false);
  assert.equal(isScannerMissing({ error: "query and cliId required" }), false);
});

// Regression guard from the original defect. A runtime scan error streams back
// AFTER a 200 response and carries no code. Its real message, "The scanner
// returned no readable output.", contains the word "scanner", which is what used
// to trip the panel via text matching. Neither the text nor the absence of a code
// may classify it as a broken checkout.
test("a runtime stream error is NOT scanner-missing", () => {
  assert.equal(isScannerMissing({ error: "The scanner returned no readable output." }), false);
  assert.equal(isScannerMissing({ error: "The scanner isn't available." }), false);
});

// Never throws and never guesses: this runs on a failure path, where the body is
// whatever the server actually sent — possibly nothing, possibly not JSON. The
// call sites use `.catch(() => ({}))`, so `{}` is the common real input.
test("a missing or non-object body is NOT scanner-missing", () => {
  assert.equal(isScannerMissing({}), false);
  assert.equal(isScannerMissing(undefined), false);
  assert.equal(isScannerMissing(null), false);
  assert.equal(isScannerMissing("SCANNER_MISSING"), false);
  assert.equal(isScannerMissing(400), false);
});

// The old signature took an HTTP status. Passing one now must NOT match, or a
// call site left un-migrated would keep the exact bug this change removes while
// still type-checking.
test("the old status-based call does not silently keep working", () => {
  assert.equal(isScannerMissing(SCANNER_MISSING_STATUS), false);
});

// Both ends of the contract are built from the same constant, so the route and
// the classifier cannot drift apart — the failure mode this whole module exists
// to prevent.
test("the response body the route sends is classified by the client", () => {
  const body = scannerMissingBody();
  assert.equal(body.code, SCANNER_MISSING_CODE);
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.length > 0, "the panel renders body.error, so it must carry copy");
  assert.equal(isScannerMissing(body), true);
});
