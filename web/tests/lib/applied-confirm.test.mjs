import { test } from "node:test";
import assert from "node:assert/strict";
import { APPLIED_CONFIRM_PROMPT, APPLIED_CONFIRM_YES, appliedPromptStale, appliedSelectionToken, appliedWriteAllowed, statusEditAction } from "../../src/lib/applied-confirm.mjs";

test("Applied does not write until the user confirms they submitted", () => {
  const blocked = appliedWriteAllowed({ status: "Applied", confirmed: false });
  assert.equal(blocked.write, false);
  assert.equal(blocked.prompt, APPLIED_CONFIRM_PROMPT);
  assert.equal(blocked.yesLabel, APPLIED_CONFIRM_YES);
  assert.match(blocked.prompt, /Did you submit this application\?/);

  const allowed = appliedWriteAllowed({ status: "Applied", confirmed: true });
  assert.equal(allowed.write, true);
  assert.equal(allowed.prompt, null);
});

test("Skip still writes on the first click", () => {
  assert.equal(appliedWriteAllowed({ status: "Discarded", confirmed: false }).write, true);
});

test("the Applied prompt goes stale when the checked rows change", () => {
  const asked = appliedSelectionToken(["b", "a"]);
  assert.equal(asked, "a\nb");
  assert.equal(appliedPromptStale({ askedSelection: asked, askedCursor: 1, selection: asked, cursor: 4 }), false);
  assert.equal(appliedPromptStale({ askedSelection: asked, askedCursor: 1, selection: appliedSelectionToken(["a"]), cursor: 1 }), true);
});

test("a cursor move makes a cursor-only Applied prompt stale", () => {
  assert.equal(appliedPromptStale({ askedSelection: "", askedCursor: 2, askedCursorKey: "a", selection: "", cursor: 2, cursorKey: "a" }), false);
  assert.equal(appliedPromptStale({ askedSelection: "", askedCursor: 2, askedCursorKey: "a", selection: "", cursor: 3, cursorKey: "b" }), true);
});

test("a different row at the same cursor index makes a cursor-only Applied prompt stale", () => {
  assert.equal(appliedPromptStale({
    askedSelection: "",
    askedCursor: 2,
    askedCursorKey: "alpha",
    selection: "",
    cursor: 2,
    cursorKey: "beta",
  }), true);
});

test("the row editor asks before it saves Applied and saves every other status", () => {
  assert.equal(statusEditAction("Applied", "Evaluated"), "ask");
  assert.equal(statusEditAction("Interview", "Evaluated"), "save");
  assert.equal(statusEditAction("Evaluated", "Evaluated"), "keep");
});
