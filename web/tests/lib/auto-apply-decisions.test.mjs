import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeDecision, saveDecision, validateDecisionRequest } from "../../src/lib/auto-apply-decisions.mjs";

test("rejects decision values outside approve and skip", () => {
  assert.throws(() => validateDecisionRequest({ url: "https://jobs.example/1", decision: "submit" }, new Set(["https://jobs.example/1"])), /Decision must/);
});

test("rejects a URL not present in the current queue", () => {
  assert.throws(() => validateDecisionRequest({ url: "https://jobs.example/2", decision: "approve" }, new Set(["https://jobs.example/1"])), /not in the current queue/);
});

test("last decision wins for a URL", () => {
  const merged = mergeDecision([{ url: "u", decision: "approve", ts: "one" }], { url: "u", decision: "skip", ts: "two" });
  assert.deepEqual(merged, [{ url: "u", decision: "skip", ts: "two" }]);
});

test("atomic write failure leaves no partial decisions file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-auto-apply-decisions-"));
  try {
    fs.mkdirSync(path.join(root, "output"), { recursive: true });
    fs.writeFileSync(path.join(root, "output/auto-apply"), "blocks directory creation");
    assert.throws(() => saveDecision(root, { url: "https://jobs.example/1", decision: "approve" }));
    assert.equal(fs.existsSync(path.join(root, "output/auto-apply/decisions.json")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
