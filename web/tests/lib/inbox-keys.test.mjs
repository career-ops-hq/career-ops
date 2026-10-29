import assert from "node:assert/strict";
import { test } from "node:test";
import { cursorAfterRemoval, inboxCommand, moveCursor, typingFromTarget } from "../../src/lib/inbox-keys.mjs";

test("j and k move, s saves, and x skips the focused posting", () => {
  assert.equal(inboxCommand({ key: "j" }), "next");
  assert.equal(inboxCommand({ key: "ArrowDown" }), null, "arrows keep scrolling the page");
  assert.equal(inboxCommand({ key: "k" }), "prev");
  assert.equal(inboxCommand({ key: "ArrowUp" }), null);
  assert.equal(inboxCommand({ key: "s" }), "save");
  assert.equal(inboxCommand({ key: "x" }), "skip");
  assert.equal(inboxCommand({ key: "X" }), "skip");
});

test("Shift+X skips the selection only when something is selected", () => {
  assert.equal(inboxCommand({ key: "X", shiftKey: true, selected: 3 }), "skip-selected");
  assert.equal(inboxCommand({ key: "x", shiftKey: true, selected: 0 }), "skip");
});

test("holding x or s does not skip or save again, and holding j still moves", () => {
  assert.equal(inboxCommand({ key: "x", repeat: true }), null);
  assert.equal(inboxCommand({ key: "s", repeat: true }), null);
  assert.equal(inboxCommand({ key: "X", shiftKey: true, selected: 2, repeat: true }), null);
  assert.equal(inboxCommand({ key: "j", repeat: true }), "next");
  assert.equal(inboxCommand({ key: "k", repeat: true }), "prev");
});

test("keys do nothing while typing, composing, or holding a modifier", () => {
  assert.equal(inboxCommand({ key: "x", typing: true }), null);
  assert.equal(inboxCommand({ key: "j", composing: true }), null);
  assert.equal(inboxCommand({ key: "s", metaKey: true }), null);
  assert.equal(inboxCommand({ key: "s", ctrlKey: true }), null);
  assert.equal(inboxCommand({ key: "k", altKey: true }), null);
  assert.equal(inboxCommand({ key: "Enter" }), null);
});

test("a field or an open dialog is typing, a button is not", () => {
  assert.equal(typingFromTarget({ tagName: "INPUT" }), true);
  assert.equal(typingFromTarget({ tagName: "INPUT", type: "search" }), true);
  assert.equal(typingFromTarget({ tagName: "INPUT", type: "checkbox" }), false, "a checked row keeps Shift+X");
  assert.equal(typingFromTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(typingFromTarget({ tagName: "SELECT" }), true);
  assert.equal(typingFromTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(typingFromTarget({ tagName: "BUTTON", closestDialog: true }), true);
  assert.equal(typingFromTarget({ tagName: "BUTTON" }), false);
  assert.equal(typingFromTarget(null), false);
});

test("the cursor stays inside the visible list", () => {
  assert.equal(moveCursor(-1, 5, 1), 0);
  assert.equal(moveCursor(-1, 5, -1), 4);
  assert.equal(moveCursor(0, 5, -1), 0);
  assert.equal(moveCursor(4, 5, 1), 4);
  assert.equal(moveCursor(2, 5, 1), 3);
  assert.equal(moveCursor(0, 0, 1), -1);
});

test("skipping the focused row leaves the cursor on the row that slides up", () => {
  assert.equal(cursorAfterRemoval(2, 2), 2);
  assert.equal(cursorAfterRemoval(3, 1), 2);
  assert.equal(cursorAfterRemoval(1, 3), 1);
});
