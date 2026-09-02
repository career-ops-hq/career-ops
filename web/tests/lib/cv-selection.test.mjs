import assert from "node:assert/strict";
import { test } from "node:test";

import { pdfIndexEntryForReport, pdfPathForReport, reportNumberFromCell } from "../../src/lib/apply/cv-selection.mjs";

test("reportNumberFromCell only accepts markdown report links", () => {
  assert.equal(reportNumberFromCell("[010]"), null);
  assert.equal(reportNumberFromCell("see 009 before [010](../reports/010-acme.md)"), 10);
});

test("pdfIndexEntryForReport distinguishes missing rows from matched empty paths", () => {
  const index = [
    "010\t",
    "011\toutput/cv-011-acme.pdf",
  ].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: true, path: null });
  assert.deepEqual(pdfIndexEntryForReport(index, 12), { found: false, path: null });
  assert.equal(pdfPathForReport(index, 11), "output/cv-011-acme.pdf");
});

test("pdfIndexEntryForReport requires a complete numeric report field", () => {
  const index = [
    "010-stale\toutput/wrong.pdf",
    "010\toutput/right.pdf",
  ].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: true, path: "output/right.pdf" });
});
