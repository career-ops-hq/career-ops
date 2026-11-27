import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { scheduledScansBody } from "../../src/lib/scheduled-scans-phase.mjs";

const view = readFileSync(new URL("../../src/components/scheduled-jobs-view.tsx", import.meta.url), "utf8");

test("scheduled scans shows loading and load errors instead of the empty create state", () => {
  assert.equal(scheduledScansBody("loading", 0), "loading");
  assert.equal(scheduledScansBody("error", 0), "error");
  assert.equal(scheduledScansBody("ready", 0), "empty");
  assert.equal(scheduledScansBody("loading", 2), "list");
  assert.equal(scheduledScansBody("error", 2), "list");
  assert.match(view, /useState<"loading" \| "ready" \| "error">\("loading"\)/);
  assert.match(view, /Loading scheduled scans…/);
  assert.match(view, /scheduledScansBody\(phase, store\.jobs\.length\) === "loading"/);
  assert.match(view, /scheduledScansBody\(phase, store\.jobs\.length\) === "error"/);
});
