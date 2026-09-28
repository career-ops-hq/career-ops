// Tests for the shared `{n}-RESERVED.md` predicate. Imports report-files.mjs
// directly — it is THE definition for web/, consumed by both career-ops.ts
// (report lookup) and run-cli-support.mjs (the persistence gate), so a change
// here moves both consumers at once. That is the point: the two used to carry
// separate copies that already disagreed.
//
// Run:  node --test tests/lib/report-files.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { isReservedReportFile } from "../../src/lib/report-files.mjs";

test("a numbered sentinel is reserved", () => {
  // Given: what reserve-report-num.mjs actually writes to claim a number.
  assert.equal(isReservedReportFile("041-RESERVED.md"), true);
  assert.equal(isReservedReportFile("7-RESERVED.md"), true);
});

test("a real report is never reserved", () => {
  assert.equal(isReservedReportFile("027-cd-invest-2026-08-11.md"), false);
});

test("only a NUMBERED sentinel counts — the case the two old copies disagreed on", () => {
  // Given: nothing produces this today, but the predicates differed on it, which
  // is exactly the drift one definition exists to prevent.
  assert.equal(isReservedReportFile("notes-RESERVED.md"), false);
  assert.equal(isReservedReportFile("RESERVED.md"), false);
});

test("the match is anchored, so a lookalike name is not reserved", () => {
  assert.equal(isReservedReportFile("041-RESERVED.md.bak"), false);
  assert.equal(isReservedReportFile("041-RESERVED-notes.md"), false);
  assert.equal(isReservedReportFile("x041-RESERVED.md"), false);
});

test("only the basename is examined, so a full path works", () => {
  // Given: career-ops.ts passes a resolved path, run-cli-support.mjs a bare name.
  assert.equal(isReservedReportFile("/root/reports/041-RESERVED.md"), true);
  assert.equal(isReservedReportFile("/root/reports/027-acme-2026-08-11.md"), false);
});
