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
import { pickAwaitingDecision, groupAwaiting } from "../../src/lib/home/awaiting.mjs";

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

test("best score first, whatever order the tracker file happens to be in", () => {
  const rows = [row("2026-08-30", "2.4/5"), row("2026-08-01", "4.9/5"), row("2026-08-15", "3.9/5")];
  assert.deepEqual(
    pickAwaitingDecision(rows, scoreOf).map((r) => r.score),
    ["4.9/5", "3.9/5", "2.4/5"],
  );
});

test("the newer row leads a score tie and an undated row goes last", () => {
  const rows = [row("", "4.0/5"), row("2026-08-01", "4.0/5"), row("2026-08-20", "4.0/5")];
  assert.deepEqual(
    pickAwaitingDecision(rows, scoreOf).map((r) => r.date),
    ["2026-08-20", "2026-08-01", ""],
  );
});

test("an unscored row sorts after every scored row", () => {
  const rows = [row("2026-08-30", ""), row("2026-08-01", "1.0/5")];
  assert.deepEqual(
    pickAwaitingDecision(rows, scoreOf).map((r) => r.date),
    ["2026-08-01", "2026-08-30"],
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

test("every alias that means EVALUATED is offered, not just the English one", () => {
  // /^evaluat/i covered `evaluated`, `evaluada` and `evaluar` and silently
  // dropped the rest, so a tracker written in Turkish — or a Spanish one using
  // `condicional`/`verificar` — rendered an empty queue. The aliases come from
  // templates/states.yml (plus the web-only `evaluado`); status-alias.test.mjs
  // is what keeps that table honest as new market modes land.
  const aliases = [
    "Evaluated", "Evaluada", "Evaluado", "Condicional",
    "Hold", "Evaluar", "Verificar", "değerlendirildi", "Degerlendirildi",
  ];
  const rows = aliases.map((s, i) => row(`2026-08-${String(i + 1).padStart(2, "0")}`, "3.0/5", s));
  assert.equal(
    pickAwaitingDecision(rows, scoreOf, aliases.length).length,
    aliases.length,
    "an alias listed in states.yml was filtered out of the queue",
  );
});

test("a terminal status is still excluded, and prefix-matching is not the reason", () => {
  // Guards the fix from being "accept everything": `Evaluation Pending` starts
  // with `evaluat` and is NOT a canonical evaluated status, so the old prefix
  // test admitted it while canonStatus() correctly does not.
  const rows = [
    row("2026-08-05", "4.0/5", "Applied"),
    row("2026-08-04", "4.0/5", "Rejected"),
    row("2026-08-03", "4.0/5", "Evaluation Pending"),
    row("2026-08-02", "4.0/5", "Evaluated"),
  ];
  assert.deepEqual(pickAwaitingDecision(rows, scoreOf).map((r) => r.date), ["2026-08-02"]);
});

test("an unscored row gets its own group, not Below the apply line", () => {
  const rows = [row("2026-08-04", "4.2/5"), row("2026-08-03", "3.1/5"), row("2026-08-02", ""), row("2026-08-01", "n/a")];
  assert.deepEqual(
    groupAwaiting(pickAwaitingDecision(rows, scoreOf)).map(([label, group]) => [label, group.map((r) => r.date)]),
    [
      ["Recommended", ["2026-08-04"]],
      ["Below the apply line", ["2026-08-03"]],
      ["Not scored yet", ["2026-08-02", "2026-08-01"]],
    ],
  );
});

test("an empty group is left out", () => {
  assert.deepEqual(
    groupAwaiting([row("2026-08-01", "")]).map(([label]) => label),
    ["Not scored yet"],
  );
});

// #5300: the report page passes the posting's legitimacy to applyLineLabel, so
// a flagged 4.5 reads "Check the posting first" there. Today has to agree, and
// the row must stay on Today under that label rather than drop out because the
// label is not one of the groups.
test("a flagged posting above the line is not Recommended", () => {
  const rows = [row("2026-08-04", "4.5/5"), row("2026-08-03", "4.5/5"), row("2026-08-02", "3.1/5")];
  const legitimacy = { "2026-08-04": "Proceed with Caution", "2026-08-03": "High Confidence", "2026-08-02": "Suspicious" };
  assert.deepEqual(
    groupAwaiting(pickAwaitingDecision(rows, scoreOf), (r) => legitimacy[r.date]).map(([label, group]) => [label, group.map((r) => r.date)]),
    [
      ["Recommended", ["2026-08-03"]],
      ["Check the posting first", ["2026-08-04"]],
      ["Below the apply line", ["2026-08-02"]],
    ],
  );
});

test("without legitimacy, grouping is by score alone", () => {
  assert.deepEqual(
    groupAwaiting([row("2026-08-01", "4.5/5")]).map(([label]) => label),
    ["Recommended"],
  );
});
