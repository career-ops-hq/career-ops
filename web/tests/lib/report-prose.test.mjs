// A report with no --- rule and no ## heading used to drop the first ten
// lines. Prose stays in the body. A title and header fields at the top are
// still read.
//
// Run from web/: node --test tests/lib/report-prose.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readReport } from "../../src/lib/report-header.mjs";

test("a report with no heading keeps every line in the body", () => {
  const lines = ["This opening has no title."];
  for (let i = 1; i <= 15; i++) lines.push(`Sentence ${i} belongs in the report.`);
  const report = readReport(lines.join("\n"));
  assert.equal(report.title, null);
  assert.match(report.body, /This opening has no title/);
  assert.match(report.body, /Sentence 1 belongs/);
  assert.match(report.body, /Sentence 8 belongs/);
  assert.match(report.body, /Sentence 15 belongs/);
});

test("a titled report without a rule still keeps the prose and the header fields", () => {
  const lines = ["# Fixture Co", "**Date:** 2026-11-01", ""];
  for (let i = 1; i <= 12; i++) lines.push(`Sentence ${i} belongs in the report.`);
  const report = readReport(lines.join("\n"));
  assert.equal(report.title, "Fixture Co");
  assert.equal(report.fields.find((field) => field.label === "Date")?.value, "2026-11-01");
  assert.match(report.body, /^Sentence 1 belongs/);
  assert.match(report.body, /Sentence 12 belongs/);
});
