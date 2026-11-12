import { test } from "node:test";
import assert from "node:assert/strict";
import { compareIds, summaryFields } from "../../src/lib/pipeline-compare.mjs";

test("compareIds keeps up to three distinct application numbers in order", () => {
  assert.deepEqual(compareIds("220,199,220,x,100,7"), ["220", "199", "100"]);
  assert.deepEqual(compareIds(["12", "5"]), ["12", "5"]);
  assert.deepEqual(compareIds(undefined), []);
});

test("summaryFields reads the first two-column table of the report body", () => {
  const body = "## A) Role Summary\n\n| Field | Value |\n|---|---|\n| **Remote** | Seattle, WA |\n| **Comp** | $238k-$278k |\n\n## B) CV Match\n\n| JD Requirement | CV Match | Source |\n|---|---|---|\n| SQL | Strong | cv.md |";
  assert.deepEqual(summaryFields(body), [
    { label: "Remote", value: "Seattle, WA" },
    { label: "Comp", value: "$238k-$278k" },
  ]);
  assert.deepEqual(summaryFields("No tables here."), []);
});

test("summaryFields skips a wider table earlier in the same section", () => {
  const body = `## A) Role Summary

| Area | Ask | Fit |
|------|-----|-----|
| Infra | Terraform | Strong |

| Field | Value |
|-------|-------|
| Remote | Full |
| Comp | 150k |
`;
  assert.deepEqual(summaryFields(body), [
    { label: "Remote", value: "Full" },
    { label: "Comp", value: "150k" },
  ]);
});
