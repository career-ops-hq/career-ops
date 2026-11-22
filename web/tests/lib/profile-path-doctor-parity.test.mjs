// The onboarding banner (doctorState) and `node doctor.mjs --json` must list the
// same prerequisites as missing, in every CAREER_OPS_PROFILE situation (#5026).
// They are two implementations (the web cannot import the core: Turbopack's root
// is pinned to web/), so this runs the REAL core doctor against the same data
// root and environment as the web function and compares the two answers.
//
// The core side honors CAREER_OPS_PROFILE once the core helper has landed
// (path-resolver.mjs exports getProfilePath). Until then the core doctor has no
// override to agree with, and the test is reported as skipped rather than passed.
//
// Run:  node --experimental-strip-types --test tests/lib/profile-path-doctor-parity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const { doctorState } = await import("../../src/lib/career-ops.ts");

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const coreResolver = await import(pathToFileURL(path.join(checkout, "path-resolver.mjs")).href);
const coreHonorsOverride = typeof coreResolver.getProfilePath === "function";
const skip = coreHonorsOverride ? false : "core path-resolver.mjs has no getProfilePath yet (Part 1 of #5026)";

/** A data root with every prerequisite but the profile, then the profile on request. */
function fixture({ dataRootProfile, overrideProfile, envFileOnly }) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "career-ops-doctor-parity-")));
  mkdirSync(path.join(root, "config"));
  mkdirSync(path.join(root, "modes"));
  writeFileSync(path.join(root, "cv.md"), "# CV\n");
  writeFileSync(path.join(root, "modes", "_profile.md"), "# profile\n");
  writeFileSync(path.join(root, "portals.yml"), "companies: []\n");
  const named = path.join(root, "elsewhere", "me.yml");
  mkdirSync(path.dirname(named));
  if (dataRootProfile) writeFileSync(path.join(root, "config", "profile.yml"), "candidate:\n  full_name: A\n");
  if (overrideProfile) writeFileSync(named, "candidate:\n  full_name: B\n");
  if (envFileOnly) writeFileSync(path.join(root, ".env"), `CAREER_OPS_PROFILE=${named}\n`);
  return { root, named };
}

function bothSides({ root, named }, { shellOverride }) {
  const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: "" };
  delete env.CAREER_OPS_PROFILE;
  if (shellOverride) env.CAREER_OPS_PROFILE = named;
  const saved = { root: process.env.CAREER_OPS_ROOT, profile: process.env.CAREER_OPS_PROFILE };
  process.env.CAREER_OPS_ROOT = root;
  if (shellOverride) process.env.CAREER_OPS_PROFILE = named;
  else delete process.env.CAREER_OPS_PROFILE;
  try {
    const web = doctorState({ applications: [], inbox: [] }).missing;
    const run = spawnSync(process.execPath, [path.join(checkout, "doctor.mjs"), "--json"], { cwd: root, env, encoding: "utf8", timeout: 60000 });
    assert.ifError(run.error);
    return { web, core: JSON.parse(run.stdout).missing };
  } finally {
    for (const [key, value] of [["CAREER_OPS_ROOT", saved.root], ["CAREER_OPS_PROFILE", saved.profile]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const cases = [
  ["the shell names an existing profile and the data root has none", { overrideProfile: true }, { shellOverride: true }, []],
  ["the shell names a missing file and the data root has a profile", { dataRootProfile: true }, { shellOverride: true }, ["config/profile.yml"]],
  ["only the data root's .env names a profile", { overrideProfile: true, envFileOnly: true }, { shellOverride: false }, ["config/profile.yml"]],
  ["no override and a data-root profile", { dataRootProfile: true }, { shellOverride: false }, []],
  ["no override and no profile anywhere", {}, { shellOverride: false }, ["config/profile.yml"]],
];

for (const [label, files, shell, want] of cases) {
  test(`doctorState and core doctor --json agree: ${label}`, { skip }, () => {
    const fx = fixture(files);
    try {
      const { web, core } = bothSides(fx, shell);
      assert.deepEqual(web, want, "web doctorState().missing");
      assert.deepEqual(core, want, "core doctor --json missing");
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
}
