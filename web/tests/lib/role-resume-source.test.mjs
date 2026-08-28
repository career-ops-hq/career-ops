import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRoleResumeSource } from "../../src/lib/role-resume-source.mjs";

test("role-resume source loader reads cv.md from the supplied Career-Ops root", () => {
  const root = mkdtempSync(join(tmpdir(), "co-role-source-"));
  try { const cv = "# Jane Example\n\n## Experience\n\nSupported facts."; writeFileSync(join(root, "cv.md"), cv); const result = loadRoleResumeSource(root); assert.equal(result.cv, cv); assert.equal(result.file, "cv.md"); assert.ok(result.bytes > 0); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing and empty source CV fail before worker launch", () => {
  const root = mkdtempSync(join(tmpdir(), "co-role-source-"));
  try { assert.throws(() => loadRoleResumeSource(root), /missing or empty/); writeFileSync(join(root, "cv.md"), "  \n"); assert.throws(() => loadRoleResumeSource(root), /missing or empty/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("non-CV text fails the identity/content signal without guessing a name", () => {
  const root = mkdtempSync(join(tmpdir(), "co-role-source-"));
  try { writeFileSync(join(root, "cv.md"), "ordinary notes only"); assert.throws(() => loadRoleResumeSource(root), /expected profile headings/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
