import test from "node:test";
import assert from "node:assert/strict";
import { parseLiveLog, deriveStatus, openQueue } from "../src/lib/auto-apply-live.mjs";

test("openQueue drops skipped postings and keeps approved or undecided ones", () => {
  const events = [{ type: "queue", url: "a" }, { type: "queue", url: "b" }, { type: "queue", url: "c" }, { type: "run_end" }];
  const decisions = [{ url: "a", decision: "skip" }, { url: "b", decision: "approve" }];
  assert.deepEqual(openQueue(events, decisions).map(x => x.url), ["b", "c"]);
});

test("parseLiveLog skips malformed lines", () => {
  assert.deepEqual(parseLiveLog('{"type":"run_start"}\nnope\n{"type":"run_end"}').map(x => x.type), ["run_start", "run_end"]);
});
test("deriveStatus distinguishes never, running and idle", () => {
  assert.equal(deriveStatus([], 1000).state, "never");
  const ts = new Date(1000).toISOString();
  assert.equal(deriveStatus([{ type: "run_start", ts }], 2000).state, "running");
  assert.equal(deriveStatus([{ type: "run_start", ts }, { type: "run_end", ts, submitted: 1 }], 2000).state, "idle");
  assert.equal(deriveStatus([{ type: "run_start", ts }], 122000).state, "idle");
});
