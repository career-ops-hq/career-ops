import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveCodeRoot, resolveRootScript } from "../../src/lib/core/code-root.mjs";

const CORE = path.resolve(import.meta.dirname, "../../..");

test("CAREER_OPS_CODE_ROOT (absolute) wins over the cwd fallback", () => {
  const checkout = path.resolve(CORE, "..");
  assert.equal(resolveCodeRoot(checkout, { CAREER_OPS_CODE_ROOT: CORE }), CORE);
});

test("relative CAREER_OPS_CODE_ROOT resolves against the cwd", () => {
  const web = path.join(CORE, "web");
  assert.equal(resolveCodeRoot(web, { CAREER_OPS_CODE_ROOT: ".." }), CORE);
});

test("no env → the cwd's parent is the checkout (web/ lives inside it)", () => {
  const web = path.join(CORE, "web");
  assert.equal(resolveCodeRoot(web, {}), CORE);
});

test("the data root is never consulted — scripts never resolve into it (#524)", () => {
  const dataRoot = path.join(CORE, "..", "career-data");
  const codeRoot = resolveCodeRoot(dataRoot, {});
  assert.notEqual(codeRoot, dataRoot);
});

test("resolveRootScript assembles <codeRoot>/<name>.mjs", () => {
  assert.equal(resolveRootScript("/engine", "doctor"), path.join("/engine", "doctor.mjs"));
  assert.equal(resolveRootScript("/engine", "scan-ats-full"), path.join("/engine", "scan-ats-full.mjs"));
});

test("blank CAREER_OPS_CODE_ROOT falls back like an unset var", () => {
  const web = path.join(CORE, "web");
  assert.equal(resolveCodeRoot(web, { CAREER_OPS_CODE_ROOT: "  " }), CORE);
});
