// A stale refusal must leave the selector showing the status the ROW holds,
// not the one the picker displayed before the save.
//
// The sync effect skips setStatus while a save is in flight, so a `current`
// that changes mid-save never reaches the selector. On a stale refusal the
// router.refresh() then returns that same `current`, the effect's dependency
// does not change, and it never runs again — so reverting to `prev` leaves the
// selector disagreeing with the row until a manual reload. In inline mode
// `prev` IS the stale `current` captured at onChange, which is precisely the
// value known to be wrong on this path.
//
// Source assertions, matching the convention of status-select-applied.test.mjs:
// this component has no render harness in the suite, so these prove the code
// says the right thing, not that React behaves this way at runtime.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/status-select.tsx"),
  "utf8",
);

test("the latest row status is tracked even while a save is in flight", () => {
  const effectAt = src.indexOf("useEffect(() => {");
  const effectEnd = src.indexOf("}, [current]");
  assert.ok(effectAt !== -1 && effectEnd > effectAt, "the [current] sync effect must exist");
  const effect = src.slice(effectAt, effectEnd);

  assert.match(
    effect,
    /latestCurrent\.current = current/,
    "the effect must record `current` in a ref",
  );

  // The record must happen BEFORE the saving guard, or it is skipped during
  // exactly the save whose refusal needs it.
  const recordAt = effect.indexOf("latestCurrent.current = current");
  const guardAt = effect.indexOf("if (!saving.current)");
  assert.ok(guardAt !== -1, "the saving guard must still be there");
  assert.ok(
    recordAt < guardAt,
    "the ref must be updated before the `if (!saving.current)` guard, not inside it",
  );
});

test("a stale refusal reverts to the row's status, other failures to the previous one", () => {
  const catchAt = src.indexOf("} catch (cause) {");
  assert.ok(catchAt !== -1, "the save failure handler must exist");
  const handler = src.slice(catchAt);

  const revert = handler.match(/setStatus\((.*)\); \/\/ revert on failure/);
  assert.ok(revert, "the failure handler must still revert the selector");
  assert.match(
    revert[1],
    /isStaleRowError\(cause\)/,
    "the revert must branch on isStaleRowError",
  );
  assert.match(
    revert[1],
    /latestCurrent\.current/,
    "a stale refusal must revert to the tracked row status",
  );
  assert.match(revert[1], /prev/, "every other failure must still revert to prev");
});
