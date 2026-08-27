import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AUTO_COVER_MARKER, autoCoverEnabled, canGenerateCoverLetter, initializeCoverLetterDraft, nextCoverVersion } from "../../src/lib/cover-letter-workflow.mjs";

function rootWithResume(version = "v001", coverVersion) {
  const root = mkdtempSync(join(tmpdir(), "co-cover-flow-"));
  const resume = join(root, "output", "007-acme-role", "cv", "tailored", version, "cv.pdf");
  mkdirSync(join(resume, ".."), { recursive: true }); writeFileSync(resume, "%PDF");
  if (coverVersion) { const cover = join(root, "output", "007-acme-role", "cover-letter", coverVersion, "cover-letter.pdf"); mkdirSync(join(cover, ".."), { recursive: true }); writeFileSync(cover, "%PDF"); }
  return root;
}

test("automatic draft initializes once after resume generation", () => {
  const root = rootWithResume();
  try {
    const first = initializeCoverLetterDraft(root, "7", true, "2026-08-26T00:00:00.000Z");
    assert.equal(first.kind, "created"); assert.equal(first.state.status, "Draft - Review Required");
    const second = initializeCoverLetterDraft(root, "7", true);
    assert.equal(second.kind, "unchanged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("configuration toggle prevents draft creation", () => {
  const root = rootWithResume();
  try { assert.equal(initializeCoverLetterDraft(root, 7, false).kind, "disabled"); }
  finally { rmSync(root, { recursive: true, force: true }); }
  assert.equal(autoCoverEnabled(AUTO_COVER_MARKER), true); assert.equal(autoCoverEnabled(""), false);
});

test("version incrementing is numeric", () => assert.equal(nextCoverVersion(["v001", "v009", "v010"]), "v011"));

test("approved cover is preserved and newer resume requests review", () => {
  const root = rootWithResume("v003", "v001");
  try {
    const result = initializeCoverLetterDraft(root, 7, true);
    assert.equal(result.state.existingCoverVersion, "v001");
    assert.equal(result.state.targetVersion, "v002");
    assert.equal(result.state.status, "Review recommended - newer resume exists");
    assert.equal(readFileSync(join(root, "output", "007-acme-role", "cover-letter", "v001", "cover-letter.pdf"), "utf8"), "%PDF");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("PDF generation remains approval-gated", () => {
  assert.equal(canGenerateCoverLetter({ status: "Draft - Review Required", payloadPath: "draft.json" }), false);
  assert.equal(canGenerateCoverLetter({ status: "Approved", payloadPath: "draft.json" }), true);
});
