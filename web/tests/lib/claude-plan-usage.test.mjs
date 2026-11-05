// Plan limits for the usage meter, read from `claude -p "/usage"`.
//
// Run: npm test -- tests/lib/claude-plan-usage.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parsePlanUsage, candidateBinaries, readPlanUsage, resolveOnPath } from "../../src/lib/claude-plan-usage.mjs";

const SAMPLE = [
  "You are currently using your subscription to power your Claude Code usage",
  "",
  "Current session: 33% used · resets Nov 5 at 8:30pm (America/New_York)",
  "Current week (all models): 15% used · resets Nov 11 at 9pm (America/New_York)",
  "Current week (Fable): 0% used · resets Nov 11 at 9pm (America/New_York)",
  "",
  "Last 24h · 1861 requests · 17 sessions",
].join("\n");

test("parses session and week rows with reset text", () => {
  const p = parsePlanUsage(SAMPLE);
  assert.deepEqual(p.rows.map((r) => [r.label, r.percent]), [
    ["Current session", 33],
    ["Current week (all models)", 15],
    ["Current week (Fable)", 0],
  ]);
  assert.equal(p.rows[0].resets, "Nov 5 at 8:30pm (America/New_York)");
});

test("unrecognised or non-string output is null", () => {
  assert.equal(parsePlanUsage("You are using an API key"), null);
  assert.equal(parsePlanUsage(undefined), null);
});

test("finds the newest desktop-bundled binary after PATH", async () => {
  const home = mkdtempSync(join(tmpdir(), "co-plan-"));
  try {
    for (const v of ["2.1.9", "2.1.317"]) {
      const dir = join(home, "Library/Application Support/Claude/claude-code", v, "abc", "claude.app/Contents/MacOS");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "claude"), "");
    }
    const c = await candidateBinaries({ home });
    assert.equal(c[0], "claude");
    assert.match(c[1], /2\.1\.317/);
    assert.match(c[2], /2\.1\.9/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("no desktop app: only PATH is tried", async () => {
  const home = mkdtempSync(join(tmpdir(), "co-plan-"));
  try {
    assert.deepEqual(await candidateBinaries({ home }), ["claude"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("falls through a missing binary to the next, and to null when none answer", async () => {
  const exec = (bin, _a, _o, cb) =>
    bin === "claude" ? cb(Object.assign(new Error("not found"), { code: "ENOENT" })) : cb(null, JSON.stringify({ result: SAMPLE }));
  const got = await readPlanUsage({ candidates: ["claude", "/desktop/claude"], exec, resolve: (b) => b });
  assert.equal(got.rows.length, 3);
  const none = await readPlanUsage({ candidates: ["claude"], exec: (_b, _a, _o, cb) => cb(new Error("x")), resolve: (b) => b });
  assert.equal(none, null);
});

test("resolves a bare name on PATH, with PATHEXT on Windows, and skips an unresolved candidate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "co-path-"));
  try {
    writeFileSync(join(dir, "claude"), "");
    writeFileSync(join(dir, "other.cmd"), "");
    assert.equal(await resolveOnPath("claude", { env: { PATH: dir }, platform: "linux" }), join(dir, "claude"));
    assert.equal(await resolveOnPath("other", { env: { PATH: dir, PATHEXT: ".EXE;.CMD" }, platform: "win32" }), join(dir, "other.cmd"));
    assert.equal(await resolveOnPath("missing", { env: { PATH: dir }, platform: "linux" }), null);
    let ran = false;
    const got = await readPlanUsage({ candidates: ["missing"], resolve: () => null, exec: () => { ran = true; } });
    assert.equal(got, null);
    assert.equal(ran, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
