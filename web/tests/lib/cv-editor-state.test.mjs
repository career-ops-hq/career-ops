import test from "node:test";
import assert from "node:assert/strict";
import { draftChange, draftFromStore, draftToStore, editorReducer, editorStatus, followUpJob, initialEditor, saveFollowUp, shouldSave } from "../../src/lib/cv-editor-state.mjs";

const ready = (content, extra = {}) => ({
  ...initialEditor(),
  phase: "ready",
  content,
  saved: extra.saved ?? content,
  exists: true,
  ...extra,
});

test("a new edit is unsaved, and a finished save of that same text is saved", () => {
  let state = editorReducer(ready("Jane Doe\n"), { type: "edit", content: "Jane Doe\n\nTuesday review." });
  assert.equal(editorStatus(state).label, "Unsaved");
  assert.equal(editorStatus(state).canSave, true);
  state = editorReducer(state, { type: "save-start", content: state.content });
  assert.equal(editorStatus(state).label, "Saving");
  state = editorReducer(state, { type: "save-ok", content: "Jane Doe\n\nTuesday review." });
  assert.equal(editorStatus(state).label, "Saved");
  assert.equal(shouldSave(state), false);
  assert.equal(draftToStore(state), null);
});

test("a save that finishes after a newer edit does not call the newer edit saved", () => {
  let state = editorReducer(ready("one"), { type: "edit", content: "one two" });
  state = editorReducer(state, { type: "save-start", content: "one two" });
  state = editorReducer(state, { type: "edit", content: "one two three" });
  assert.equal(editorStatus(state).label, "Unsaved");
  state = editorReducer(state, { type: "save-ok", content: "one two" });
  assert.equal(state.saved, "one two");
  assert.equal(state.content, "one two three");
  assert.equal(editorStatus(state).label, "Unsaved");
  assert.equal(shouldSave(state), true);
  assert.deepEqual(draftToStore(state), { base: "one two", content: "one two three" });
});

test("a failed save stays unsaved and names the error", () => {
  let state = editorReducer(ready("one"), { type: "edit", content: "one two" });
  state = editorReducer(state, { type: "save-start", content: "one two" });
  state = editorReducer(state, { type: "save-failed", content: "one two", error: "write failed" });
  assert.equal(editorStatus(state).label, "Unsaved");
  assert.equal(editorStatus(state).canSave, true);
  assert.equal(state.error, "write failed");
  assert.equal(state.inflight, null);
});

test("an edit made while a save is in flight still autosaves after that save fails", () => {
  let state = editorReducer(ready("one"), { type: "edit", content: "one two" });
  state = editorReducer(state, { type: "save-start", content: "one two" });
  state = editorReducer(state, { type: "edit", content: "one two three" });
  state = editorReducer(state, { type: "save-failed", content: "one two", error: "write failed" });
  assert.equal(state.content, "one two three");
  assert.equal(state.error, null);
  assert.equal(state.inflight, null);
  assert.equal(shouldSave(state), true);
  assert.equal(editorStatus(state).label, "Unsaved");
});

test("a failed save does not autosave again until the next edit", () => {
  let state = editorReducer(ready("one"), { type: "edit", content: "one two" });
  state = editorReducer(state, { type: "save-start", content: "one two" });
  state = editorReducer(state, { type: "save-failed", content: "one two", error: "write failed" });
  assert.equal(shouldSave(state), false);
  state = editorReducer(state, { type: "edit", content: "one two three" });
  assert.equal(shouldSave(state), true);
});

test("a failed load leaves the stored draft alone, and a saved CV clears it", () => {
  assert.equal(draftChange(initialEditor()), undefined);
  assert.equal(draftChange(editorReducer(initialEditor(), { type: "load-failed", error: "The CV could not be loaded." })), undefined);
  assert.equal(draftChange(ready("one")), null);
  assert.deepEqual(draftChange(ready("one two", { saved: "one" })), { base: "one", content: "one two" });
});

test("a draft written on top of the file comes back, and a draft for an older file does not", () => {
  const restored = editorReducer(initialEditor(), {
    type: "loaded",
    content: "on disk",
    exists: true,
    draft: { base: "on disk", content: "on disk plus a line" },
  });
  assert.equal(restored.content, "on disk plus a line");
  assert.equal(editorStatus(restored).label, "Unsaved");

  const stale = editorReducer(initialEditor(), {
    type: "loaded",
    content: "replaced on disk",
    exists: true,
    draft: { base: "on disk", content: "on disk plus a line" },
  });
  assert.equal(stale.content, "replaced on disk");
  assert.equal(editorStatus(stale).label, "Saved");
});

test("an empty editor does not say Saved when cv.md does not exist", () => {
  const state = editorReducer(initialEditor(), { type: "loaded", content: "", exists: false, draft: null });
  assert.equal(state.exists, false);
  assert.equal(editorStatus(state).label, "No file yet");
  assert.equal(editorStatus(state).canSave, false);
});

test("reverting to the saved text while another save is in flight still says Saving", () => {
  let state = editorReducer(ready("A"), { type: "edit", content: "B" });
  state = editorReducer(state, { type: "save-start", content: "B" });
  state = editorReducer(state, { type: "edit", content: "A" });
  assert.equal(state.inflight, "B");
  assert.equal(editorStatus(state).label, "Saving");
  assert.deepEqual(draftToStore(state), { base: "A", inflight: "B", content: "A" });
  const landed = editorReducer(initialEditor(), {
    type: "loaded",
    content: "B",
    exists: true,
    draft: draftToStore(state),
  });
  assert.equal(landed.content, "A");
  const replaced = editorReducer(initialEditor(), {
    type: "loaded",
    content: "replaced on disk",
    exists: true,
    draft: draftToStore(state),
  });
  assert.equal(replaced.content, "replaced on disk");
});

test("a stored draft keeps the in-flight base for the reload", () => {
  let state = editorReducer(ready("A"), { type: "edit", content: "B" });
  state = editorReducer(state, { type: "save-start", content: "B" });
  state = editorReducer(state, { type: "edit", content: "C" });
  const draft = draftFromStore(JSON.parse(JSON.stringify(draftToStore(state))));
  assert.equal(draft.inflight, "B");
  const landed = editorReducer(initialEditor(), { type: "loaded", content: "B", exists: true, draft });
  assert.equal(landed.content, "C");
  const ignored = draftFromStore({ base: "A", content: "C", inflight: { nope: true } });
  assert.equal(ignored.inflight, undefined);
});

test("a conflicting save keeps the draft and does not write again", () => {
  let state = editorReducer(ready("A"), { type: "edit", content: "C" });
  state = editorReducer(state, { type: "save-start", content: "C" });
  state = editorReducer(state, { type: "edit", content: "D" });
  state = editorReducer(state, {
    type: "save-failed",
    content: "C",
    error: "cv.md changed somewhere else. Your text is still in this tab.",
    conflict: true,
  });
  assert.equal(state.content, "D");
  assert.equal(state.saved, "A");
  assert.equal(shouldSave(state), false);
  assert.equal(editorStatus(state).canSave, false);
  state = editorReducer(state, { type: "edit", content: "E" });
  assert.equal(state.content, "E");
  assert.equal(shouldSave(state), false);
  assert.equal(draftToStore(state).content, "E");
});

test("reverting to the saved text during a conflict does not look saved", () => {
  let state = editorReducer(ready("A"), { type: "edit", content: "B" });
  state = editorReducer(state, { type: "save-start", content: "B" });
  state = editorReducer(state, { type: "edit", content: "A" });
  state = editorReducer(state, {
    type: "save-failed",
    content: "B",
    error: "cv.md changed somewhere else. Your text is still in this tab.",
    conflict: true,
  });
  assert.equal(state.content, "A");
  assert.equal(state.saved, "A");
  assert.equal(editorStatus(state).label, "Unsaved");
  assert.equal(editorStatus(state).canSave, false);
  assert.equal(shouldSave(state), false);
  assert.deepEqual(draftToStore(state), { base: "A", content: "A" });
  const loaded = editorReducer(initialEditor(), {
    type: "loaded",
    content: "Written elsewhere.",
    exists: true,
    draft: draftToStore(state),
  });
  assert.equal(loaded.content, "Written elsewhere.");
  assert.equal(draftToStore(loaded), null);
});

test("an exit flush keeps keepalive when an ordinary save finishes first", () => {
  const job = followUpJob({ keepalive: false }, { text: "C", keepalive: true }, "C");
  assert.deepEqual(job, { text: "C", keepalive: true });
  assert.deepEqual(followUpJob({ keepalive: false }, null, "C"), { text: "C", keepalive: false });
});

test("a follow-up save expects the write that just landed", () => {
  let state = editorReducer(ready("A"), { type: "edit", content: "B" });
  state = editorReducer(state, { type: "save-start", content: "B" });
  assert.equal(saveFollowUp(state, "B"), null);
  state = editorReducer(state, { type: "edit", content: "C" });
  assert.deepEqual(saveFollowUp(state, "B"), { text: "C", expected: { content: "B", exists: true } });
  assert.equal(saveFollowUp(state, "A"), null);
});

test("a newer edit keeps the in-flight text as a draft base", () => {
  let state = editorReducer(ready("A"), { type: "edit", content: "B" });
  state = editorReducer(state, { type: "save-start", content: "B" });
  state = editorReducer(state, { type: "edit", content: "C" });
  assert.deepEqual(draftToStore(state), { base: "A", inflight: "B", content: "C" });
  const landed = editorReducer(initialEditor(), {
    type: "loaded",
    content: "B",
    exists: true,
    draft: draftToStore(state),
  });
  assert.equal(landed.content, "C");
});

test("a failed load cannot be saved, so an empty page cannot replace the file", () => {
  const state = editorReducer(initialEditor(), { type: "load-failed", error: "The CV could not be loaded." });
  assert.equal(editorStatus(state).canSave, false);
  assert.equal(shouldSave(state), false);
  assert.equal(state.content, "");
});
