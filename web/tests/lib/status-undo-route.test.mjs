// POST /api/status {n, undo: true} takes back the row's last logged change
// through set-status.mjs --undo. Driven for real: the handler runs under the @/
// loader against this checkout's set-status.mjs and a temp data root.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const codeRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataRoot = mkdtempSync(join(tmpdir(), "co-status-undo-"));
const tracker = join(dataRoot, "data", "applications.md");
const ENV_KEYS = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

before(() => {
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_DATA_DIR = "";
  process.env.CAREER_OPS_TRACKER = tracker;
});

after(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dataRoot, { recursive: true, force: true });
});

function seed(status, ledger) {
  mkdirSync(join(dataRoot, "data"), { recursive: true });
  writeFileSync(tracker, [
    "# Applications Tracker", "",
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
    `| 7 | 2026-02-01 | Fixture Alpha | Engineer | 4.4/5 | ${status} | ❌ | | |`, "",
  ].join("\n"));
  rmSync(join(dataRoot, "data", "status-log.tsv"), { force: true });
  if (ledger) writeFileSync(join(dataRoot, "data", "status-log.tsv"), ledger);
}

const rowStatus = () => readFileSync(tracker, "utf8").split("\n").find((l) => l.startsWith("| 7 |")).split("|")[6].trim();

async function post(body) {
  const { POST } = await import("@/app/api/status/route.ts");
  const res = await POST(new Request("http://127.0.0.1/api/status", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

test("undo restores the status before the last logged change and echoes it", async () => {
  seed("Applied", "7\t2026-02-03\tEvaluated\tApplied\tweb\t\n");
  const { status, body } = await post({ n: "7", undo: true });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.status, "Evaluated");
  assert.equal(rowStatus(), "Evaluated");
});

test("undo with nothing logged is a 404 and leaves the row alone", async () => {
  seed("Applied", null);
  const { status, body } = await post({ n: "7", undo: true });
  assert.equal(status, 404);
  assert.equal(body.code, "nothing-to-undo");
  assert.equal(rowStatus(), "Applied");
});

test("undo after a hand edit is a 409", async () => {
  seed("Interview", "7\t2026-02-03\tEvaluated\tApplied\tweb\t\n");
  const { status, body } = await post({ n: "7", undo: true });
  assert.equal(status, 409);
  assert.equal(body.code, "undo-stale");
});

test("a status write still needs a status", async () => {
  seed("Evaluated", null);
  const { status } = await post({ n: "7" });
  assert.equal(status, 400);
});
