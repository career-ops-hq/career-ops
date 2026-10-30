import assert from "node:assert/strict";
import { test } from "node:test";
import { moveCursor, rangeKeys, trackerCommand, typingFromTarget } from "../../src/lib/tracker-keys.mjs";

test("digits set a canonical status and 7 archives as Discarded", () => {
  assert.deepEqual(trackerCommand({ key: "1" }), { name: "status", status: "Evaluated" });
  assert.deepEqual(trackerCommand({ key: "2" }), { name: "status", status: "Applied" });
  assert.deepEqual(trackerCommand({ key: "3" }), { name: "status", status: "Responded" });
  assert.deepEqual(trackerCommand({ key: "4" }), { name: "status", status: "Interview" });
  assert.deepEqual(trackerCommand({ key: "5" }), { name: "status", status: "Offer" });
  assert.deepEqual(trackerCommand({ key: "6" }), { name: "status", status: "Rejected" });
  assert.deepEqual(trackerCommand({ key: "7" }), { name: "status", status: "Discarded" });
  assert.deepEqual(trackerCommand({ key: "8" }), { name: "status", status: "SKIP" });
});

test("j and k move the focused tracker row", () => {
  assert.deepEqual(trackerCommand({ key: "j" }), { name: "next" });
  assert.deepEqual(trackerCommand({ key: "k" }), { name: "prev" });
  assert.equal(trackerCommand({ key: "ArrowDown" }), null, "arrows keep scrolling the page");
  assert.equal(trackerCommand({ key: "ArrowUp" }), null);
});

test("status keys do nothing while typing or with a modifier", () => {
  assert.equal(trackerCommand({ key: "7", typing: true }), null);
  assert.equal(trackerCommand({ key: "j", composing: true }), null);
  assert.equal(trackerCommand({ key: "2", ctrlKey: true }), null);
  assert.equal(trackerCommand({ key: "2", metaKey: true }), null);
  assert.equal(trackerCommand({ key: "a" }), null);
});

test("shift-click selects the inclusive range between two rows", () => {
  const keys = ["a", "b", "c", "d", "e"];
  assert.deepEqual(rangeKeys(keys, "b", "d"), ["b", "c", "d"]);
  assert.deepEqual(rangeKeys(keys, "d", "b"), ["b", "c", "d"]);
  assert.equal(rangeKeys(keys, "missing", "b"), null);
  assert.equal(rangeKeys(keys, "a", "missing"), null);
});

test("the cursor stays on a real row", () => {
  assert.equal(moveCursor(-1, 4, 1), 0);
  assert.equal(moveCursor(0, 4, -1), 0);
  assert.equal(moveCursor(3, 4, 1), 3);
  assert.equal(moveCursor(1, 0, 1), -1);
});

test("a row checkbox keeps the keys, a text field or dialog takes them", () => {
  assert.equal(typingFromTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(typingFromTarget({ tagName: "INPUT", type: "search" }), true);
  assert.equal(typingFromTarget({ tagName: "INPUT" }), true);
  assert.equal(typingFromTarget({ tagName: "SELECT" }), true);
  assert.equal(typingFromTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(typingFromTarget({ tagName: "BUTTON", closestDialog: true }), true);
  assert.equal(typingFromTarget({ tagName: "BUTTON" }), false);
  assert.equal(typingFromTarget(null), false);
});
