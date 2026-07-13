// Tests for isScannerMissing() using Node's built-in test runner.
// Imports directly from explore-error.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test test-explore-error.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { isScannerMissing } from "./src/lib/explore-error.mjs";

// The data-only / pre-onboarding checkout has no scanner. /api/explore signals it
// with an HTTP 400 BEFORE any stream starts. This is the only failure the
// "Discovery needs the full toolkit" panel (call to action: update career-ops)
// should ever cover.
test("HTTP 400 (data-only checkout) is scanner-missing", () => {
  assert.equal(isScannerMissing(400), true);
});

// Regression guard. A runtime scan error streams back AFTER a 200 response, so its
// status is not 400. The real message "The scanner returned no readable output."
// contains the word "scanner", which is exactly what used to trip the panel and
// wrongly tell the user their checkout was data-only / outdated. Keying off the
// status instead of the message text must classify it as a plain failure.
test("runtime stream error (HTTP 200) is NOT scanner-missing", () => {
  assert.equal(isScannerMissing(200), false);
});

// Any other transport/server failure is a plain failure, never scanner-missing.
test("other statuses are NOT scanner-missing", () => {
  assert.equal(isScannerMissing(500), false);
  assert.equal(isScannerMissing(404), false);
  assert.equal(isScannerMissing(undefined), false);
});
