import { test } from "node:test";
import assert from "node:assert/strict";
import { cvUploadName, fileWords, shortRole } from "../../src/lib/apply/upload-name.mjs";

test("name and role make First-Last-Role-CV.pdf", () => {
  assert.equal(cvUploadName({ fullName: "Jane Doe", role: "Analytics Engineer" }), "Jane-Doe-Analytics-Engineer-CV.pdf");
});

test("the role is cut at its first qualifier", () => {
  assert.equal(shortRole("Data Engineer, Data Quality & Provenance"), "Data Engineer");
  assert.equal(shortRole("Senior BI Developer (Remote)"), "Senior BI Developer");
  assert.equal(shortRole("Data Engineer - Talent Acquisition Operations"), "Data Engineer");
  assert.equal(shortRole("Data Engineer – Platform"), "Data Engineer");
});

test("a form title loses its company", () => {
  assert.equal(shortRole("Data Engineer, Data Quality & Provenance @ Acme"), "Data Engineer");
  assert.equal(shortRole("Data Analyst at Acme Corp"), "Data Analyst");
});

test("an all-caps surname is recased, acronyms stay, accents drop", () => {
  assert.equal(fileWords("Jane DOEMAN", { recaseCaps: true }), "Jane-Doeman");
  assert.equal(fileWords("Senior BI Developer"), "Senior-BI-Developer");
  assert.equal(fileWords("HRIS Analyst"), "HRIS-Analyst");
  assert.equal(fileWords("José Müller-Ibáñez"), "Jose-Muller-Ibanez");
});

test("missing parts are dropped, never left as empty dashes", () => {
  assert.equal(cvUploadName({ fullName: "Jane Doe", role: "" }), "Jane-Doe-CV.pdf");
  assert.equal(cvUploadName({ fullName: "", role: "Data Analyst" }), "Data-Analyst-CV.pdf");
  assert.equal(cvUploadName({}), "CV.pdf");
});

test("the name stays well under the 64-character portal limit for a long title (#5629)", () => {
  const name = cvUploadName({ fullName: "Jane Doe", role: "Senior Staff Analytics Engineer, Revenue & Billing Data Platform (Remote, EMEA)" });
  assert.equal(name, "Jane-Doe-Senior-Staff-Analytics-Engineer-CV.pdf");
  assert.ok(name.length <= 64);
});

test("a short all-caps surname is recased in the name, a role acronym is not", () => {
  assert.equal(cvUploadName({ fullName: "Jane DOE", role: "COBOL Developer" }), "Jane-Doe-COBOL-Developer-CV.pdf");
  assert.equal(fileWords("COBOL Developer"), "COBOL-Developer");
});

test("names in non-Latin scripts keep their letters", () => {
  assert.equal(cvUploadName({ fullName: "Иван ПЕТРОВ", role: "Data Engineer" }), "Иван-Петров-Data-Engineer-CV.pdf");
  assert.equal(cvUploadName({ fullName: "张伟", role: "Data Engineer" }), "张伟-Data-Engineer-CV.pdf");
  assert.equal(cvUploadName({ fullName: "김민준", role: "" }), "김민준-CV.pdf");
  assert.equal(cvUploadName({ fullName: "राहुल शर्मा", role: "" }), "राहुल-शर्मा-CV.pdf");
  assert.equal(cvUploadName({ fullName: "محمد علي", role: "" }), "محمد-علي-CV.pdf");
});

test("a mark that belongs to a non-Latin letter stays, a Latin accent goes", () => {
  assert.equal(cvUploadName({ fullName: "Йосиф Сергеевич", role: "" }), "Йосиф-Сергеевич-CV.pdf");
  assert.equal(cvUploadName({ fullName: "Андрій Їжак", role: "" }), "Андрій-Їжак-CV.pdf");
  assert.equal(cvUploadName({ fullName: "Νίκος Παπαδάκης", role: "" }), "Νίκος-Παπαδάκης-CV.pdf");
  assert.equal(cvUploadName({ fullName: "Nguyễn Văn An", role: "" }), "Nguyen-Van-An-CV.pdf");
  assert.equal(cvUploadName({ fullName: "José Müller", role: "" }), "Jose-Muller-CV.pdf");
});
