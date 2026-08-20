import assert from "node:assert/strict";
import { test } from "node:test";

// Mirror of pickSoleInstalled in src/lib/saved-cli.ts (TS; this suite is .mjs).
function pickSoleInstalled(clis) {
  const installed = (clis || []).filter((c) => c.installed);
  return installed.length === 1 ? installed[0].id : null;
}

test("sole installed CLI is the default", () => {
  assert.equal(
    pickSoleInstalled([
      { id: "claude", installed: false },
      { id: "grok", installed: true },
    ]),
    "grok",
  );
});

test("zero or two installed CLIs stay unset", () => {
  assert.equal(pickSoleInstalled([]), null);
  assert.equal(
    pickSoleInstalled([
      { id: "claude", installed: true },
      { id: "grok", installed: true },
    ]),
    null,
  );
});
