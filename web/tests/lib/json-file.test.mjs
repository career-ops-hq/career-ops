// Run:  node --test tests/lib/json-file.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonFile } from "../../src/lib/json-file.mjs";

test("readJsonFile: missing file -> fallback; broken file throws", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "json-file-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, "x.json");
  assert.deepEqual(readJsonFile(f, { d: 1 }), { d: 1 });
  fs.writeFileSync(f, "{ broken");
  assert.throws(() => readJsonFile(f, null), SyntaxError);
});
