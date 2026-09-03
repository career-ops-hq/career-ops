import assert from "node:assert/strict";
import test from "node:test";
import {
  parseApplicationDatesFromStatusLog,
  resolveApplicationAppliedDate,
} from "../../src/lib/application-dates.mjs";

test("application date comes from the first transition into Applied", () => {
  const dates = parseApplicationDatesFromStatusLog([
    "# tracker#\tdate\tfrom\tto\tsource\tnote",
    "40\t2026-09-01\t-\tEvaluated\tmerge\t",
    "40\t2026-09-02\tEvaluated\tApplied\tset-status\t",
    "40\t2026-09-03\tApplied\tResponded\tset-status\t",
  ].join("\n"));

  assert.equal(resolveApplicationAppliedDate({ n: "40", notes: "" }, dates), "2026-09-02");
});

test("application date falls back to notes, never to evaluation date", () => {
  const noDates = new Map();
  assert.equal(
    resolveApplicationAppliedDate({ n: "1", date: "2026-08-20", notes: "Applied 2026-08-27 manually" }, noDates),
    "2026-08-27",
  );
  assert.equal(
    resolveApplicationAppliedDate({ n: "2", date: "2026-08-20", notes: "Evaluation complete" }, noDates),
    "",
  );
});

test("invalid ledger and note dates are ignored", () => {
  const dates = parseApplicationDatesFromStatusLog("7\t2026-02-31\tEvaluated\tApplied\tset-status\t");
  assert.equal(resolveApplicationAppliedDate({ n: "7", notes: "Applied 2026-13-01" }, dates), "");
});
