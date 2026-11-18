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

test("choosing Rejected asks for a re-apply cooldown before saving", () => {
  const changeAt = src.indexOf("async function onChange");
  const change = src.slice(changeAt, src.indexOf("async function confirmApplied"));
  assert.match(change, /next === "Rejected"/);
  assert.match(change, /setPendingRejected\(true\)/);
  assert.match(src, /data-status-cooldown=""/);
  assert.match(src, /No cooldown/);
  // Both answers save the status; only one sends a cooldown.
  const confirm = src.slice(src.indexOf("async function confirmRejected"), src.indexOf("const shown ="));
  assert.match(confirm, /commitChange\("Rejected", prev, hadFocus, withCooldown \?/);
});

test("an external status change closes the cooldown prompt too", () => {
  const effect = src.slice(src.indexOf("if (!saving.current)"), src.indexOf("}, [current]"));
  assert.match(effect, /setPendingRejected\(false\)/);
});
