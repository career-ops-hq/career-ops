import assert from "node:assert/strict";
import { test } from "node:test";
import { documentDisplayTitle, namesForReport, presentDocument } from "../../src/lib/document-title.mjs";

const FILENAME = "cv-jane-doe-010-acme-corp-2026-06-01.pdf";

test("a tailored CV names the company and the role, and keeps the filename", () => {
  const display = documentDisplayTitle({
    kind: "cv",
    company: "Acme Corp",
    role: "Data Analyst",
    filename: FILENAME,
  });
  assert.equal(display.title, "Tailored CV — Acme Corp, Data Analyst");
  assert.equal(display.filename, FILENAME);
});

test("a cover letter uses the same company and role", () => {
  const display = documentDisplayTitle({
    kind: "cover",
    company: "Acme Corp",
    role: "Data Analyst",
    filename: "cover-acme.pdf",
  });
  assert.equal(display.title, "Cover letter — Acme Corp, Data Analyst");
  assert.equal(display.filename, "cover-acme.pdf");
});

test("a file with no company or role still has a readable title, and the filename stays separate", () => {
  const display = documentDisplayTitle({ kind: "cv", filename: "cv-1.pdf" });
  assert.equal(display.title, "Tailored CV");
  assert.equal(display.filename, "cv-1.pdf");
  assert.equal(display.title.includes("cv-1.pdf"), false);
});

test("the title comes from the report the file belongs to, not from another row with the same number", () => {
  const applications = [
    { n: "10", company: "Other Co", role: "Other Role", report: "[99](../reports/099-other.md)" },
    { n: "29", company: "Acme Corp", role: "Data Analyst", report: "[010](../reports/010-acme.md)" },
  ];
  const names = namesForReport(applications, "10");
  assert.deepEqual(names, { company: "Acme Corp", role: "Data Analyst" });
  const presented = presentDocument({ kind: "cv", filename: FILENAME, reportId: "010" }, applications);
  assert.equal(presented.title, "Tailored CV — Acme Corp, Data Analyst");
  assert.equal(presented.filename, FILENAME);
});

test("a row number is used only when that row has no report link", () => {
  const applications = [
    { n: "10", company: "Northwind", role: "Analyst", report: "" },
  ];
  assert.deepEqual(namesForReport(applications, "10"), { company: "Northwind", role: "Analyst" });
});

test("a display label that is a different number does not steal another report's company and role", () => {
  const applications = [
    { n: "1", company: "Globex", role: "Engineer", report: "[5](../reports/006-globex.md)" },
    { n: "5", company: "Initech", role: "Analyst", report: "" },
  ];
  assert.deepEqual(namesForReport(applications, "5"), { company: "Initech", role: "Analyst" });
  assert.deepEqual(namesForReport(applications, "6"), { company: "Globex", role: "Engineer" });
  const presented = presentDocument(
    { kind: "cv", filename: "cv-globex.pdf", reportId: "5" },
    applications,
  );
  assert.equal(presented.title, "Tailored CV — Initech, Analyst");
  assert.equal(presented.company, "Initech");
  assert.equal(presented.role, "Analyst");
});
