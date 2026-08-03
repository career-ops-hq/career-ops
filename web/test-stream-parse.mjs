// Tests for the AI-search stream parser's split-opener handling (#2290).
// Imports directly from stream-parse.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test test-stream-parse.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingOpenerLen } from "./src/lib/stream-parse.mjs";

const OPEN = "<<offer:";

test("holds back the longest trailing prefix of the opener (every split offset)", () => {
  // A buffer ending in each partial opener must hold exactly that many chars, so
  // the rest of the marker arriving next chunk still forms a whole `<<offer:`.
  for (let k = 1; k < OPEN.length; k++) {
    const partial = OPEN.slice(0, k);
    assert.equal(
      pendingOpenerLen("Found a great role " + partial, OPEN),
      k,
      `should hold ${k} chars for trailing "${partial}"`,
    );
  }
});

test("the reported case: a trailing '<<off' is held, not flushed", () => {
  // The old fixed-7-char tail check returned 0 here → the offer was dropped.
  assert.equal(pendingOpenerLen("Found a great role <<off", OPEN), 5);
});

test("holds nothing when the tail can't begin the opener", () => {
  assert.equal(pendingOpenerLen("plain narration text", OPEN), 0);
  assert.equal(pendingOpenerLen("", OPEN), 0);
});

test("a lone '<' is held (it can begin the opener)", () => {
  assert.equal(pendingOpenerLen("ends with a single <", OPEN), 1);
});

test("caps at opener.length - 1 (a complete opener is the found-opener path, not held)", () => {
  assert.ok(pendingOpenerLen("x" + OPEN, OPEN) <= OPEN.length - 1);
});

test("a mid-buffer opener prefix is not mistaken for a trailing one", () => {
  assert.equal(pendingOpenerLen("<<of appeared then more plain text", OPEN), 0);
});
