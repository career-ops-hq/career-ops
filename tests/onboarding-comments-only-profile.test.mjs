import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describeSpawn } from "./helpers/describe-spawn.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANSWERS = {
  candidate: { full_name: "Example User", email: "example@example.test", location: "Denver, CO" },
  target_roles: ["Data Analyst"],
  compensation: { target_range: "$95K-120K", currency: "USD" },
  location: { country: "United States", timezone: "America/Denver" },
  spend_tier: "economy",
  portals: { positive: ["Data Analyst"] },
};

test("onboarding asks for and replaces a comments-only profile", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "co-onboarding-empty-profile-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));
  mkdirSync(join(dir, "config"));
  writeFileSync(join(dir, "config/profile.yml"), "# profile\n");
  const answerFile = join(dir, "answers.json");
  writeFileSync(answerFile, JSON.stringify(ANSWERS));
  const env = { ...process.env };
  for (const key of ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_PROFILE", "CAREER_OPS_PORTALS"]) delete env[key];

  const doctor = spawnSync(process.execPath, [join(ROOT, "doctor.mjs"), "--target", dir, "--json"], { encoding: "utf8", env });
  assert.equal(doctor.status, 0, describeSpawn(doctor));
  const state = JSON.parse(doctor.stdout);
  assert.ok(state.unpersonalized.some((entry) => entry.path === "config/profile.yml"));
  assert.ok(!state.missing.includes("config/profile.yml"));

  const writer = spawnSync(process.execPath, [join(ROOT, "onboard-write.mjs"), "--answers", answerFile, "--target", dir, "--only", "profile"], { encoding: "utf8", env });
  assert.equal(writer.status, 0, describeSpawn(writer));
  assert.deepEqual(JSON.parse(writer.stdout), { written: [], kept: ["config/profile.yml", "portals.yml"] });
  assert.equal(readFileSync(join(dir, "config/profile.yml"), "utf8"), "# profile\n");

  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  const start = agents.indexOf("#### Step 2: Profile");
  const end = agents.indexOf("#### Step 3: Portals", start);
  assert.ok(start >= 0 && end > start, "profile onboarding section exists");
  const profileStep = agents.slice(start, end);
  assert.match(profileStep, /(?:unpersonalized.{0,300}config\/profile\.yml|config\/profile\.yml.{0,300}unpersonalized)/is,
    "profile questions should also be asked when doctor flags config/profile.yml as unpersonalized");
  assert.match(profileStep, /--force/, "writing an existing comments-only profile must use --force");
});
