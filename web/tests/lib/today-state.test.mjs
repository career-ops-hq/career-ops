import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTodayFollowups, parseTodayMatches, pendingInboxCount, summarizeToday } from "../../src/lib/home/today-state.mjs";

const emptyQueue = {
  freshCount: 0,
  dueCount: 0,
  decisionCount: 0,
  inboxCount: 0,
  followupState: "ready",
  freshState: "ready",
};

test("caught up requires both requests to finish successfully", () => {
  assert.equal(summarizeToday(emptyQueue).allClear, true);
  for (const key of ["followupState", "freshState"]) {
    for (const state of ["loading", "error"]) {
      const summary = summarizeToday({ ...emptyQueue, [key]: state });
      assert.equal(summary.allClear, false);
      assert.notEqual(summary.emptyHeading, "You're all caught up.");
      assert.ok(summary.emptyHeading.length);
    }
  }
});

test("a decision-only or inbox-only queue has a useful heading", () => {
  for (const [key, expectedLabel] of [["decisionCount", "decision to make"], ["inboxCount", "inbox job to review"]]) {
    const summary = summarizeToday({ ...emptyQueue, [key]: 1 });
    assert.equal(summary.allClear, false);
    assert.deepEqual(summary.items, [{ count: 1, label: expectedLabel }]);
  }
});

test("known work stays visible while another part of the queue fails", () => {
  const summary = summarizeToday({ ...emptyQueue, decisionCount: 2, freshState: "error" });
  assert.equal(summary.failed, true);
  assert.deepEqual(summary.items, [{ count: 2, label: "decisions to make" }]);
});

test("each action count prevents an all-clear result", () => {
  for (const key of ["freshCount", "dueCount", "decisionCount", "inboxCount"]) {
    const summary = summarizeToday({ ...emptyQueue, [key]: 4 });
    assert.equal(summary.allClear, false);
    assert.equal(summary.items[0].count, 4);
  }
});

test("pending inbox count agrees with one triage action per unchecked URL", () => {
  assert.equal(pendingInboxCount([
    { url: "https://jobs.example/1", done: true },
    { url: "https://jobs.example/1", done: false },
    { url: "https://jobs.example/1", done: false },
    { url: "https://jobs.example/2", done: true },
    { url: "https://jobs.example/3", done: false },
  ]), 2);
});

test("follow-up unavailable, HTTP failure, and malformed JSON cannot clear the queue", () => {
  for (const [ok, data] of [
    [true, { available: false, entries: [], metadata: null }],
    [false, { available: true, entries: [] }],
    [true, null],
    [true, { available: true }],
  ]) assert.throws(() => parseTodayFollowups(ok, data), /Could not load follow-ups/);
  assert.throws(() => parseTodayFollowups(false, { error: "Follow-up files could not be read." }), /Follow-up files could not be read/);
});

test("follow-up parser preserves upcoming dates and separately counts due metadata", () => {
  const upcoming = { company: "Example", nextFollowupDate: "2026-10-14" };
  assert.deepEqual(parseTodayFollowups(true, { available: true, entries: [], nextUpcoming: upcoming, metadata: { urgent: 2, overdue: 3, waiting: 9 } }), {
    entries: [], due: 5, nextUpcoming: upcoming,
  });
  assert.equal(parseTodayFollowups(true, { available: true, entries: [{ company: "Example" }], metadata: null }).due, 0);
});

test("fresh matches reject unavailable and broken responses without treating them as empty", () => {
  for (const [ok, data] of [
    [false, { offers: [], count: 0 }],
    [true, { available: false, offers: [] }],
    [true, null],
    [true, { offers: "invalid" }],
  ]) assert.throws(() => parseTodayMatches(ok, data), /Could not load fresh matches/);
});

test("fresh matches keep the full server count when the offer list is capped", () => {
  const offers = [{ url: "https://jobs.example/1" }];
  assert.deepEqual(parseTodayMatches(true, { offers, count: 23 }), { offers, count: 23 });
  assert.equal(parseTodayMatches(true, { offers }).count, 1);
  assert.equal(parseTodayMatches(true, { offers, count: "bad" }).count, 1);
  assert.equal(parseTodayMatches(true, { offers: [], count: -4 }).count, 0);
});
