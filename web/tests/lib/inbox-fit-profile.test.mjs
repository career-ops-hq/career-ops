import "../helpers/web-ts-alias-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { applyInboxFit, loadFitTargets } = await import("../../src/lib/inbox-fit-profile.mjs");

const job = { id: "row-1" };

test("a profile load that throws leaves the inbox rows and names the file", () => {
  const jobs = [job];
  let ranked = false;
  const result = applyInboxFit(jobs, () => {
    throw new Error("bad indentation of a mapping entry");
  }, () => {
    ranked = true;
    return job;
  });
  assert.equal(ranked, false);
  assert.equal(result.jobs, jobs);
  assert.equal(result.error, "config/profile.yml: bad indentation of a mapping entry");
});

test("a profile load that throws without a message uses one fallback line", () => {
  const jobs = [job];
  const result = applyInboxFit(jobs, () => {
    throw "no";
  }, () => job);
  assert.equal(result.jobs, jobs);
  assert.equal(result.error, "config/profile.yml could not be read.");
});

test("a profile load that returns targets ranks each row", () => {
  const jobs = [job, { id: "row-2" }];
  const result = applyInboxFit(jobs, () => ({ roles: ["Analyst"] }), (row, targets) => ({ ...row, fit: targets.roles[0] }));
  assert.equal(result.error, null);
  assert.deepEqual(result.jobs, [
    { id: "row-1", fit: "Analyst" },
    { id: "row-2", fit: "Analyst" },
  ]);
});

test("a missing profile ranks the inbox and a broken profile does not", () => {
  const root = mkdtempSync(join(tmpdir(), "co-inbox-fit-"));
  const saved = {
    CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT,
    CAREER_OPS_DATA_DIR: process.env.CAREER_OPS_DATA_DIR,
    CAREER_OPS_PROFILE: process.env.CAREER_OPS_PROFILE,
  };
  process.env.CAREER_OPS_ROOT = root;
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_PROFILE;
  try {
    const jobs = [job];
    const missing = applyInboxFit(jobs, loadFitTargets, (row) => ({ ...row, ranked: true }));
    assert.equal(missing.error, null);
    assert.deepEqual(missing.jobs, [{ id: "row-1", ranked: true }]);

    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config", "profile.yml"), "target_roles: [\n  - broken\n");
    const broken = applyInboxFit(jobs, loadFitTargets, (row) => ({ ...row, ranked: true }));
    assert.equal(broken.jobs, jobs);
    assert.match(broken.error, /^config\/profile\.yml: /);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
