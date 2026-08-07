import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfPathForReport, reportNumberFromCell } from "../../src/lib/apply/cv-selection.mjs";

test("report number is extracted from tracker report links", () => {
  assert.equal(reportNumberFromCell("[010](reports/010-old-role.md)"), 10);
  assert.equal(reportNumberFromCell("reports/123-role.md"), 123);
  assert.equal(reportNumberFromCell(""), null);
});

test("PDF selection uses the exact report, not the newest row", () => {
  const index = [
    "# report\tpdf\thtml\tformat\tdate",
    "010\toutput/cv-company-old-role.pdf\t\thtml\t2026-08-01",
    "011\toutput/cv-company-new-role.pdf\t\thtml\t2026-08-07",
  ].join("\n");
  assert.equal(pdfPathForReport(index, 10), "output/cv-company-old-role.pdf");
  assert.equal(pdfPathForReport(index, 11), "output/cv-company-new-role.pdf");
});

test("PDF selection ignores malformed report-number prefixes", () => {
  const index = [
    "010-stale\toutput/cv-company-wrong-role.pdf",
    "010\toutput/cv-company-correct-role.pdf",
  ].join("\n");
  assert.equal(pdfPathForReport(index, 10), "output/cv-company-correct-role.pdf");
});
