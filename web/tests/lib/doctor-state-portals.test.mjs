// doctorState must look for portals where the scanner does: CAREER_OPS_PORTALS
// when set, otherwise <root>/portals.yml. doctor.mjs gained that in #5166; the
// web onboarding banner still only checked the default path.
//
// Run: npm test -- tests/lib/doctor-state-portals.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const skipTs = !process.features?.typescript && "this Node cannot import career-ops.ts (no type stripping)";
const { doctorState } = skipTs ? {} : await import("@/lib/career-ops");

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "co-doctor-portals-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "modes"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "cv.md"), "# CV\n");
  writeFileSync(join(root, "config/profile.yml"), "candidate:\n  full_name: Test\n");
  writeFileSync(join(root, "modes/_profile.md"), "# Profile\n");
  writeFileSync(
    join(root, "data/applications.md"),
    "# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n",
  );
  return root;
}

function withEnv(root, portals, fn) {
  const prevRoot = process.env.CAREER_OPS_ROOT;
  const prevPortals = process.env.CAREER_OPS_PORTALS;
  const prevProfile = process.env.CAREER_OPS_PROFILE;
  process.env.CAREER_OPS_ROOT = root;
  delete process.env.CAREER_OPS_PROFILE;
  if (portals === null) delete process.env.CAREER_OPS_PORTALS;
  else process.env.CAREER_OPS_PORTALS = portals;
  try {
    return fn();
  } finally {
    if (prevRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevRoot;
    if (prevPortals === undefined) delete process.env.CAREER_OPS_PORTALS;
    else process.env.CAREER_OPS_PORTALS = prevPortals;
    if (prevProfile === undefined) delete process.env.CAREER_OPS_PROFILE;
    else process.env.CAREER_OPS_PROFILE = prevProfile;
    rmSync(root, { recursive: true, force: true });
  }
}

test("doctorState treats CAREER_OPS_PORTALS as the portals file", { skip: skipTs }, () => {
  const root = makeRoot();
  const alt = join(root, "alt-portals.yml");
  writeFileSync(alt, "tracked_companies: []\n");
  const state = withEnv(root, alt, () => doctorState({ applications: [], inbox: [] }));
  assert.equal(state.missing.includes("portals.yml"), false, `missing=${JSON.stringify(state.missing)}`);
  assert.equal(state.onboardingNeeded, false);
  assert.equal(state.phase, "established");
});

test("doctorState still reports portals.yml missing when neither the override nor the default file exists", { skip: skipTs }, () => {
  const root = makeRoot();
  const state = withEnv(root, null, () => doctorState({ applications: [], inbox: [] }));
  assert.deepEqual(state.missing, ["portals.yml"]);
  assert.equal(state.onboardingNeeded, true);
});

test("doctorState agrees with core on empty YAML and keeps the missing list separate", { skip: skipTs }, () => {
  const root = makeRoot();
  const portals = join(root, "alt-portals.yml");
  const profile = join(root, "config/profile.yml");
  const doctor = fileURLToPath(new URL("../../../doctor.mjs", import.meta.url));

  withEnv(root, portals, () => {
    for (const [profileText, portalsText, expected] of [
      ["candidate: {}\n", "tracked_companies: []\n", false],
      ["  # Profile settings\r\n\r\n", "tracked_companies: []\n", true],
      ["candidate: {}\n", "# Portal settings\n", true],
      ["{}\n", "tracked_companies: []\n", true],
      ["candidate: {}\n", "--- {} # no settings\n", true],
      ["candidate: {}\n", "null\n", true],
      ["candidate: {}\n", "\n  \n", true],
      ["candidate: {}\n", "tracked_companies: [\n", false],
    ]) {
      writeFileSync(profile, profileText);
      writeFileSync(portals, portalsText);
      const core = JSON.parse(execFileSync(process.execPath, [doctor, "--json", "--target", root], {
        cwd: root,
        encoding: "utf8",
      }));
      const web = doctorState({ applications: [], inbox: [] });
      assert.deepEqual(web.missing, core.missing);
      assert.deepEqual(web.missing, []);
      assert.equal(web.onboardingNeeded, core.onboardingNeeded);
      assert.equal(web.onboardingNeeded, expected);
      assert.equal(web.phase, expected ? "in-between" : "established");
    }
  });
});
