import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");

function run(payload) {
  const dir = mkdtempSync(join(tmpdir(), "co-cv-payload-"));
  const input = join(dir, "payload.json");
  const output = join(dir, "cv.html");
  writeFileSync(input, JSON.stringify(payload));
  const result = spawnSync(process.execPath, [join(ROOT, "build-cv-html.mjs"), input, output], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return { dir, output, result };
}

test("build-cv-html rejects missing core fields before writing HTML", () => {
  const cases = [
    [{}, /candidate must be an object/i],
    [{ candidate: {} }, /candidate\.name is required/i],
    [{ candidate: { name: "Jane" } }, /summary is required/i],
  ];

  for (const [payload, message] of cases) {
    const { dir, output, result } = run(payload);
    try {
      assert.notEqual(result.status, 0, JSON.stringify(payload));
      assert.match(result.stderr, message);
      assert.equal(existsSync(output), false, "invalid payload must not leave HTML behind");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("build-cv-html accepts the minimal valid payload with optional sections omitted", () => {
  const { dir, output, result } = run({ candidate: { name: "Jane" }, summary: "Builder" });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(output), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
