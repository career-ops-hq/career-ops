// CRLF reports must yield the same header fields and sections as LF.
// Windows editors and some sync tools save reports with CR LF. A `$` anchor
// does not match before a leftover CR, so the header fields and `##` splits
// come back empty and the report page drops the posting link.
//
// Run: node --test tests/lib/report-crlf.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readReport } from "../../src/lib/report-header.mjs";
import { splitSections } from "../../src/lib/report-sections.mjs";

const LF = `# Northwind Grocers — Analytics Engineering Lead

**Date:** 2026-07-01
**URL:** https://boards.example.com/northwind/1
**Score:** 4.2/5
**Legitimacy:** High Confidence

---

Intro line.

## A) Role summary

The role owns the warehouse.
`;

test("readReport keeps header fields when the file uses CRLF", () => {
  const crlf = LF.replace(/\n/g, "\r\n");
  const lf = readReport(LF);
  const cr = readReport(crlf);
  assert.equal(cr.title, lf.title);
  assert.ok(cr.fields.length > 0);
  assert.deepEqual(cr.fields, lf.fields);
  assert.equal(cr.fields.find((f) => f.label === "URL")?.value, "https://boards.example.com/northwind/1");
  assert.equal(cr.legitimacy, "High Confidence");
  assert.equal(cr.body.includes("\r"), false);
  const sections = splitSections(cr.body);
  assert.equal(sections.sections.length, splitSections(lf.body).sections.length);
  assert.match(sections.sections[0].heading, /Role summary/);
});

test("readReport and splitSections accept a lone CR line ending", () => {
  const cr = LF.replace(/\n/g, "\r");
  const parsed = readReport(cr);
  assert.equal(parsed.fields.find((f) => f.label === "Date")?.value, "2026-07-01");
  const sections = splitSections(parsed.body);
  assert.match(sections.sections[0].heading, /Role summary/);
  assert.match(sections.sections[0].content, /warehouse/);
});

test("splitSections splits CRLF and CR text it gets directly", () => {
  // pipeline-compare passes a report body straight to splitSections, without
  // readReport, so splitSections has to handle the line endings on its own.
  const lf = splitSections(LF);
  assert.ok(lf.sections.length > 0);
  assert.deepEqual(splitSections(LF.replace(/\n/g, "\r\n")), lf);
  assert.deepEqual(splitSections(LF.replace(/\n/g, "\r")), lf);
});
