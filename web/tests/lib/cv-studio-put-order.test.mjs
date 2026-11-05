import test from "node:test";
import assert from "node:assert/strict";
import { createPutOrder, shouldSendEdits } from "../../src/lib/cv-studio/put-order.mjs";

test("an older PUT from the same tab is dropped once a newer one was written", () => {
  const order = createPutOrder();
  assert.equal(order.accept("011", "tab-a", 2), true);
  assert.equal(order.accept("011", "tab-a", 1), false);
  assert.equal(order.accept("011", "tab-a", 2), false);
  assert.equal(order.accept("011", "tab-a", 3), true);
});

test("tabs and reports keep separate counts", () => {
  const order = createPutOrder();
  assert.equal(order.accept("011", "tab-a", 5), true);
  assert.equal(order.accept("011", "tab-b", 1), true);
  assert.equal(order.accept("012", "tab-a", 1), true);
});

test("leaving the page sends a reverted payload while a different save is in flight", () => {
  assert.equal(shouldSendEdits("A", "A", "B", true), true);
  assert.equal(shouldSendEdits("A", "A", "B", false), false);
  assert.equal(shouldSendEdits("A", "A", null, true), false);
  assert.equal(shouldSendEdits("A", "B", "B", false), false);
  assert.equal(shouldSendEdits("A", "B", "B", true), true);
  assert.equal(shouldSendEdits("A", "C", "B", false), true);
});

test("a PUT without a usable tab or number is written", () => {
  const order = createPutOrder();
  assert.equal(order.accept("011", undefined, undefined), true);
  assert.equal(order.accept("011", "tab-a", "7"), true);
  assert.equal(order.accept("011", "x".repeat(65), 1), true);
  assert.equal(order.accept("011", "tab-a", 1.5), true);
});
