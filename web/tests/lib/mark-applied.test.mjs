import { test } from "node:test";
import assert from "node:assert/strict";
import { markAppliedEnabled } from "../../src/lib/apply/mark-applied.mjs";

test("Mark applied is off while the form is loading", () => {
  for (const status of ["opening", "driving"]) {
    const gate = markAppliedEnabled({ status });
    assert.equal(gate.enabled, false, status);
    assert.equal(gate.reason, "reading");
    assert.match(gate.hint, /after the form finishes loading/);
  }
});

test("Mark applied is off after an error or a 404", () => {
  const error = markAppliedEnabled({ status: "error" });
  assert.equal(error.enabled, false);
  assert.equal(error.reason, "error");

  const missing = markAppliedEnabled({
    status: "ready",
    issues: [{ level: "block", code: "not-found" }],
  });
  assert.equal(missing.enabled, false);
  assert.equal(missing.reason, "error");
});

test("Mark applied is on once the form has loaded", () => {
  for (const status of ["ready", "prefilling", "filling", "done"]) {
    const gate = markAppliedEnabled({ status, issues: [] });
    assert.equal(gate.enabled, true, status);
    assert.equal(gate.reason, "ready");
  }
});
