import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/status-select.tsx"),
  "utf8",
);

test("an external status change closes the Applied prompt when no save is in progress", () => {
  const effectAt = src.indexOf("if (!saving.current)");
  const effectEnd = src.indexOf("}, [current]");
  assert.ok(effectAt !== -1 && effectEnd > effectAt);
  const effect = src.slice(effectAt, effectEnd);
  assert.match(effect, /setStatus\(current\)/);
  assert.match(effect, /setPendingApplied\(false\)/);
});
