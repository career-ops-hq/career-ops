// Tests for scroll-to-top.mjs using Node's built-in test runner. Imports the
// same helpers the BackToTop component uses, so the visibility threshold and
// the reduced-motion behavior can never drift from what ships.
//
// Run:  node --test tests/lib/scroll-to-top.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACK_TO_TOP_THRESHOLD,
  shouldShowBackToTop,
  scrollBehaviorFor,
} from "../../src/lib/scroll-to-top.mjs";

test("hidden at the very top of the page", () => {
  assert.equal(shouldShowBackToTop(0), false);
});

test("hidden while still within the threshold", () => {
  assert.equal(shouldShowBackToTop(BACK_TO_TOP_THRESHOLD - 1), false);
});

test("still hidden exactly at the threshold", () => {
  assert.equal(shouldShowBackToTop(BACK_TO_TOP_THRESHOLD), false);
});

test("shown once scrolled past the threshold", () => {
  assert.equal(shouldShowBackToTop(BACK_TO_TOP_THRESHOLD + 1), true);
  assert.equal(shouldShowBackToTop(5000), true);
});

test("a custom threshold is respected", () => {
  assert.equal(shouldShowBackToTop(250, 300), false);
  assert.equal(shouldShowBackToTop(350, 300), true);
});

test("reduced motion jumps instantly, otherwise it glides", () => {
  assert.equal(scrollBehaviorFor(true), "auto");
  assert.equal(scrollBehaviorFor(false), "smooth");
});
