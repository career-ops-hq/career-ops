import { test } from "node:test";
import assert from "node:assert/strict";
import { latestOnly, loadFailureView, pendingAfterReload, settleChoice } from "../../src/lib/templates-state.mjs";

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

// Choosing a default: the order of apply -> reload, and when neither happens.
function choiceRun(save) {
  const calls = [];
  const on = {
    applied: () => calls.push("applied"),
    reload: () => calls.push("reload"),
    failed: (m) => calls.push(`failed:${m}`),
  };
  return { calls, done: settleChoice(save, on) };
}

test("a saved default is applied, and only then does a newer reload start", async () => {
  const { calls, done } = choiceRun(async () => ({ ok: true }));
  await done;

  assert.deepEqual(calls, ["applied", "reload"]);
});

test("a refused save reports its message and neither applies nor reloads", async () => {
  const { calls, done } = choiceRun(async () => ({ ok: false, error: "profile locked" }));
  await done;

  assert.deepEqual(calls, ["failed:profile locked"]);
});

test("a refused save without a message falls back to a generic one", async () => {
  const { calls, done } = choiceRun(async () => ({ ok: false }));
  await done;

  assert.deepEqual(calls, ["failed:Could not save."]);
});

test("a save that throws is a failure too, with no apply and no reload", async () => {
  const { calls, done } = choiceRun(async () => {
    throw new Error("network down");
  });
  await done;

  assert.deepEqual(calls, ["failed:Could not save."]);
});

// A failed reload hides the gallery only when the list on screen is not known to
// be right. After a saved default the list is already correct, so it stays.
test("a failed reload keeps a list that is already current and shows the error beside it", () => {
  assert.equal(loadFailureView(true, true), "alongside");
});

test("a failed reload replaces a list that a management change may have made stale", () => {
  assert.equal(loadFailureView(false, true), "replace");
});

test("a failed first load has no list to keep", () => {
  assert.equal(loadFailureView(true, false), "replace");
  assert.equal(loadFailureView(false, false), "replace");
});
