import { test } from "node:test";
import assert from "node:assert/strict";
import { trackerCsv, trackerCsvFilename } from "../../src/lib/tracker-csv.mjs";

const row = (fields) => ({
  n: "1", date: "2026-09-01", company: "Acme", via: "", role: "Analytics Engineer", location: "",
  score: "4.6/5", status: "Applied", pdf: "✅", report: "[1](reports/001-acme-2026-09-01.md)",
  applyLink: "", followUp: "", notes: "", url: "", ...fields,
});

const BOM = "\uFEFF";

test("trackerCsv writes the rows in the order given, ready for a spreadsheet", () => {
  const csv = trackerCsv([
    row({ n: "7", company: "Acme, Inc.", notes: 'recruiter said "soon"' }),
    row({ n: "5", score: "4,5/5 (solid fit)", report: "reports/005-acme-2026-09-05.md" }),
    row({ n: "4", score: "N/A (2026-09-01)", status: "Discarded" }),
    row({ n: "3", company: "Globex", score: "N/A", status: "SKIP", pdf: "❌", report: "—", notes: '=HYPERLINK("https://jobs.example/3")' }),
  ]);
  assert.equal(csv, BOM + [
    "id,date,company,role,score,status,pdf,report,notes",
    '7,2026-09-01,"Acme, Inc.",Analytics Engineer,4.6,Applied,yes,reports/001-acme-2026-09-01.md,"recruiter said ""soon"""',
    "5,2026-09-01,Acme,Analytics Engineer,4.5,Applied,yes,reports/005-acme-2026-09-05.md,",
    "4,2026-09-01,Acme,Analytics Engineer,,Discarded,yes,reports/001-acme-2026-09-01.md,",
    `3,2026-09-01,Globex,Analytics Engineer,,SKIP,no,,"'=HYPERLINK(""https://jobs.example/3"")"`,
    "",
  ].join("\n"));
});

test("trackerCsv adds location, via and url only when the tracker has them", () => {
  const csv = trackerCsv([
    row({ location: "Denver, CO", url: "[posting](https://jobs.example/1)" }),
    row({ n: "2" }),
  ]);
  const [header, first, second] = csv.slice(1).split("\n");
  assert.equal(header, "id,date,company,role,score,status,location,url,pdf,report,notes");
  assert.equal(first, '1,2026-09-01,Acme,Analytics Engineer,4.6,Applied,"Denver, CO",https://jobs.example/1,yes,reports/001-acme-2026-09-01.md,');
  assert.equal(second, "2,2026-09-01,Acme,Analytics Engineer,4.6,Applied,,,yes,reports/001-acme-2026-09-01.md,");
});

test("trackerCsvFilename names the tab and the local day", () => {
  assert.equal(trackerCsvFilename("EVALUATED", new Date(2026, 9, 21, 23, 30)), "career-ops-evaluated-2026-10-21.csv");
});
