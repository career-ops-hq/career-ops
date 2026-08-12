import test from "node:test";
import assert from "node:assert/strict";
import { selectAssistantCli } from "../../src/lib/assistant-cli-selection.mjs";

const clis = [
  { id: "claude", installed: true },
  { id: "codex", installed: false },
];

test("keeps an installed saved CLI", () => {
  assert.equal(selectAssistantCli("claude", clis), "claude");
});

test("falls back to the first installed CLI when selection is missing or stale", () => {
  assert.equal(selectAssistantCli(null, clis), "claude");
  assert.equal(selectAssistantCli("codex", clis), "claude");
});

test("returns null when no CLI is installed", () => {
  assert.equal(selectAssistantCli(null, [{ id: "codex", installed: false }]), null);
});
