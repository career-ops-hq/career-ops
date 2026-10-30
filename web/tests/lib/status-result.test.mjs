import assert from "node:assert/strict";
import { test } from "node:test";
import { statusWriteError } from "../../src/lib/home/status-result.mjs";

test("only a confirmed save of the requested status can dismiss a decision", () => {
  for (const status of ["Applied", "Discarded"]) {
    assert.equal(statusWriteError(true, { ok: true, status }, status), null);
    // An idempotent retry still confirms that the desired status is saved.
    assert.equal(statusWriteError(true, { ok: true, status, changed: false }, status), null);
    assert.equal(typeof statusWriteError(false, { ok: true, status }, status), "string");
  }
});

test("server rejections retain the reason needed to retry or correct a write", () => {
  for (const error of ["Tracker is busy. Retry shortly.", "Tracker row not found.", "Status update timed out; the change may or may not have been applied."]) {
    assert.equal(statusWriteError(false, { error }, "Applied"), error);
  }
});

test("unconfirmed and mismatched results cannot silently remove a card", () => {
  for (const result of [null, {}, { ok: false }, { ok: true }, { ok: true, status: "Discarded" }, { error: "" }]) {
    assert.match(statusWriteError(true, result, "Applied"), /Could not confirm the change/);
  }
});
