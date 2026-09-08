import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "lib", "core", "safe-write.ts");
const src = readFileSync(SRC, "utf8");

test("atomicWrite cleans up and rethrows when the write or rename fails", () => {
  assert.match(src, /try\s*\{\s*fs\.writeFileSync\(tmp, content, "utf8"\);\s*fs\.renameSync\(tmp, file\);\s*\}\s*catch \(err\)\s*\{[\s\S]*?fs\.rmSync\(tmp, \{ force: true \}\);[\s\S]*?throw err;/s);
});

test("atomicWrite uses the canonical hidden temporary-file shape", () => {
  assert.match(src, /`\.\$\{path\.basename\(file\)\}\.\$\{process\.pid\}\.\$\{Date\.now\(\)\}\.\$\{randomUUID\(\)\}\.tmp`/);
  assert.match(src, /path\.join\(\s*path\.dirname\(file\),/s);
});
