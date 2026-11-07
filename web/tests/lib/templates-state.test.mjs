import { test } from "node:test";
import assert from "node:assert/strict";
import { latestOnly, pendingAfterReload } from "../../src/lib/templates-state.mjs";

// The Templates section reloads its list after every change. These two pieces
// decide what a reload may do to the screen, so they are tested without React.

test("only the most recently started load may apply its result", () => {
  const guard = latestOnly();
  const first = guard();
  const second = guard();

  assert.equal(first(), false, "a load that a newer one has overtaken is stale");
  assert.equal(second(), true);
});

test("a load stays current until another one starts", () => {
  const guard = latestOnly();
  const only = guard();

  assert.equal(only(), true);
  assert.equal(only(), true);
});

test("a stopped guard makes every load stale, for an unmounted component", () => {
  const guard = latestOnly();
  const load = guard();

  guard.stop();

  assert.equal(load(), false);
});

test("a form stays open while its template is still in the reloaded list", () => {
  const pending = { name: "mine", mode: "rename" };

  assert.equal(pendingAfterReload(pending, [{ name: "mine" }, { name: "other" }]), pending);
});

test("a form is closed when the reload no longer lists its template", () => {
  assert.equal(pendingAfterReload({ name: "gone", mode: "delete" }, [{ name: "other" }]), null);
});

test("no open form stays no open form", () => {
  assert.equal(pendingAfterReload(null, [{ name: "mine" }]), null);
});
