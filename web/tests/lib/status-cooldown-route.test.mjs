// POST /api/status {n, status: "Rejected", cooldownDays, cooldownScope} records
// a re-apply cooldown through set-status.mjs --cooldown-days. Driven for real:
// the handler runs under the @/ loader against this checkout's set-status.mjs
// and a temp data root, so the profile.yml write is the CLI's own.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import "../helpers/web-ts-alias-loader.mjs";

const codeRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataRoot = mkdtempSync(join(tmpdir(), "co-status-cooldown-"));
const tracker = join(dataRoot, "data", "applications.md");
const profile = join(dataRoot, "config", "profile.yml");
const ENV_KEYS = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER", "CAREER_OPS_PROFILE"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const PROFILE_TEXT = 'candidate:\n  full_name: "Fixture Person"   # keep this comment\n';

before(() => {
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_DATA_DIR = "";
  process.env.CAREER_OPS_TRACKER = tracker;
  delete process.env.CAREER_OPS_PROFILE;
});

after(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dataRoot, { recursive: true, force: true });
});

function seed(status) {
  mkdirSync(join(dataRoot, "data"), { recursive: true });
  mkdirSync(join(dataRoot, "config"), { recursive: true });
  writeFileSync(tracker, [
    "# Applications Tracker", "",
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
    `| 7 | 2026-02-01 | Fixture Alpha | Platform Engineer | 4.4/5 | ${status} | ❌ | | |`, "",
  ].join("\n"));
  rmSync(join(dataRoot, "data", "status-log.tsv"), { force: true });
  writeFileSync(profile, PROFILE_TEXT);
}

const rowStatus = () => readFileSync(tracker, "utf8").split("\n").find((l) => l.startsWith("| 7 |")).split("|")[6].trim();
const windows = () => yaml.load(readFileSync(profile, "utf8"))?.re_apply_windows;

async function post(body) {
  const { POST } = await import("@/app/api/status/route.ts");
  const res = await POST(new Request("http://127.0.0.1/api/status", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

test("Rejected with cooldownDays saves the status and records the window", async () => {
  seed("Interview");
  const { status, body } = await post({ n: "7", status: "Rejected", cooldownDays: 180, cooldownScope: "company" });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, "Rejected");
  assert.equal(rowStatus(), "Rejected");
  assert.equal(body.cooldown?.recorded, true);
  assert.equal(body.cooldown?.scope, "company");
  const win = windows()?.["Fixture Alpha"];
  assert.equal(win?.same_role_days, 180);
  assert.equal(win?.scope, "company");
  assert.deepEqual(win?.applied_to, ["Platform Engineer"]);
  assert.match(readFileSync(profile, "utf8"), /# keep this comment/, "the profile keeps its comments");
});

test("Rejected without cooldownDays writes no window and no cooldown field", async () => {
  seed("Interview");
  const { status, body } = await post({ n: "7", status: "Rejected" });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.cooldown, undefined);
  assert.equal(readFileSync(profile, "utf8"), PROFILE_TEXT);
});

test("a cooldown on any other status is a 400 before the tracker is touched", async () => {
  seed("Applied");
  const { status } = await post({ n: "7", status: "Interview", cooldownDays: 30 });
  assert.equal(status, 400);
  assert.equal(rowStatus(), "Applied");
});

test("malformed cooldown fields are 400s", async () => {
  seed("Interview");
  for (const body of [
    { n: "7", status: "Rejected", cooldownDays: "180" },
    { n: "7", status: "Rejected", cooldownDays: 1.5 },
    { n: "7", status: "Rejected", cooldownDays: -1 },
    { n: "7", status: "Rejected", cooldownDays: 99999 },
    { n: "7", status: "Rejected", cooldownDays: 30, cooldownScope: "everything" },
    { n: "7", status: "Rejected", cooldownScope: "company" },
  ]) {
    const { status } = await post(body);
    assert.equal(status, 400, JSON.stringify(body));
  }
  assert.equal(rowStatus(), "Interview");
});
