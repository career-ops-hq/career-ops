// Tests for the assistant console's partial <<act:> opener hiding (#2290-class).
// Imports directly from act-envelope.mjs (the single source of truth) so the
// test and production code can never drift.
//
// Run:  node --test tests/lib/act-envelope.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingActOpenerStart } from "../../src/lib/act-envelope.mjs";

test("every trailing partial opener is caught as the stream builds `<<act:navigate `", () => {
  // Char-by-char up to (but not including) the space the regex requires: each
  // trailing partial must report a hide-start so it never renders.
  const prefix = "Here you go. ";
  const opener = "<<act:navigate"; // no trailing space yet
  for (let i = 1; i <= opener.length; i++) {
    const acc = prefix + opener.slice(0, i);
    assert.equal(
      pendingActOpenerStart(acc),
      prefix.length,
      `partial "${opener.slice(0, i)}" should hide from index ${prefix.length}`,
    );
  }
});

test("a lone '<' and the bare '<<act:' are both hidden", () => {
  assert.equal(pendingActOpenerStart("text <"), 5);
  assert.equal(pendingActOpenerStart("text <<act:"), 5);
});

test("no trailing opener → -1", () => {
  assert.equal(pendingActOpenerStart("plain assistant prose"), -1);
  assert.equal(pendingActOpenerStart(""), -1);
});

test("a completed envelope earlier in the buffer is not matched", () => {
  // Followed by `>>` and more text — the tail isn't a partial opener.
  const acc = 'Done <<act:navigate {"path":"/"}>> and more prose';
  assert.equal(pendingActOpenerStart(acc), -1);
});

test("once the trailing space arrives, this helper defers to the main regex", () => {
  // `<<act:save ` (space, no `>>`) is the main regex's job, not ours.
  assert.equal(pendingActOpenerStart("x <<act:save "), -1);
});

test("a mid-buffer '<<act:' with later prose is not mistaken for a trailing one", () => {
  assert.equal(pendingActOpenerStart("<<act:nav then the space came and text"), -1);
});
