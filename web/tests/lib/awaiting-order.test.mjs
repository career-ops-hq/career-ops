// Tests for the Today page's "Awaiting your decision" card list.
//
// The behaviour under test is the one that used not to exist: before this,
// the page took `applications.filter(isEvaluated).slice(0, 6)` with no sort,
// so the six cards were whichever six sat first in data/applications.md.
// #3529 made merge-tracker re-sort that file by # on every write, which would
// have changed the card set with no change to this component.
//
// Run:  node --test tests/lib/awaiting-order.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAwaitingDecision } from "../../src/lib/home/awaiting.mjs";

// The real parser is lib/format.ts's scoreNum, which a .mjs test cannot import.
// This stub must stay behaviourally identical for the cases below: a leading
// number wins, anything unparseable is NaN.
const scoreOf = (s) => {
  const m = String(s).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
};

const row = (date, score, status = "Evaluated") => ({ date, score, status, company: `${date}|${score}` });

test("only scored-but-undecided rows are offered", () => {
  const rows = [row("2026-08-20", "4.0/5"), row("2026-08-21", "4.0/5", "Applied"), row("2026-08-22", "4.0/5", "Rejected")];
  assert.deepEqual(
    pickAwaitingDecision(rows, scoreOf).map((r) => r.date),
    ["2026-08-20"],
  );
});

test("the status match is a case-insensitive prefix, so a dated or lowercase Evaluated still counts", () => {
  // The tracker carries dated and localized-cased statuses; the page's own
  // regex has always been /^evaluat/i and the extraction must not narrow it.
  const rows = [row("2026-08-20", "4.0/5", "evaluated"), row("2026-08-21", "4.0/5", "Evaluated 2026-08-21")];
  assert.equal(pickAwaitingDecision(rows, scoreOf).length, 2);
});

test("newest first, whatever order the tracker file happens to be in", () => {
  // Deliberately supplied oldest-first: this is the case #3529 can reshuffle.
  const rows = [row("2026-08-01", "3.0/5"), row("2026-08-30", "3.0/5"), row("2026-08-15", "3.0/5")];
  assert.deepEqual(
    pickAwaitingDecision(rows, scoreOf).map((r) => r.date),
    ["2026-08-30", "2026-08-15", "2026-08-01"],
  );
});

test("the score breaks a same-day tie so the better offer leads", () => {
  const rows = [row("2026-08-20", "3.0/5"), row("2026-08-20", "4.7/5"), row("2026-08-20", "4.1/5")];
  assert.deepEqual(
    pickAwaitingDecision(rows, scoreOf).map((r) => r.score),
    ["4.7/5", "4.1/5", "3.0/5"],
  );
});

test("an undated row sorts last even with the highest score", () => {
  // Two negations deep: "" compares LESS than any date, and the comparison is
  // descending, so least lands at the end. Getting this backwards would put
  // every malformed row at the top of the user's action queue, silently.
  const rows = [row("2026-08-01", "1.0/5"), row("", "5.0/5")];
  assert.deepEqual(
    pickAwaitingDecision(rows, scoreOf).map((r) => r.score),
    ["1.0/5", "5.0/5"],
  );
});

test("two unscored rows do not produce a NaN comparator", () => {
  // rank() returns -1 rather than -Infinity precisely so this subtraction stays
  // finite; -Infinity - -Infinity is NaN and leaves the sort order undefined.
  const rows = [row("2026-08-20", ""), row("2026-08-20", "n/a")];
  const out = pickAwaitingDecision(rows, scoreOf);
  assert.equal(out.length, 2);
  assert.equal(out.every((r) => r && typeof r.date === "string"), true);
});

test("the limit truncates AFTER sorting, never before", () => {
  // The whole point: slicing an unsorted list is what made the card set a
  // property of the file rather than of the queue.
  const rows = Array.from({ length: 10 }, (_, i) => row(`2026-08-${String(i + 1).padStart(2, "0")}`, "3.0/5"));
  assert.deepEqual(
    pickAwaitingDecision(rows, scoreOf, 3).map((r) => r.date),
    ["2026-08-10", "2026-08-09", "2026-08-08"],
  );
});

test("the caller's array is not reordered underneath it", () => {
  // `applications` is shared with the pipeline table and the analytics tiles;
  // sorting it in place would reorder those too, from a memo in the Today page.
  const rows = [row("2026-08-01", "3.0/5"), row("2026-08-30", "3.0/5")];
  pickAwaitingDecision(rows, scoreOf);
  assert.deepEqual(rows.map((r) => r.date), ["2026-08-01", "2026-08-30"]);
});
