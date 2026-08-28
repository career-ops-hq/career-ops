import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pass, fail, ROOT, rmSync } from "./helpers.mjs";

function check(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

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

for (const [label, payload, message] of [
  ["missing candidate", {}, /candidate must be an object/i],
  ["missing candidate.name", { candidate: {} }, /candidate\.name is required/i],
  ["missing summary", { candidate: { name: "Jane" } }, /summary is required/i],
]) {
    const { dir, output, result } = run(payload);
    try {
      check(result.status !== 0, `build-cv-html rejects ${label}`);
      check(message.test(result.stderr), `${label} reports the required field`);
      check(!existsSync(output), `${label} leaves no HTML behind`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

{
  const { dir, output, result } = run({ candidate: { name: "Jane" }, summary: "Builder" });
  try {
    check(result.status === 0, `build-cv-html accepts a minimal valid payload${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
    check(existsSync(output), "minimal valid payload writes HTML");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
