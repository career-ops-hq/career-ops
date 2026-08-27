import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRoleResumeHtml } from "../../src/lib/role-resume-fact-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
test("CV-supported role HTML passes before persistence", async () => {
  assert.equal((await validateRoleResumeHtml("<html><body>Java Software Engineer using REST APIs.</body></html>", ROOT)).ok, true);
});
test("unsupported role HTML is blocked before persistence", async () => {
  const result = await validateRoleResumeHtml("<html><body>Principal Quantum Engineer using COBOL.</body></html>", ROOT);
  assert.equal(result.ok, false);
  assert.match(result.error, /Fact check failed/);
});
