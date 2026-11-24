// Age and still-open facts for the Today page's "Awaiting your decision" cards,
// and the rule that a closed posting stays listed but sorts last.
//
// Run:  node --test tests/lib/awaiting-age.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { wholeDaysSince, awaitingAge, ageLabels } from "../../src/lib/home/awaiting-age.mjs";
import { pickAwaitingDecision, groupAwaiting } from "../../src/lib/home/awaiting.mjs";

const TODAY = "2026-11-23";
const scoreOf = (s) => {
  const m = String(s).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
};

test("wholeDaysSince counts calendar days and rejects bad input", () => {
  assert.equal(wholeDaysSince("2026-11-23", TODAY), 0);
  assert.equal(wholeDaysSince("2026-11-20", TODAY), 3);
  assert.equal(wholeDaysSince("2026-02-28", "2026-03-01"), 1);
  assert.equal(wholeDaysSince("", TODAY), null);
  assert.equal(wholeDaysSince("2026-13-01", TODAY), null);
  assert.equal(wholeDaysSince("2026-12-01", TODAY), null, "a future date is not an age");
});

test("found and posted days come from stored dates; a missing posting date stays unknown", () => {
  const age = awaitingAge({ firstSeen: "2026-11-20", postedAt: "" }, TODAY);
  assert.equal(age.foundDays, 3);
  assert.equal(age.postedDays, null);
  assert.equal(awaitingAge(null, TODAY).foundDays, null);
});

test("open state: checked open, closed by verdict, closed by close date, never checked", () => {
  assert.deepEqual(awaitingAge({ check: { result: "active", day: "2026-11-21" } }, TODAY).open, { state: "open", checkedDays: 2 });
  assert.equal(awaitingAge({ check: { result: "expired", day: "2026-11-22" } }, TODAY).open.state, "closed");
  assert.equal(awaitingAge({ check: { result: "active", day: "2026-11-21" } }, TODAY, "2026-11-22").open.state, "closed");
  assert.equal(awaitingAge({ check: { result: "active", day: "2026-11-21" } }, TODAY, "2026-11-23").open.state, "open", "closing today is still open");
  assert.deepEqual(awaitingAge({}, TODAY).open, { state: "unchecked", checkedDays: null });
});

test("labels read plainly", () => {
  const l = ageLabels(awaitingAge({ firstSeen: "2026-11-22", postedAt: "2026-11-10", check: { result: "active", day: "2026-11-23" } }, TODAY));
  assert.deepEqual(l, { found: "Found 1 day ago", posted: "Posted 13 days ago", open: "Open, checked today" });
  const u = ageLabels(awaitingAge({}, TODAY));
  assert.deepEqual(u, { found: "Found: unknown", posted: "Posted: unknown", open: "Not checked" });
  assert.equal(ageLabels(awaitingAge({ postedAt: TODAY, check: { result: "expired", day: TODAY } }, TODAY)).open, "Closed, checked today");
  assert.equal(ageLabels(awaitingAge({ check: { result: "expired", day: "2026-11-21" } }, TODAY)).open, "Closed, checked 2 days ago");
  assert.equal(ageLabels(awaitingAge({ check: { result: "active", day: "2026-11-21" } }, TODAY, "2026-11-22")).open, "Closed", "a close date has no check day");
  assert.equal(ageLabels(awaitingAge({}, TODAY, "2026-11-22")).open, "Closed");
  assert.equal(ageLabels(awaitingAge({ postedAt: TODAY }, TODAY)).posted, "Posted today");
});

test("a closed posting stays listed but sorts after every open one", () => {
  const rows = [
    { n: "1", date: "2026-11-01", score: "4.9/5", status: "Evaluated" },
    { n: "2", date: "2026-11-01", score: "3.0/5", status: "Evaluated" },
    { n: "3", date: "2026-11-01", score: "4.0/5", status: "Evaluated" },
  ];
  const closed = (r) => r.n === "1";
  assert.deepEqual(pickAwaitingDecision(rows, scoreOf, 6, closed).map((r) => r.n), ["3", "2", "1"]);
  assert.deepEqual(pickAwaitingDecision(rows, scoreOf, 2, closed).map((r) => r.n), ["3", "2"], "closed rows are the first cut by the limit");
  assert.deepEqual(pickAwaitingDecision(rows, scoreOf).map((r) => r.n), ["1", "3", "2"], "no closedOf keeps the old order");
});

test("closed postings render after every open group, whatever their score", () => {
  const rows = [
    { n: "1", date: "2026-11-01", score: "4.9/5", status: "Evaluated" },
    { n: "2", date: "2026-11-01", score: "3.0/5", status: "Evaluated" },
    { n: "3", date: "2026-11-01", score: "", status: "Evaluated" },
  ];
  const closed = (r) => r.n === "1";
  const groups = groupAwaiting(pickAwaitingDecision(rows, scoreOf, 6, closed), () => undefined, closed);
  assert.deepEqual(groups.map(([label, g]) => [label, g.map((r) => r.n)]), [
    ["Below the apply line", ["2"]],
    ["Not scored yet", ["3"]],
    ["Closed", ["1"]],
  ]);
  assert.deepEqual(groupAwaiting(rows).map(([label]) => label), ["Recommended", "Below the apply line", "Not scored yet"], "no closedOf keeps the old groups");
});
