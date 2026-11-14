// A fact-check failure used to leave the status on Saved. The draft stays so
// it can be fixed, the PDF is unchanged, and a reload still says the draft
// is not in the PDF.
//
// Run from web/: node --test tests/lib/cv-studio-save-failed.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";
import { editSaveStatus, withPdfExport } from "../../src/lib/cv-studio/put-order.mjs";
import { emptyEdits, parseEdits } from "../../src/lib/cv-studio/studio.mjs";

const { recordPdfExport, saveEdits } = await import("../../src/lib/cv-studio/server.ts");

test("a rejected draft does not count as Saved, and a later autosave keeps the failure", () => {
  const edits = emptyEdits("hash");
  const failed = withPdfExport(edits, null, { ok: false, error: "Fact check failed" });
  assert.equal(failed.pdfExport.error, "Fact check failed");
  assert.equal(parseEdits(failed, "hash").stale, false);
  assert.equal(editSaveStatus(JSON.stringify(edits), JSON.stringify(edits), null, null, false, true), "Not in the PDF");
  assert.equal(editSaveStatus(JSON.stringify(edits), JSON.stringify({ ...edits, hidden: ["b1"] }), null, null, false, true), "Unsaved");
  assert.equal(editSaveStatus(JSON.stringify(edits), JSON.stringify(edits), null, null, false, false), "Saved");

  const kept = withPdfExport({ ...edits, hidden: ["b1"] }, failed.pdfExport, undefined);
  assert.equal(kept.pdfExport.error, "Fact check failed");
  assert.deepEqual(kept.hidden, ["b1"]);
  assert.equal("pdfExport" in withPdfExport(edits, failed.pdfExport, null), false);
});

test("saveEdits records a failed export and an autosave does not drop it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-save-failed-"));
  const previous = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    const edits = emptyEdits("hash");
    saveEdits("011", edits, { ok: false, error: "Fact check failed" });
    const file = path.join(root, ".career-ops-web", "cv-studio", "011.json");
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(stored.pdfExport.ok, false);
    assert.equal(stored.pdfExport.error, "Fact check failed");
    assert.equal(parseEdits(stored, "hash").edits.preset.length, "full");

    saveEdits("011", { ...edits, hidden: ["b1"] });
    const afterAutosave = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(afterAutosave.pdfExport.error, "Fact check failed");
    assert.deepEqual(afterAutosave.hidden, ["b1"]);

    saveEdits("011", afterAutosave, null);
    const cleared = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cleared.pdfExport, undefined);

    const newer = { ...edits, hidden: ["b2"] };
    saveEdits("011", newer);
    recordPdfExport("011", { ok: false, error: "Fact check failed" });
    const duringRender = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(duringRender.hidden, ["b2"]);
    assert.equal(duringRender.pdfExport.error, "Fact check failed");
    recordPdfExport("011", null);
    const afterSuccess = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(afterSuccess.hidden, ["b2"]);
    assert.equal(afterSuccess.pdfExport, undefined);
  } finally {
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
