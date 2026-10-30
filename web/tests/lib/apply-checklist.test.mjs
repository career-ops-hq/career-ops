import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatApplicationAnswersSection, parseApplicationAnswersSection } from "../../../application-answers.mjs";
import {
  PORTAL_TIPS,
  answerCopyItems,
  cvCopyFields,
  indexedPdf,
  reportNumberFor,
} from "../../src/lib/apply-checklist.mjs";

const CV = `# Jane Example

## Work Experience

### Example Studio -- Remote
**Analyst**
2020-2024

- Kept a weekly status note for the example program.

### Northwind -- Chicago
**Coordinator**
2018-2020

- Scheduled the example review.

## Education

Example University, BA, 2018
`;

test("cvCopyFields returns plain work and education blocks for Jane Example", () => {
  const fields = cvCopyFields(CV);
  assert.equal(fields.work.length, 2);
  assert.match(fields.work[0].text, /Example Studio -- Remote/);
  assert.match(fields.work[0].text, /Kept a weekly status note/);
  assert.equal(fields.work[0].text.includes("**"), false);
  assert.match(fields.work[1].text, /Northwind/);
  assert.match(fields.education, /Example University/);
  assert.equal(fields.education.includes("##"), false);
});

test("cvCopyFields is empty when the sections are missing", () => {
  assert.deepEqual(cvCopyFields("# Jane Example\n\n## Skills\n\nWriting\n"), { work: [], education: "" });
});

test("answerCopyItems follows the application-answers format and skips empty values", () => {
  const section = formatApplicationAnswersSection({
    date: "2026-02-01",
    state: "filled",
    freeText: [{ question: "Why Example?", answer: "I keep the weekly note." }],
    selections: [{ question: "Work auth", selection: "Authorized" }],
    fieldValues: [{ question: "City", answer: "" }],
    files: [{ field: "Resume", path: "output/cv-jane-example.pdf" }],
  });
  const items = answerCopyItems(parseApplicationAnswersSection(section));
  assert.deepEqual(items, [
    { label: "Why Example?", text: "I keep the weekly note." },
    { label: "Work auth", text: "Authorized" },
    { label: "Resume", text: "output/cv-jane-example.pdf" },
  ]);
  assert.equal(answerCopyItems(null).length, 0);
});

test("reportNumberFor uses the report cell, then the filename, and never the tracker id when a row exists", () => {
  assert.equal(reportNumberFor("3", { report: "[012](reports/012-example.md)" }, "099-other.md"), 12);
  assert.equal(reportNumberFor("3", { report: "—" }, "008-example.md"), 8);
  assert.equal(reportNumberFor("3", { report: "—" }, null), null);
  assert.equal(reportNumberFor("4", null, null), 4);
});

test("indexedPdf returns a workspace-relative path only when the file is under output/", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apply-checklist-"));
  const output = path.join(root, "output");
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, "cv-jane-example.pdf"), "%PDF-1.4\n");
  const index = [
    "12\toutput/cv-jane-example.pdf\toutput/cv-jane-example.html\tpdf\t2026-02-01\t",
    "12\toutput/cover-jane-example.pdf\t\t\t2026-02-01\tcover",
    "12\t../secret.pdf\t\t\t2026-02-01\t",
  ].join("\n");
  const exists = (abs) => fs.existsSync(abs);
  const resume = indexedPdf(index, 12, "cv", root, exists);
  assert.equal(resume.relativePath, "output/cv-jane-example.pdf");
  assert.equal(resume.relativePath.includes(os.homedir()), false);
  assert.equal(indexedPdf(index, 12, "cover", root, exists), null);
  fs.writeFileSync(path.join(output, "cover-jane-example.pdf"), "%PDF-1.4\n");
  assert.equal(indexedPdf(index, 12, "cover", root, exists).relativePath, "output/cover-jane-example.pdf");
  const outside = "12\t../secret.pdf\t\t\t2026-02-01\n";
  assert.equal(indexedPdf(outside, 12, "cv", root, exists), null);
  assert.equal(indexedPdf(index, 12, "cv", root, () => false), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("portal tips name the five boards and tell iCIMS to create an account first", () => {
  assert.deepEqual(PORTAL_TIPS.map((tip) => tip.portal), ["Workday", "iCIMS", "Greenhouse", "Lever", "Ashby"]);
  const icims = PORTAL_TIPS.find((tip) => tip.portal === "iCIMS");
  assert.match(icims.tip, /Create an account first/);
});
