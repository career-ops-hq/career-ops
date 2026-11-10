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
  pasteCopyFields,
  reportNumberFor,
  tailoredResumeText,
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

const MASTER_CV = `# Jane Example

## Work Experience

### Northwind -- Chicago
**Coordinator**
2018-2020

- Scheduled the example review.

## Education

Example University, BA, 2018
`;

const TAILORED_HTML = `<div class="section">
  <div class="section-title">Work Experience</div>
  <div class="job">
    <div class="job-header">
      <span class="job-company">Example Studio</span>
      <span class="job-period">2020-2024</span>
    </div>
    <div class="job-role">Analyst</div>
    <ul><li>Kept a weekly status note for the example program.</li></ul>
  </div>
</div>
<div class="section">
  <div class="section-title">Education</div>
  <div class="edu-item">
    <div class="edu-title">BA <span class="edu-org">State College</span></div>
    <div class="edu-year">2016</div>
  </div>
</div>`;

test("paste blocks copy the tailored resume, not the master CV", () => {
  const fields = pasteCopyFields(TAILORED_HTML, MASTER_CV);
  assert.equal(fields.work.length, 1);
  assert.match(fields.work[0].text, /Example Studio/);
  assert.match(fields.work[0].text, /Analyst/);
  assert.match(fields.work[0].text, /2020-2024/);
  assert.match(fields.work[0].text, /Kept a weekly status note/);
  assert.equal(/Northwind/.test(fields.work[0].text), false);
  assert.match(fields.education, /State College/);
  assert.equal(/Example University/.test(fields.education), false);
});

test("a section the tailored resume omits falls back to cv.md, and the other section does not", () => {
  const html = `<div class="section"><div class="section-title">Work Experience</div>
    <div class="job"><span class="job-company">Example Studio</span><div class="job-role">Analyst</div></div>
  </div>`;
  const fields = pasteCopyFields(html, MASTER_CV);
  assert.match(fields.work[0].text, /Example Studio/);
  assert.equal(/Northwind/.test(JSON.stringify(fields.work)), false);
  assert.match(fields.education, /Example University/);
});

test("an empty tailored section does not also show the master CV", () => {
  const html = `<div class="section"><div class="section-title">Work Experience</div></div>
    <div class="section"><div class="section-title">Education</div></div>`;
  const fields = pasteCopyFields(html, MASTER_CV);
  assert.deepEqual(fields.work, []);
  assert.equal(fields.education, "");
  assert.equal(fields.workEmpty, "No work history in this resume.");
  assert.equal(fields.educationEmpty, "No education section in this resume.");
});

test("the apply page pastes from the tailored HTML of the indexed resume, not cvCopyFields(cv.md)", () => {
  const page = fs.readFileSync(new URL("../../src/app/pipeline/[id]/apply/page.tsx", import.meta.url), "utf8");
  const checklist = fs.readFileSync(new URL("../../src/components/apply-checklist.tsx", import.meta.url), "utf8");
  assert.match(page, /pasteCopyFields\(/);
  assert.match(page, /tailoredResumeText\(/);
  assert.doesNotMatch(page, /cvCopyFields\(/);
  assert.match(checklist, /workEmpty/);
  assert.doesNotMatch(checklist, /No work history in cv\.md\./);
});

test("the indexed resume PDF stays the resume row, and its HTML is the paste source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apply-paste-"));
  const secret = path.join(path.dirname(root), "apply-paste-secret.html");
  try {
    const output = path.join(root, "output");
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, "cv-jane-example.pdf"), "%PDF-1.4\n");
    fs.writeFileSync(path.join(output, "cv-jane-example.html"), TAILORED_HTML);
    fs.writeFileSync(path.join(output, "other.html"), "<div class=\"section-title\">Work Experience</div><p>Other Employer</p>");
    const index = "12\toutput/cv-jane-example.pdf\toutput/cv-jane-example.html\tpdf\t2026-02-01\t\n12\toutput/other.pdf\toutput/other.html\tpdf\t2026-02-01\t\n";
    const exists = (abs) => fs.existsSync(abs);
    const resume = indexedPdf(index, 12, "cv", root, exists);
    assert.equal(resume.relativePath, "output/cv-jane-example.pdf");
    const html = tailoredResumeText(index, resume.relativePath, root, (abs) => fs.readFileSync(abs, "utf8"));
    const fields = pasteCopyFields(html, MASTER_CV);
    assert.match(fields.work[0].text, /Example Studio/);
    assert.equal(/Northwind|Other Employer/.test(fields.work[0].text), false);
    fs.mkdirSync(path.join(root, "notes"));
    fs.writeFileSync(path.join(root, "notes", "secret.html"), "<div class=\"section-title\">Work Experience</div><p>Outside Employer</p>");
    fs.writeFileSync(path.join(output, "cover-only.pdf"), "%PDF-1.4\n");
    const outside = "12\toutput/cover-only.pdf\tnotes/secret.html\tpdf\t2026-02-01\n";
    assert.equal(tailoredResumeText(outside, "output/cover-only.pdf", root, (abs) => fs.readFileSync(abs, "utf8")), null);
    const dotCache = path.join(output, "..cache");
    fs.mkdirSync(dotCache);
    fs.writeFileSync(path.join(dotCache, "note.html"), "<div class=\"section-title\">Work Experience</div><p>Dot Cache Employer</p>");
    const dotted = "12\toutput/cover-only.pdf\toutput/..cache/note.html\tpdf\t2026-02-01\n";
    assert.match(tailoredResumeText(dotted, "output/cover-only.pdf", root, (abs) => fs.readFileSync(abs, "utf8")), /Dot Cache Employer/);
    fs.writeFileSync(secret, "<div class=\"section-title\">Work Experience</div><p>Linked Employer</p>");
    fs.symlinkSync(secret, path.join(output, "linked.html"));
    const linked = "12\toutput/cover-only.pdf\toutput/linked.html\tpdf\t2026-02-01\n";
    assert.equal(tailoredResumeText(linked, "output/cover-only.pdf", root, (abs) => fs.readFileSync(abs, "utf8")), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(secret, { force: true });
  }
});

test("inline formatting stays on one line, and a span still separates the header", () => {
  const html = `<div class="section-title">Work Experience</div>
    <div class="job">
      <span class="job-company">Example Studio</span><span class="job-period">2020-2024</span>
      <ul><li>Led <strong>5</strong> engineers</li></ul>
    </div>
    <div class="section-title">Education</div>
    <div>BA <span class="edu-org">State College</span></div>`;
  const fields = pasteCopyFields(html, MASTER_CV);
  assert.match(fields.work[0].text, /Led 5 engineers/);
  assert.equal(fields.work[0].text.includes("Led\n5"), false);
  assert.match(fields.work[0].text, /Example Studio\n+2020-2024/);
  assert.match(fields.education, /BA\nState College/);
});

test("character references decode once, including typographic marks", () => {
  const html = `<div class="section-title">Work Experience</div><div class="job"><span class="job-company">R&amp;lt;D &ndash; Lab</span></div>`;
  const text = pasteCopyFields(html, MASTER_CV).work[0].text;
  assert.match(text, /R&lt;D \u2013 Lab/);
  assert.equal(text.includes("R<D"), false);
});

test("a script end tag with a space does not leave the script body in the paste text", () => {
  const html = `<div class="section-title">Work Experience</div><div class="job"><span class="job-company">Example <script>alert(1)</script > Studio</span></div>`;
  const text = pasteCopyFields(html, MASTER_CV).work[0].text;
  assert.equal(text.includes("alert"), false);
  assert.match(text, /Example/);
  assert.match(text, /Studio/);
});

test("a script end tag with junk before the bracket does not leave the script body", () => {
  const html = `<div class="section-title">Work Experience</div><div class="job"><span class="job-company">Example <script>alert(1)</script\t\n bar> Studio</span></div>`;
  const text = pasteCopyFields(html, MASTER_CV).work[0].text;
  assert.equal(text.includes("alert"), false);
  assert.equal(text.includes("<script"), false);
  assert.match(text, /Example/);
  assert.match(text, /Studio/);
});

test("a style body and a comment stay out of the paste text", () => {
  const html = `<div class="section-title">Work Experience</div><div class="job"><span class="job-company">Example <style>secret-style</style > Studio <!-- secret-note --> Lab</span></div>`;
  const text = pasteCopyFields(html, MASTER_CV).work[0].text;
  assert.equal(text.includes("secret-style"), false);
  assert.equal(text.includes("secret-note"), false);
  assert.match(text, /Example/);
  assert.match(text, /Studio/);
  assert.match(text, /Lab/);
});

test("a broken character reference does not drop the tailored role", () => {
  const html = `<div class="section-title">Work Experience</div><div class="job"><span class="job-company">Example Studio&#999999999;</span></div>`;
  const fields = pasteCopyFields(html, MASTER_CV);
  assert.match(fields.work[0].text, /Example Studio/);
  assert.equal(/Northwind/.test(fields.work[0].text), false);
});

test("two tailored roles stay two paste blocks, in the resume's order", () => {
  const html = `<h2>Work Experience</h2>
    <div class="job"><span class="job-company">R&amp;D Lab</span><div class="job-role">Analyst</div></div>
    <div class="job"><span class="job-company">Example Studio</span><div class="job-role">Coordinator</div></div>
    <h2>Projects</h2><p>Side project</p>`;
  const fields = pasteCopyFields(html, MASTER_CV);
  assert.equal(fields.work.length, 2);
  assert.match(fields.work[0].text, /R&D Lab/);
  assert.equal(fields.work[0].text.includes("&amp;"), false);
  assert.ok(fields.work[0].text.indexOf("R&D Lab") < fields.work[0].text.indexOf("Analyst"));
  assert.match(fields.work[1].text, /Example Studio/);
  assert.equal(/Northwind|Side project/.test(fields.work.map((item) => item.text).join("\n")), false);
  assert.match(fields.education, /Example University/);
});

test("with no tailored HTML, paste blocks stay on cv.md", () => {
  const fields = pasteCopyFields(null, MASTER_CV);
  assert.match(fields.work[0].text, /Northwind/);
  assert.match(fields.education, /Example University/);
  const gone = pasteCopyFields(null, null);
  assert.deepEqual(gone.work, []);
  assert.equal(gone.education, "");
  assert.equal(gone.workEmpty, "cv.md is not in this workspace.");
  assert.equal(gone.educationEmpty, "cv.md is not in this workspace.");
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
  assert.equal(reportNumberFor("3", { report: "[report](../reports/008-acme.md)" }, "008-acme.md"), 8);
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

test("portal tips name the boards and tell iCIMS to create an account first", () => {
  assert.deepEqual(PORTAL_TIPS.map((tip) => tip.portal), ["Workday", "iCIMS", "UKG", "Greenhouse", "Lever", "Ashby"]);
  const icims = PORTAL_TIPS.find((tip) => tip.portal === "iCIMS");
  assert.match(icims.tip, /Create an account first/);
});
