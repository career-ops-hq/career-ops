import assert from "node:assert/strict";
import { test } from "node:test";
import { rangeKeys, selectionAfterFailedSave, trackerCommand } from "../../src/lib/tracker-keys.mjs";

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

test("a held status key does not repeat, and j and k still do", () => {
  assert.equal(trackerCommand({ key: "6", repeat: true }), null);
  assert.deepEqual(trackerCommand({ key: "j", repeat: true }), { name: "next" });
  assert.deepEqual(trackerCommand({ key: "k", repeat: true }), { name: "prev" });
});

test("status keys do nothing while typing or with a modifier", () => {
  assert.equal(trackerCommand({ key: "1", pending: true }), null);
  assert.equal(trackerCommand({ key: "j", pending: true }), null);
  assert.equal(trackerCommand({ key: "7", typing: true }), null);
  assert.equal(trackerCommand({ key: "j", composing: true }), null);
  assert.equal(trackerCommand({ key: "2", ctrlKey: true }), null);
  assert.equal(trackerCommand({ key: "2", metaKey: true }), null);
  assert.equal(trackerCommand({ key: "2", altKey: true }), null);
  assert.equal(trackerCommand({ key: "a" }), null);
});

test("shift-click selects the inclusive range between two rows", () => {
  const keys = ["a", "b", "c", "d", "e"];
  assert.deepEqual(rangeKeys(keys, "b", "d"), ["b", "c", "d"]);
  assert.deepEqual(rangeKeys(keys, "d", "b"), ["b", "c", "d"]);
  assert.equal(rangeKeys(keys, "missing", "b"), null);
  assert.equal(rangeKeys(keys, "a", "missing"), null);
});

test("a failed save keeps the failed row and a row checked while the save ran", () => {
  const keyOf = (row) => `n:${row.n}`;
  const cursorOnly = [{ n: "4" }];
  assert.deepEqual(selectionAfterFailedSave([], cursorOnly, new Set(["4"]), keyOf), []);
  const selected = ["n:2", "n:4", "n:9"];
  const attempted = [{ n: "2" }, { n: "4" }];
  assert.deepEqual(selectionAfterFailedSave(selected, attempted, new Set(["4"]), keyOf), ["n:4", "n:9"]);
  assert.deepEqual(selectionAfterFailedSave(selected, attempted, new Set(), keyOf), ["n:9"]);
  assert.deepEqual(selectionAfterFailedSave(["n:9"], attempted, new Set(["4"]), keyOf), ["n:9"]);
});
