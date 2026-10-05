import assert from "node:assert/strict";
import { test } from "node:test";

import { pdfIndexEntryForReport, pdfPathForReport, reportNumberFromCell } from "../../src/lib/apply/cv-selection.mjs";

test("reportNumberFromCell only accepts markdown report links", () => {
  assert.equal(reportNumberFromCell("[010]"), null);
  assert.equal(reportNumberFromCell("see 009 before [010](../reports/010-acme.md)"), 10);
  assert.equal(reportNumberFromCell(""), null);
  // A bare filename with no link markers at all — no report to resolve, must
  // not guess from the number in the path.
  assert.equal(reportNumberFromCell("reports/123-role.md"), null);
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

test("pdfPathForReport selects the exact report from a real pdf-index.tsv row shape", () => {
  const index = [
    "# report\tpdf\thtml\tformat\tdate",
    "010\toutput/cv-company-old-role.pdf\t\thtml\t2026-08-01",
    "011\toutput/cv-company-new-role.pdf\t\thtml\t2026-08-07",
  ].join("\n");
  assert.equal(pdfPathForReport(index, 10), "output/cv-company-old-role.pdf");
  assert.equal(pdfPathForReport(index, 11), "output/cv-company-new-role.pdf");
});

// #3959 gave pdf-index.tsv a `kind` column so a report's CV and its cover
// letter coexist as separate rows. This resolver predates that and returned
// whichever row came first, so a report whose cover was rendered before its CV
// resolved to the cover. The caller attaches the result to a real application,
// and reportNumberFromCell above says why that matters: a wrong document
// attached silently is worse than none found.
test("pdfIndexEntryForReport returns the CV even when a cover row precedes it", () => {
  const index = [
    "# report\tpdf\thtml\tformat\tdate\tkind",
    "010\toutput/cover-010-acme.pdf\t\thtml\t2026-08-01\tcover",
    "010\toutput/cv-010-acme.pdf\t\thtml\t2026-08-01\tcv",
  ].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: true, path: "output/cv-010-acme.pdf" });
});

// A row written before the column existed carries no kind. It is a CV: the
// manifest only ever held CVs then, and treating it as unknown would strand
// every artifact generated before #3959.
test("pdfIndexEntryForReport treats a legacy row with no kind as the CV", () => {
  const index = ["010\toutput/cv-010-acme.pdf\t\thtml\t2026-08-01"].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: true, path: "output/cv-010-acme.pdf" });
});

// A report with only a cover row has no CV. Reporting found:true with the cover
// path is the exact substitution this whole test group exists to stop.
test("pdfIndexEntryForReport reports no CV when the report has only a cover row", () => {
  const index = [
    "# report\tpdf\thtml\tformat\tdate\tkind",
    "010\toutput/cover-010-acme.pdf\t\thtml\t2026-08-01\tcover",
  ].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: false, path: null });
});

test("pdfIndexEntryForReport can be asked for the cover instead", () => {
  const index = [
    "# report\tpdf\thtml\tformat\tdate\tkind",
    "010\toutput/cv-010-acme.pdf\t\thtml\t2026-08-01\tcv",
    "010\toutput/cover-010-acme.pdf\t\thtml\t2026-08-01\tcover",
  ].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10, "cover"), { found: true, path: "output/cover-010-acme.pdf" });
});
