import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/assistant-console.tsx"),
  "utf8",
);

test("the assistant detects installed CLIs and persists a usable first-run default", () => {
  assert.match(src, /fetch\("\/api\/clis"\)/);
  assert.match(src, /pickDefaultInstalled\(list\)/);
  assert.match(src, /persistCliId\(next\)/);
});

test("the assistant exposes the installed CLI selector directly", () => {
  assert.match(src, /aria-label="Agente de IA"/);
  assert.match(src, /availableClis\.map/);
  assert.match(src, /onChange=\{\(event\) => chooseCli\(event\.target\.value\)\}/);
});
