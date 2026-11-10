import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("the paste-a-job box stays on Today after setup", () => {
  const src = readFileSync(join(root, "src/components/home/today-dashboard.tsx"), "utf8");
  assert.match(src, /<QuickEvaluate \/>/);
  assert.doesNotMatch(src, /inBetween &&/);
});
