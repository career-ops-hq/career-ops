import { test } from "node:test";
import assert from "node:assert/strict";
import { APPLIED_CONFIRM_PROMPT, APPLIED_CONFIRM_YES, appliedPromptStale, appliedSelectionToken, appliedWriteAllowed } from "../../src/lib/applied-confirm.mjs";

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
  assert.equal(appliedPromptStale({ askedSelection: "", askedCursor: 2, selection: "", cursor: 2 }), false);
  assert.equal(appliedPromptStale({ askedSelection: "", askedCursor: 2, selection: "", cursor: 3 }), true);
});
