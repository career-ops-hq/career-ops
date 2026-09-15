import { test } from "node:test";
import assert from "node:assert/strict";
import {
  colIndex,
  fitTone,
  isStarTableHeader,
  parsePipeTable,
  pipeCells,
  splitPipeTables,
  fitColumnIndex,
} from "../../src/lib/report-tables.mjs";

const STAR_MD = `| # | JD requirement | STAR+R story | S | T | A | R | Reflection |
|---|----------------|--------------|---|---|---|---|------------|
| 1 | AI in day-to-day Eng ops | LLM ticket classification to prod | Acme platform team | Classification | Stood up LLM | Delivered in days | Lead with this |`;

test("pipeCells splits a GFM row", () => {
  assert.deepEqual(pipeCells("| Strong | Gap |"), ["Strong", "Gap"]);
});

test("pipeCells keeps escaped pipes inside a cell", () => {
  assert.deepEqual(pipeCells("| Bash \\| PowerShell | Strong |"), ["Bash | PowerShell", "Strong"]);
});

test("isStarTableHeader requires S T A R plus a STAR-named column", () => {
  assert.equal(
    isStarTableHeader(["#", "JD requirement", "STAR+R story", "S", "T", "A", "R", "Reflection"]),
    true,
  );
  assert.equal(isStarTableHeader(["JD requirement", "Evidence (CV)", "Fit"]), false);
  assert.equal(isStarTableHeader(["Field", "Value"]), false);
});

test("parsePipeTable reads a STAR+R grid", () => {
  const parsed = parsePipeTable(STAR_MD);
  assert.ok(parsed);
  assert.equal(isStarTableHeader(parsed.header), true);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0][1], "AI in day-to-day Eng ops");
});

test("colIndex does not confuse S with STAR+R story", () => {
  const header = ["#", "JD requirement", "STAR+R story", "S", "T", "A", "R", "Reflection"];
  assert.equal(colIndex(header, ["s"]), 3);
  assert.equal(colIndex(header, ["story"]), 2);
  assert.equal(colIndex(header, ["jd requirement", "requirement"]), 1);
});

test("fitTone only colors short Fit labels", () => {
  assert.equal(fitTone("Strong"), "good");
  assert.equal(fitTone("Exceeds"), "good");
  assert.equal(fitTone("Gap"), "bad");
  assert.equal(fitTone("Gap (nice-to-have)"), "bad");
  assert.equal(fitTone("Adjacent"), "warn");
  assert.equal(fitTone("Partial plus"), "warn");
  assert.equal(fitTone("Adequate"), "warn");
  assert.equal(fitTone("Acme: internal AI on Graph — Strong evidence of ops AI."), null);
  assert.equal(fitTone(""), null);
});

test("fitColumnIndex is the exact Fit column", () => {
  assert.equal(fitColumnIndex(["JD requirement", "Evidence (CV)", "Fit"]), 2);
  assert.equal(fitColumnIndex(["Field", "Value"]), -1);
  assert.equal(fitColumnIndex(["outfit", "Fit"]), 1);
});

test("splitPipeTables keeps prose around a table", () => {
  const chunks = splitPipeTables("Intro para.\n\n| Fit |\n|-----|\n| Strong |\n\nAfter.");
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].type, "md");
  assert.equal(chunks[1].type, "table");
  assert.equal(chunks[2].type, "md");
  assert.match(chunks[0].text, /Intro/);
  assert.match(chunks[2].text, /After/);
});
