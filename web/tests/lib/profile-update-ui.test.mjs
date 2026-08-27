import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync(new URL("../../src/components/profile-update-view.tsx", import.meta.url), "utf8");
const nav = fs.readFileSync(new URL("../../src/lib/nav-items.ts", import.meta.url), "utf8");
const cvRoute = fs.readFileSync(new URL("../../src/app/api/cv/route.ts", import.meta.url), "utf8");
const runRoute = fs.readFileSync(new URL("../../src/app/api/run/route.ts", import.meta.url), "utf8");

test("Update Career Profile navigation and five workflows are present", () => {
  assert.match(nav, /\/profile\/update.*Update Career Profile/);
  for (const label of ["Add Certification", "Add Skill", "Add Project Experience", "Update Work Experience", "Update Education"]) assert.match(component, new RegExp(label));
});
test("UI enforces preview then explicit approval", () => {
  assert.match(component, /Preview Update/); assert.match(component, /Approve Update/); assert.match(component, /approved: true/);
});
test("existing advanced CV editor API remains unchanged and separate", () => {
  assert.match(component, /Open Advanced CV Editor/); assert.match(cvRoute, /atomicWriteWithBackup/); assert.doesNotMatch(cvRoute, /profile-update/);
});
test("General Role Resume generation remains on its existing pipeline", () => {
  assert.match(runRoute, /kind === "role-resume"/); assert.match(runRoute, /validateRoleResumeCompleteness/);
  assert.doesNotMatch(component, /kind:\s*"role-resume"/);
});
