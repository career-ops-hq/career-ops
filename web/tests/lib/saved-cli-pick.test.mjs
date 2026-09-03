import assert from "node:assert/strict";
import { test } from "node:test";

// Imports the REAL picker (src/lib/cli-pick.mjs). This suite used to hand-copy
// the function body, which meant it could not fail when the implementation
// changed — exactly how the multi-install regression below went unnoticed.
import { pickDefaultCli } from "../../src/lib/cli-pick.mjs";

test("sole installed CLI is the default", () => {
  assert.equal(
    pickDefaultCli([
      { id: "claude", installed: false },
      { id: "grok", installed: true },
    ]),
    "grok",
  );
});

test("nothing installed has no default", () => {
  assert.equal(pickDefaultCli([]), null);
  assert.equal(pickDefaultCli(undefined), null);
  assert.equal(
    pickDefaultCli([
      { id: "claude", installed: false },
      { id: "grok", installed: false },
    ]),
    null,
  );
});

// The regression. Config renders `c.id === cliId` as selected and persists that
// same id; a picker returning null here would leave the page showing a
// highlighted CLI while every consumer read an empty localStorage key, and each
// CLI-backed job failed with "connect your CLI" on an apparently configured
// machine.
test("several installed CLIs still resolve to a default", () => {
  assert.equal(
    pickDefaultCli([
      { id: "claude", installed: true },
      { id: "codex", installed: true },
      { id: "gemini", installed: true },
    ]),
    "claude",
  );
});

// Callers pass /api/clis output, which preserves KNOWN order (Claude first), so
// "first installed" resolves to the most-audited runtime available rather than
// an arbitrary one. Order is load-bearing, not incidental.
test("default follows list order, skipping uninstalled entries", () => {
  assert.equal(
    pickDefaultCli([
      { id: "claude", installed: false },
      { id: "codex", installed: true },
      { id: "gemini", installed: true },
    ]),
    "codex",
  );
});

// `installed` is optional in the type; a missing flag must not count as present.
test("absent installed flag is not treated as installed", () => {
  assert.equal(pickDefaultCli([{ id: "claude" }, { id: "codex", installed: true }]), "codex");
});
