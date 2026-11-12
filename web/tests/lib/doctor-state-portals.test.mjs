// doctorState must look for portals where the scanner does: CAREER_OPS_PORTALS
// when set, otherwise <root>/portals.yml. doctor.mjs gained that in #5166; the
// web onboarding banner still only checked the default path.
//
// Run: npm test -- tests/lib/doctor-state-portals.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  process.env.CAREER_OPS_ROOT = root;
  if (portals === null) delete process.env.CAREER_OPS_PORTALS;
  else process.env.CAREER_OPS_PORTALS = portals;
  try {
    return fn();
  } finally {
    if (prevRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevRoot;
    if (prevPortals === undefined) delete process.env.CAREER_OPS_PORTALS;
    else process.env.CAREER_OPS_PORTALS = prevPortals;
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
