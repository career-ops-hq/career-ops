import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfPathForReport, reportNumberFromCell } from "../../src/lib/apply/cv-selection.mjs";

test("report number is extracted from tracker report links", () => {
  assert.equal(reportNumberFromCell("[010](reports/010-old-role.md)"), 10);
  assert.equal(reportNumberFromCell(""), null);
});

test("report number is anchored on the markdown-link form, not the first digit anywhere", () => {
  // A bare filename with no link markers — no report to resolve, must not
  // guess from the number in the path.
  assert.equal(reportNumberFromCell("reports/123-role.md"), null);
  // A leading number in prose before the real link (a note, a date) must
  // never be mistaken for the report id — this is exactly the case that
  // fed the wrong CV to an application under the old "first digit run"
  // regex.
  assert.equal(reportNumberFromCell("re-evaluated 2026-08-05, see [041](reports/041-acme-2026-08-05.md)"), 41);
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
