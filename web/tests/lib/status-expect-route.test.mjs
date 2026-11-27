// POST /api/status forwards the caller's DISPLAYED status as --expect-status,
// so a row another session renumbered between the render and the save is
// refused instead of written (#5034). Driven for real: the handler runs under
// the @/ loader against this checkout's set-status.mjs and a temp data root.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const codeRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataRoot = mkdtempSync(join(tmpdir(), "co-status-expect-"));
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

function seed(status) {
  mkdirSync(join(dataRoot, "data"), { recursive: true });
  writeFileSync(tracker, [
    "# Applications Tracker", "",
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
    `| 7 | 2026-02-01 | Fixture Alpha | Engineer | 4.4/5 | ${status} | ❌ | | |`, "",
  ].join("\n"));
  rmSync(join(dataRoot, "data", "status-log.tsv"), { force: true });
}

const rowStatus = () => readFileSync(tracker, "utf8").split("\n").find((l) => l.startsWith("| 7 |")).split("|")[6].trim();

async function post(body) {
  const { POST } = await import("@/app/api/status/route.ts");
  const res = await POST(new Request("http://127.0.0.1/api/status", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

test("a status the caller never displayed is a 409 and leaves the row alone", async () => {
  seed("Applied");
  const { status, body } = await post({ n: "7", status: "Interview", expectStatus: "Evaluated" });
  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.code, "status-changed");
  // The reload-and-retry instruction reaches the client, not a bare failure.
  assert.match(body.error, /is now Applied, not Evaluated; review it again before retrying/);
  assert.equal(rowStatus(), "Applied");
});

test("the displayed status still saves, and the retry after a reload works", async () => {
  seed("Applied");
  const { status, body } = await post({ n: "7", status: "Interview", expectStatus: "Applied" });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(rowStatus(), "Interview");
});

test("an unusable expectStatus is a 400, never a silently dropped guard", async () => {
  seed("Applied");
  for (const expectStatus of [42, "", "   ", "--force", null, {}]) {
    const { status } = await post({ n: "7", status: "Interview", expectStatus });
    assert.equal(status, 400, `expectStatus ${JSON.stringify(expectStatus)}`);
  }
  assert.equal(rowStatus(), "Applied");
});

test("callers that send no expectation keep working", async () => {
  seed("Applied");
  const { status } = await post({ n: "7", status: "Interview" });
  assert.equal(status, 200);
  assert.equal(rowStatus(), "Interview");
});

// The honest limit: set-status.mjs permits a mismatch when the row already
// holds the requested status, so --expect-status is a partial mitigation and
// not a fix. Closing it needs --expect-row.
test("a stale selection asking for the status the row already holds is still accepted", async () => {
  seed("Rejected");
  const { status } = await post({ n: "7", status: "Rejected", expectStatus: "Evaluated" });
  assert.equal(status, 200);
  assert.equal(rowStatus(), "Rejected");
});
