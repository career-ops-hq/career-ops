import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePdfManifestRows, pdfIndexEntriesByReport, pdfIndexEntryForReport, pdfPathForReport, readyReportNumbers, reportNumberFromCell } from "../../src/lib/apply/cv-selection.mjs";

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

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: true, path: null, html: null });
  assert.deepEqual(pdfIndexEntryForReport(index, 12), { found: false, path: null, html: null });
  assert.equal(pdfPathForReport(index, 11), "output/cv-011-acme.pdf");
});

test("pdfIndexEntryForReport requires a complete numeric report field", () => {
  const index = [
    "010-stale\toutput/wrong.pdf",
    "010\toutput/right.pdf",
  ].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: true, path: "output/right.pdf", html: null });
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

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: true, path: "output/cv-010-acme.pdf", html: null });
});

// A row written before the column existed carries no kind. It is a CV: the
// manifest only ever held CVs then, and treating it as unknown would strand
// every artifact generated before #3959.
test("pdfIndexEntryForReport treats a legacy row with no kind as the CV", () => {
  const index = ["010\toutput/cv-010-acme.pdf\t\thtml\t2026-08-01"].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: true, path: "output/cv-010-acme.pdf", html: null });
});

test("an untagged cover filename is a cover, and a declared cv still wins", () => {
  const untagged = ["010\toutput/cover-010-acme.pdf\t\thtml\t2026-08-01"].join("\n");
  assert.deepEqual(pdfIndexEntryForReport(untagged, 10), { found: false, path: null, html: null });
  assert.deepEqual(pdfIndexEntryForReport(untagged, 10, "cover"), { found: true, path: "output/cover-010-acme.pdf", html: null });

  const suffix = ["010\toutput/acme-role-cover.pdf\t\tletter\t2026-08-01"].join("\n");
  assert.deepEqual(pdfIndexEntryForReport(suffix, 10), { found: false, path: null, html: null });

  const mid = ["010\toutput/discover-weekly-brief.pdf\t\tletter\t2026-08-01"].join("\n");
  assert.equal(pdfPathForReport(mid, 10), "output/discover-weekly-brief.pdf");

  const prefixed = ["010\toutput/cv-covered-bridge.pdf\t\tletter\t2026-08-01"].join("\n");
  assert.equal(pdfPathForReport(prefixed, 10), "output/cv-covered-bridge.pdf");

  const declared = ["010\toutput/cover-010-acme.pdf\t\thtml\t2026-08-01\tcv"].join("\n");
  assert.equal(pdfPathForReport(declared, 10), "output/cover-010-acme.pdf");
});

// A report with only a cover row has no CV. Reporting found:true with the cover
// path is the exact substitution this whole test group exists to stop.
test("pdfIndexEntryForReport reports no CV when the report has only a cover row", () => {
  const index = [
    "# report\tpdf\thtml\tformat\tdate\tkind",
    "010\toutput/cover-010-acme.pdf\t\thtml\t2026-08-01\tcover",
  ].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: false, path: null, html: null });
});

test("pdfIndexEntryForReport can be asked for the cover instead", () => {
  const index = [
    "# report\tpdf\thtml\tformat\tdate\tkind",
    "010\toutput/cv-010-acme.pdf\t\thtml\t2026-08-01\tcv",
    "010\toutput/cover-010-acme.pdf\t\thtml\t2026-08-01\tcover",
  ].join("\n");

  assert.deepEqual(pdfIndexEntryForReport(index, 10, "cover"), { found: true, path: "output/cover-010-acme.pdf", html: null });
});

test("parsePdfManifestRows extracts structured entries and defaults missing kind to cv", () => {
  const index = [
    "# report\tpdf\thtml\tformat\tdate\tkind",
    "010\toutput/cv-010.pdf\toutput/cv-010.html\tletter\t2026-08-01\tcv",
    "011\toutput/cover-011.pdf\t\ta4\t2026-08-02\tcover",
    "012\toutput/legacy-012.pdf\t\tletter\t2026-08-03", // missing kind column
    "013\toutput/blank-kind.pdf\t\tletter\t2026-08-04\t  ", // whitespace-only kind
    "014\toutput/other.pdf\t\tletter\t2026-08-05\tportfolio", // unknown kind
  ].join("\n");

  const rows = parsePdfManifestRows(index);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], {
    reportId: "010",
    pdf: "output/cv-010.pdf",
    html: "output/cv-010.html",
    format: "letter",
    date: "2026-08-01",
    kind: "cv",
  });
  assert.deepEqual(rows[1], {
    reportId: "011",
    pdf: "output/cover-011.pdf",
    html: "",
    format: "a4",
    date: "2026-08-02",
    kind: "cover",
  });
  assert.equal(rows[2].kind, "cv");
  assert.equal(rows[3].kind, "cv");
  assert.equal(rows[4].kind, "unknown");
});

// The Pipeline list asks for every tracker row's CV at once, so the whole
// manifest is read into one map. Per kind: the first row of that kind wins, an
// empty path stays null, an untagged row named as a cover letter is a cover,
// and partial ids and unknown kinds are left out.
const MIXED_INDEX = [
  "# report\tpdf\thtml\tformat\tdate\tkind",
  "010\toutput/cover-010-acme.pdf\t\thtml\t2026-08-01\tcover",
  "010\toutput/cv-010-acme.pdf\toutput/cv-010-acme.html\thtml\t2026-08-01\tcv",
  "010\toutput/cv-010-acme-v2.pdf\t\thtml\t2026-08-02\tcv",
  "011\t",
  "012-stale\toutput/wrong.pdf",
  "013\toutput/cover-013-acme.pdf",
  "014\toutput/thing.pdf\t\t\t\tportfolio",
].join("\n");

test("pdfIndexEntriesByReport maps each report to its first row of the wanted kind", () => {
  const index = MIXED_INDEX;
  assert.deepEqual(Object.fromEntries(pdfIndexEntriesByReport(index)), {
    10: { path: "output/cv-010-acme.pdf", html: "output/cv-010-acme.html" },
    11: { path: null, html: null },
  });
  assert.deepEqual(Object.fromEntries(pdfIndexEntriesByReport(index, "cover")), {
    10: { path: "output/cover-010-acme.pdf", html: null },
    13: { path: "output/cover-013-acme.pdf", html: null },
  });
  assert.deepEqual(pdfIndexEntryForReport(index, 10), { found: true, path: "output/cv-010-acme.pdf", html: "output/cv-010-acme.html" });
  assert.deepEqual(pdfIndexEntryForReport(index, 13), { found: false, path: null, html: null });
});

// #6974: the viewer asks pdfIndexEntryForReport about one report, the Pipeline
// list reads the whole map. They must never disagree on which file is a CV.
test("pdfIndexEntryForReport answers every report as the one-pass map does, for both kinds", () => {
  for (const kind of ["cv", "cover"]) {
    const entries = pdfIndexEntriesByReport(MIXED_INDEX, kind);
    for (const n of [10, 11, 12, 13, 14, 15]) {
      const entry = entries.get(n);
      assert.deepEqual(
        pdfIndexEntryForReport(MIXED_INDEX, n, kind),
        entry ? { found: true, ...entry } : { found: false, path: null, html: null },
        `${kind} report ${n}`,
      );
    }
  }
});

// The Pipeline marks a row as having a CV only through this rule (#6974).
test("readyReportNumbers keeps a requested report only when its path passes containment, and checks nothing else", () => {
  const entries = new Map([
    [1, { path: "output/cv-1.pdf", html: null }],
    [2, { path: "output/cv-2.pdf", html: null }],
    [3, { path: null, html: null }],
    [4, { path: "reports/escaped.pdf", html: null }],
  ]);
  const checked = [];
  const isContained = (p) => {
    checked.push(p);
    return p.startsWith("output/");
  };

  // 2 is indexed but not requested, 3 has no path, 4 fails containment, 5 is not indexed.
  assert.deepEqual([...readyReportNumbers(entries, new Set([1, 3, 4, 5]), isContained)], [1]);
  assert.deepEqual(checked, ["output/cv-1.pdf", "reports/escaped.pdf"]);

  checked.length = 0;
  assert.deepEqual([...readyReportNumbers(entries, new Set(), isContained)], []);
  assert.deepEqual(checked, []);
});
