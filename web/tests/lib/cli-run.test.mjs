import assert from "node:assert/strict";
import test from "node:test";

import { parseKimiStreamLine, prepareRunArgs, runTimeoutMs } from "../../src/lib/cli-run.mjs";

test("adds Kimi's structured JSONL output flag without changing other CLIs", () => {
  const base = ["-p", "hello"];

  assert.deepEqual(prepareRunArgs("kimi", base), ["-p", "hello", "--output-format", "stream-json"]);
  assert.deepEqual(prepareRunArgs("codex", base), base);
  assert.deepEqual(base, ["-p", "hello"]);
});

test("gives Kimi evaluations enough time while preserving existing limits", () => {
  assert.equal(runTimeoutMs("evaluate", "kimi"), 600_000);
  assert.equal(runTimeoutMs("evaluate", "codex"), 285_000);
  assert.equal(runTimeoutMs("research", "kimi"), 285_000);
  assert.equal(runTimeoutMs("pdf", "kimi"), 600_000);
});

test("parses Kimi assistant text and tool calls", () => {
  const event = JSON.stringify({
    role: "assistant",
    content: "Checking the posting...",
    tool_calls: [{ function: { name: "Read", arguments: "{}" } }, { name: "Bash" }],
  });

  assert.deepEqual(parseKimiStreamLine(event), { text: "Checking the posting...", tools: ["Read", "Bash"] });
});

test("joins structured text content and ignores tool/meta records", () => {
  assert.deepEqual(
    parseKimiStreamLine(JSON.stringify({ role: "assistant", content: [{ type: "text", text: "one" }, { type: "text", text: " two" }] })),
    { text: "one two", tools: [] },
  );
  assert.equal(parseKimiStreamLine(JSON.stringify({ role: "tool", content: "large tool result" })), null);
  assert.equal(parseKimiStreamLine(JSON.stringify({ role: "meta", type: "session.resume_hint" })), null);
  assert.equal(parseKimiStreamLine("not json"), null);
});
