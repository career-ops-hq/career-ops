// The application date shown beside the evaluation date in the tracker table
// (#3759, #7853). Every case runs the adapter against the real core module,
// followup-cadence.mjs, because the point of the adapter is that it adds no
// rules of its own: the cases below are the ones the #3759 review measured
// against a web-side copy of those rules.

import assert from "node:assert/strict";
import test from "node:test";
import * as core from "../../../followup-cadence.mjs";
import { appliedDatesByRow } from "../../src/lib/application-dates.mjs";

const HEADER = "# tracker#\tdate\tfrom\tto\tsource\tnote";
const ledger = (...lines) => [HEADER, ...lines].join("\n");
const row = (n, notes = "") => ({ n, date: "2026-09-01", notes });
const datesFor = (apps, log) => Object.fromEntries(appliedDatesByRow(apps, log, core));

test("the application date comes from the move to Applied in the status log", () => {
  const log = ledger(
    "40\t2026-09-01\t-\tEvaluated\tset-status\t",
    "40\t2026-09-02\tEvaluated\tApplied\tset-status\t",
    "40\t2026-09-03\tApplied\tResponded\tset-status\t",
  );
  assert.deepEqual(datesFor([row("40")], log), { 40: "2026-09-02" });
});

test("a state alias for Applied counts as Applied", () => {
  // templates/states.yml lists `sent` among Applied's aliases.
  const log = ledger("41\t2026-09-05\tEvaluated\tsent\tset-status\t");
  assert.deepEqual(datesFor([row("41")], log), { 41: "2026-09-05" });
});

test("a later correction replaces the date, and a retraction removes it", () => {
  const log = ledger(
    "43\t2026-09-02\tEvaluated\tApplied\tset-status\t",
    "43\t2026-08-15\tEvaluated\tApplied\tcorrection\t",
    "44\t2026-09-02\tEvaluated\tApplied\tset-status\t",
    "44\t2026-09-03\tApplied\t-\tset-status\t",
  );
  assert.deepEqual(datesFor([row("43"), row("44")], log), { 43: "2026-08-15", 44: "" });
});

test("a ledger line with too few columns is skipped, not thrown on", () => {
  const log = ledger("42\t2026-09-02\tEvaluated", "45\t2026-09-04\tEvaluated\tApplied\tset-status\t");
  assert.deepEqual(datesFor([row("42"), row("45")], log), { 42: "", 45: "2026-09-04" });
});

test("an applied note is read, but not a date the note cites about another row", () => {
  const apps = [
    row("46", "Applied 2026-08-27 by hand"),
    row("47", "#154 Sr PM M&A is already live in the same ATS (applied 2026-08-04)"),
  ];
  assert.deepEqual(datesFor(apps, null), { 46: "2026-08-27", 47: "" });
});

test("a row with no application never shows its evaluation date", () => {
  // The core falls back to the evaluation date for follow-up cadence; this
  // column leaves the cell empty instead.
  assert.deepEqual(datesFor([row("48", "Evaluation complete")], ""), { 48: "" });
});

test("impossible calendar dates are ignored in the log and in notes", () => {
  const log = ledger("49\t2026-02-31\tEvaluated\tApplied\tset-status\t");
  assert.deepEqual(datesFor([row("49", "Applied 2026-13-01")], log), { 49: "" });
});

test("a row number the ledger cannot key on resolves from notes alone", () => {
  const log = ledger("50\t2026-09-02\tEvaluated\tApplied\tset-status\t");
  assert.deepEqual(datesFor([row("—", "applied 2026-09-09")], log), { "—": "2026-09-09" });
});
