import test from "node:test";
import assert from "node:assert/strict";
import { relevantProfileUpdates } from "../../src/lib/resume-profile-updates.mjs";
import { nextRoleVersion } from "../../src/lib/role-resumes.mjs";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("irrelevant newly added skill is not injected into an unrelated role", () => {
  const updates = [{ updateType: "skill", section: "Technical Skills", description: "skill: Confluence" }];
  assert.deepEqual(relevantProfileUpdates(updates, "Senior Java Backend Engineer REST APIs"), []);
  assert.equal(relevantProfileUpdates(updates, "Developer Productivity with Confluence workflows").length, 1);
});

test("education certification and explicit work changes remain reviewable", () => {
  const updates = ["education", "certification", "work"].map((updateType) => ({ updateType, description: `${updateType}: approved entry` }));
  assert.equal(relevantProfileUpdates(updates, "Backend Engineer" ).length, 3);
});

test("resume update version never overwrites and v001 plus v002 produces v003", () => {
  const root = mkdtempSync(join(tmpdir(), "co-next-role-"));
  try { mkdirSync(join(root, "output", "role-resumes", "application-developer", "v001"), { recursive: true }); mkdirSync(join(root, "output", "role-resumes", "application-developer", "v002")); assert.equal(nextRoleVersion(root, "application-developer"), "v003"); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
