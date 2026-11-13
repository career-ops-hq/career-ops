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
import { pickAwaitingDecision, groupAwaiting, pickApplyNext, includeApplyTarget } from "../../src/lib/home/awaiting.mjs";
import { cardReason } from "../../src/lib/machine-summary.mjs";

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

const queued = (n, score, company) => ({ n, date: "2026-11-01", score, status: "Evaluated", company });
const callOf = (calls) => (row) => calls[row.n] ?? "";

test("Apply next names the best stored Apply, and a Skip stays on the page", () => {
  const rows = [
    queued("1", "4.9/5", "Fixture Northwind"),
    queued("2", "4.8/5", "Fixture Contoso Research"),
    queued("3", "4.7/5", "Fixture Fabrikam"),
    queued("4", "4.6/5", "Fixture Alpine"),
    queued("5", "4.5/5", "Fixture Harbor"),
    queued("6", "4.4/5", "Fixture Ledger"),
    queued("7", "4.1/5", "Fixture Apply Co"),
  ];
  const calls = {
    "1": "Skip",
    "2": "Research first",
    "3": "Consider",
    "4": "Skip",
    "5": "Skip",
    "6": "Research first",
    "7": "Apply",
  };
  const shown = pickAwaitingDecision(rows, scoreOf);
  const target = pickApplyNext(rows, scoreOf, callOf(calls));
  const cards = includeApplyTarget(shown, target);
  assert.equal(target?.company, "Fixture Apply Co");
  assert.equal(target?.score, "4.1/5");
  assert.equal(shown.some((row) => row.company === "Fixture Apply Co"), false);
  assert.ok(cards.some((row) => row.company === "Fixture Northwind" && calls[row.n] === "Skip"));
  assert.ok(cards.some((row) => row.company === "Fixture Apply Co"));
  assert.equal(rows.find((row) => row.n === "1").score, "4.9/5");
  const recommended = groupAwaiting(cards, () => "High Confidence").find(([label]) => label === "Recommended")?.[1] ?? [];
  assert.equal(recommended[0]?.company, "Fixture Northwind");
});

test("within the six cards, a lower Apply is the one-click target", () => {
  const rows = [
    queued("10", "4.8/5", "Fixture High Skip"),
    queued("11", "4.2/5", "Fixture Lower Apply"),
  ];
  const calls = { "10": "Skip", "11": "Apply" };
  const shown = pickAwaitingDecision(rows, scoreOf);
  const target = pickApplyNext(rows, scoreOf, callOf(calls));
  assert.ok(shown.some((row) => row.company === "Fixture High Skip"));
  assert.ok(shown.some((row) => row.company === "Fixture Lower Apply"));
  assert.equal(target?.company, "Fixture Lower Apply");
  assert.equal(includeApplyTarget(shown, target).length, 2);
  assert.equal(rows.find((row) => row.n === "10").score, "4.8/5");
});

test("Research first and Consider are not the one-click target", () => {
  const rows = [
    queued("1", "5.0/5", "Fixture Research"),
    queued("2", "4.9/5", "Fixture Consider"),
    queued("3", "3.2/5", "Fixture Apply Co"),
  ];
  const target = pickApplyNext(rows, scoreOf, callOf({ "1": "Research first", "2": "Consider", "3": "Apply" }));
  assert.equal(target?.company, "Fixture Apply Co");
  assert.equal(rows.find((row) => row.n === "3").score, "3.2/5");
});

test("a missing call is not Apply next, and no Apply means no target", () => {
  const rows = [
    queued("1", "4.9/5", "Fixture Old Report"),
    queued("2", "3.5/5", "Fixture Apply Co"),
  ];
  assert.equal(pickApplyNext(rows, scoreOf, (row) => (row.n === "2" ? "Apply" : ""))?.company, "Fixture Apply Co");
  assert.equal(pickApplyNext([queued("1", "4.9/5", "Fixture Northwind")], scoreOf, () => "Skip"), null);
  assert.equal(pickApplyNext([queued("1", "4.9/5", "Fixture Translated")], scoreOf, () => "Søg"), null);
});

test("the newer Apply wins a score tie", () => {
  const older = queued("1", "4.2/5", "Fixture Older");
  const newer = queued("2", "4.2/5", "Fixture Newer");
  newer.date = "2026-11-08";
  assert.equal(pickApplyNext([older, newer], scoreOf, () => "Apply")?.company, "Fixture Newer");
});

test("a hard stop does not remove a Skip or override an Apply", () => {
  const report = (decision, extra) => `## Machine Summary\n\n\`\`\`yaml\nfinal_decision: "${decision}"\n${extra}\n\`\`\`\n`;
  const rows = [
    {
      ...queued("1", "4.9/5", "Fixture Blocked Skip"),
      report: report("Skip", 'hard_stops:\n  - "No sponsorship"\ndiscard_reasons:\n  - "geo_restriction"'),
    },
    {
      ...queued("2", "4.0/5", "Fixture Apply Co"),
      report: report("Apply", "discard_reasons: []\nhard_stops: []"),
    },
  ];
  const decisionOf = (row) => cardReason(row.report)?.decision ?? "";
  assert.equal(decisionOf(rows[0]), "Skip");
  assert.equal(pickApplyNext(rows, scoreOf, decisionOf)?.company, "Fixture Apply Co");
  assert.ok(pickAwaitingDecision(rows, scoreOf).some((row) => row.company === "Fixture Blocked Skip"));
  assert.equal(rows[0].score, "4.9/5");
});

test("a legitimacy-flagged Apply is not the one-click target", () => {
  const rows = [
    queued("1", "4.8/5", "Fixture Flagged Apply"),
    queued("2", "4.2/5", "Fixture Clean Apply"),
  ];
  const legitimacy = { "1": "Proceed with Caution", "2": "High Confidence" };
  const target = pickApplyNext(rows, scoreOf, () => "Apply", (row) => legitimacy[row.n]);
  assert.equal(target?.company, "Fixture Clean Apply");
  assert.equal(
    pickApplyNext([rows[0]], scoreOf, () => "Apply", (row) => legitimacy[row.n]),
    null,
  );
});

test("an Applied row is not Apply next", () => {
  const rows = [
    { ...queued("1", "4.9/5", "Fixture Already"), status: "Applied" },
    queued("2", "4.0/5", "Fixture Apply Co"),
  ];
  assert.equal(pickApplyNext(rows, scoreOf, () => "Apply")?.company, "Fixture Apply Co");
});

test("without legitimacy, grouping is by score alone", () => {
  assert.deepEqual(
    groupAwaiting([row("2026-08-01", "4.5/5")]).map(([label]) => label),
    ["Recommended"],
  );
});
