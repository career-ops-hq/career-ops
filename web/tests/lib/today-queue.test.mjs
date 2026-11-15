import assert from "node:assert/strict";
import { test } from "node:test";
import { orderTodayQueue } from "../../src/lib/home/today-queue.mjs";

test("due follow-ups lead the Today queue, ahead of decisions, matches, and upcoming follow-ups", () => {
  const ordered = orderTodayQueue([
    { kind: "match", due: false, id: "match" },
    { kind: "decision", due: false, id: "decision" },
    { kind: "follow-up", due: false, id: "upcoming" },
    { kind: "follow-up", due: true, id: "due" },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["due", "decision", "match", "upcoming"]);
});

test("two due follow-ups keep their incoming order", () => {
  const ordered = orderTodayQueue([
    { kind: "follow-up", due: true, id: "first" },
    { kind: "match", due: false, id: "match" },
    { kind: "follow-up", due: true, id: "second" },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["first", "second", "match"]);
});

test("an empty queue stays empty", () => {
  assert.deepEqual(orderTodayQueue(undefined), []);
});
