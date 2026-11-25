import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_REPORT_EXPLANATION, reportSpendActions } from "../../src/lib/report-spend-actions.mjs";

test("a row with no report does not offer tailor or the checklist", () => {
  const blocked = reportSpendActions(false);
  assert.equal(blocked.generateCv, false);
  assert.equal(blocked.checklist, false);
  assert.equal(blocked.explanation, NO_REPORT_EXPLANATION);
  assert.match(blocked.explanation, /Generate tailored CV/);
  assert.match(blocked.explanation, /Apply checklist/);
});

test("a row with a report offers tailor and the checklist", () => {
  assert.deepEqual(reportSpendActions(true), { generateCv: true, checklist: true, explanation: null });
});

test("the report page shows the verdict before the action row, and delete stays after it", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../src/components/report-view.tsx"),
    "utf8",
  );
  const verdict = src.indexOf(">Verdict<");
  const generate = src.indexOf("<GeneratePdfButton");
  const checklist = src.indexOf("Apply checklist");
  const apply = src.indexOf("<ApplyButton");
  const remove = src.indexOf("<DeleteFromTracker");
  assert.ok(verdict !== -1 && generate !== -1 && remove !== -1);
  assert.ok(verdict < generate, "verdict must come before Generate tailored CV");
  assert.ok(verdict < checklist, "verdict must come before Apply checklist");
  assert.ok(verdict < apply, "verdict must come before Apply");
  assert.ok(generate < remove, "Delete stays after the primary actions");
  const spend = src.indexOf("reportSpendActions");
  assert.ok(spend !== -1, "the page must use the no-report gate");
});
