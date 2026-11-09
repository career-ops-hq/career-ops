import assert from "node:assert/strict";
import { test } from "node:test";

// Imports the REAL implementation from src/lib/cli-pick.mjs. This suite used to
// hold a hand-copied mirror of pickSoleInstalled, which cannot fail when the
// real function changes -- exactly the drift that let the multi-CLI gap below
// go unnoticed.
import { keepIfInstalled, pickDefaultInstalled, pickSoleInstalled } from "../../src/lib/cli-pick.mjs";

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

test("pickSoleInstalled tolerates undefined and sparse entries", () => {
  assert.equal(pickSoleInstalled(undefined), null);
  assert.equal(pickSoleInstalled([null, { id: "codex", installed: true }]), "codex");
});

// --- pickDefaultInstalled: what Config renders, and therefore must persist ---

test("first installed CLI is the default at ANY installed count", () => {
  assert.equal(
    pickDefaultInstalled([
      { id: "claude", installed: true },
      { id: "codex", installed: true },
      { id: "gemini", installed: true },
    ]),
    "claude",
  );
});

test("the default skips CLIs that are not installed", () => {
  assert.equal(
    pickDefaultInstalled([
      { id: "claude", installed: false },
      { id: "codex", installed: true },
    ]),
    "codex",
  );
});

test("no installed CLI yields null, never an empty-string id", () => {
  assert.equal(pickDefaultInstalled([{ id: "claude", installed: false }]), null);
  assert.equal(pickDefaultInstalled([]), null);
  assert.equal(pickDefaultInstalled(undefined), null);
});

// The regression: a multi-CLI machine used to fall through the SOLE-install
// guard, so Config highlighted a CLI it never wrote. Every AI surface reads
// that key, so all of them silently did nothing.
test("multi-CLI machines get a persistable default, unlike pickSoleInstalled", () => {
  const clis = [
    { id: "claude", installed: true },
    { id: "codex", installed: true },
  ];
  assert.equal(pickSoleInstalled(clis), null, "sole-pick correctly declines");
  assert.equal(pickDefaultInstalled(clis), "claude", "but a default must still exist to persist");
});

// --- keepIfInstalled: a saved id is only kept while its CLI is installed (#4012) ---

test("keepIfInstalled keeps an installed id and drops an uninstalled or unknown one", () => {
  const clis = [
    { id: "claude", installed: true },
    { id: "opencode", installed: false },
  ];
  assert.equal(keepIfInstalled("claude", clis), "claude");
  assert.equal(keepIfInstalled("opencode", clis), null);
  assert.equal(keepIfInstalled("codex", clis), null);
});

test("keepIfInstalled tolerates empty ids, undefined lists and sparse entries", () => {
  assert.equal(keepIfInstalled("", [{ id: "", installed: true }]), null);
  assert.equal(keepIfInstalled("claude", undefined), null);
  assert.equal(keepIfInstalled("claude", [null, { id: "claude", installed: true }]), "claude");
});
