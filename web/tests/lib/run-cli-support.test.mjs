// Tests for the per-CLI stream parsers and run bookkeeping helpers, using
// Node's built-in test runner. Imports directly from run-cli-support.mjs (the
// single source of truth) so the test and production code can never drift.
//
// Each case reads Given (the raw CLI line / listing) → When (parse it) → Then
// (the dashboard event it must become).
//
// Run:  node --test tests/lib/run-cli-support.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accumulateTokens,
  codexStreamArgs,
  completedReportNames,
  hasNewCompletedReport,
  isFatalClaudeStderr,
  isFatalCodexStderr,
  parseClaudeEvent,
  parseCodexEvent,
} from "../../src/lib/run-cli-support.mjs";
import { createCvEnvelopeFilter } from "../../src/lib/cv-envelope.mjs";

test("Codex agent message becomes dashboard text, newline-terminated", () => {
  // Given: Codex sends complete messages with NO trailing newline ("hello", not
  // "hello\n"), so without termination consecutive messages glue mid-line —
  // which runs narration together in the log and breaks the line-anchored
  // <<cv-html>> markers in pdf mode.
  const event = parseCodexEvent(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "VERDICT: 4.2/5 — strong fit" },
  }));
  assert.deepEqual(event, { text: "VERDICT: 4.2/5 — strong fit\n" });
});

test("an already newline-terminated Codex message gains no second newline", () => {
  const event = parseCodexEvent(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "done\n" },
  }));
  assert.deepEqual(event, { text: "done\n" });
});

test("a cv envelope in its own Codex message survives preceding narration", () => {
  // Given: the real pdf-mode failure — narration in one agent_message (no
  // trailing newline), the envelope in the next. Unterminated, the opener lands
  // mid-line and the fail-closed parser reports "no envelope" for a run whose
  // CV was fully emitted.
  const narration = parseCodexEvent(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "Tailoring done, emitting the envelope." },
  }));
  const envelope = parseCodexEvent(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: '<<cv-html format="a4">>\n<!DOCTYPE html><html><body>CV</body></html>\n<</cv-html>>' },
  }));

  // When: both flow through the same filter the route feeds via sendAgentText.
  const filter = createCvEnvelopeFilter();
  filter.push(narration.text);
  filter.push(envelope.text);
  filter.flush();

  // Then: the envelope parses — the run's CV is recovered, not refused.
  const result = filter.result();
  assert.equal(result.ok, true);
  assert.equal(result.format, "a4");
  assert.match(result.html, /<\/html>/);
});

test("Codex turn.started maps to a kind-agnostic working status", () => {
  // Given: the parser serves every run kind (evaluate, pdf, research), so the
  // status must not claim one of them — "Evaluating the role" showed on CV PDF runs.
  const event = parseCodexEvent(JSON.stringify({ type: "turn.started" }));
  assert.deepEqual(event, { status: "Agent working" });
});

test("Codex usage becomes a token count", () => {
  const event = parseCodexEvent(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 120, cached_input_tokens: 80, output_tokens: 30 },
  }));
  assert.deepEqual(event, { tokens: 150 });
});

test("Codex turn.completed without usage is ignored, not zeroed", () => {
  const event = parseCodexEvent(JSON.stringify({ type: "turn.completed" }));
  assert.equal(event, null);
});

test("invalid and irrelevant Codex lines are ignored", () => {
  assert.equal(parseCodexEvent("not json"), null);
  assert.equal(parseCodexEvent('{"type":"item.completed","item":{"type":"command_execution"}}'), null);
});

test("a syntactically-valid but unrecognized Codex event type is ignored", () => {
  assert.equal(parseCodexEvent(JSON.stringify({ type: "session.diff" })), null);
});

test("Codex item.started maps command_execution to the Bash tool", () => {
  const event = parseCodexEvent(JSON.stringify({ type: "item.started", item: { type: "command_execution" } }));
  assert.deepEqual(event, { tool: "Bash" });
});

test("Codex item.started maps web_search to the WebSearch tool", () => {
  const event = parseCodexEvent(JSON.stringify({ type: "item.started", item: { type: "web_search" } }));
  assert.deepEqual(event, { tool: "WebSearch" });
});

test("Codex item.started maps a named mcp_tool_call to its tool name", () => {
  const event = parseCodexEvent(JSON.stringify({ type: "item.started", item: { type: "mcp_tool_call", tool: "reserve-report-num" } }));
  assert.deepEqual(event, { tool: "reserve-report-num" });
});

test("Codex item.started falls back to Working for an unnamed mcp_tool_call", () => {
  const event = parseCodexEvent(JSON.stringify({ type: "item.started", item: { type: "mcp_tool_call" } }));
  assert.deepEqual(event, { tool: "Working" });
});

test("Codex turn.failed extracts the error.message", () => {
  const event = parseCodexEvent(JSON.stringify({ type: "turn.failed", error: { message: "model unavailable" } }));
  assert.deepEqual(event, { error: "model unavailable" });
});

test("Codex error event falls back to a top-level message", () => {
  const event = parseCodexEvent(JSON.stringify({ type: "error", message: "connection reset" }));
  assert.deepEqual(event, { error: "connection reset" });
});

test("Codex error event with no message uses the default fallback", () => {
  const event = parseCodexEvent(JSON.stringify({ type: "error" }));
  assert.deepEqual(event, { error: "Codex failed before finishing" });
});

test("a transient Codex reconnect notice is progress, not a run failure", () => {
  // Given: Codex emits `error`-type events for conditions it recovers from, then
  // completes the turn — treating one as fatal fails a run that actually worked.
  const event = parseCodexEvent(JSON.stringify({ type: "error", message: "Reconnecting... (attempt 1)" }));
  // Then: reported as a status, so the caller never sets sawError.
  assert.deepEqual(event, { status: "Reconnecting…" });
});

test("a terminal turn.failed stays an error even when it mentions reconnecting", () => {
  // Given: turn.failed is terminal by definition — the reconnect wording must not
  // launder a genuine failure into a status.
  const event = parseCodexEvent(JSON.stringify({ type: "turn.failed", error: { message: "gave up reconnecting" } }));
  assert.deepEqual(event, { error: "gave up reconnecting" });
});

test("benign Codex stderr diagnostics are not fatal", () => {
  assert.equal(isFatalCodexStderr("ERROR codex_models_manager::cache: failed to load models cache: schema mismatch"), false);
});

test("Codex auth-failure stderr phrases are fatal", () => {
  assert.equal(isFatalCodexStderr("Error: unauthorized"), true);
  assert.equal(isFatalCodexStderr("please log in to continue"), true);
  assert.equal(isFatalCodexStderr("credential file missing"), true);
  assert.equal(isFatalCodexStderr("403 forbidden"), true);
  assert.equal(isFatalCodexStderr("not authenticated"), true);
  assert.equal(isFatalCodexStderr("sign in required"), true);
});

test("Codex quota/rate-limit stderr is fatal", () => {
  assert.equal(isFatalCodexStderr("Error: quota exceeded"), true);
  assert.equal(isFatalCodexStderr("429 rate limit hit"), true);
});

test("a self-retrying rate-limit stderr line is transient, not fatal", () => {
  // Given: the CLI announces it is handling the 429 itself — the run can still
  // complete cleanly, and flagging it fatal re-creates the false-red the
  // narrow classifier exists to remove (#2085).
  assert.equal(isFatalCodexStderr("429 rate limit hit, retrying in 2s..."), false);
  assert.equal(isFatalClaudeStderr("rate limited, will retry"), false);
});

test("an auth failure stays fatal even when it mentions retrying", () => {
  // Given: auth never heals by retrying, so the transient carve-out must not
  // apply to it.
  assert.equal(isFatalCodexStderr("unauthorized — please log in and retry"), true);
  assert.equal(isFatalClaudeStderr("Invalid API key · Please run /login and retry"), true);
});

test("terminal retry wording does not trigger the transient carve-out", () => {
  // Given: only a retry the CLI announces as IN PROGRESS is transient — wording
  // that says retrying is over or pointless is a real failure.
  assert.equal(isFatalCodexStderr("quota exceeded — do not retry"), true);
  assert.equal(isFatalCodexStderr("rate limit: retry limit exhausted"), true);
});

test("a benign Claude stderr line mentioning an error is not fatal", () => {
  // Given: the generic fallback regex matches a bare "error", which fails a run
  // over any diagnostic that merely says the word — the same false positive the
  // Codex classifier exists to avoid.
  assert.equal(isFatalClaudeStderr("(node:5) Warning: error handler already attached"), false);
});

test("Claude auth and quota stderr phrases are fatal", () => {
  assert.equal(isFatalClaudeStderr("Invalid API key · Please run /login"), true);
  assert.equal(isFatalClaudeStderr("Credit balance is too low"), true);
  assert.equal(isFatalClaudeStderr("Usage limit reached — resets at 4pm"), true);
  // The auth/quota vocabulary shared with every other CLI still applies.
  assert.equal(isFatalClaudeStderr("401 unauthorized"), true);
  assert.equal(isFatalClaudeStderr("rate limit exceeded"), true);
});

test("Claude tool_use stream event becomes a dashboard tool", () => {
  const event = parseClaudeEvent(JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_start", content_block: { type: "tool_use", name: "WebFetch" } },
  }));
  assert.deepEqual(event, { tool: "WebFetch" });
});

test("Claude text delta becomes dashboard text", () => {
  const event = parseClaudeEvent(JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { text: "Evaluating..." } },
  }));
  assert.deepEqual(event, { text: "Evaluating..." });
});

test("Claude system init becomes the ready status", () => {
  const event = parseClaudeEvent(JSON.stringify({ type: "system", subtype: "init" }));
  assert.deepEqual(event, { status: "Agent ready" });
});

test("Claude result usage becomes tokens + cost", () => {
  const event = parseClaudeEvent(JSON.stringify({
    type: "result",
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5 },
    total_cost_usd: 0.012,
  }));
  assert.deepEqual(event, { tokens: 125, costUsd: 0.012 });
});

test("Claude result without usage is ignored, not zeroed", () => {
  const event = parseClaudeEvent(JSON.stringify({ type: "result" }));
  assert.equal(event, null);
});

test("invalid and irrelevant Claude lines are ignored", () => {
  assert.equal(parseClaudeEvent("not json"), null);
  assert.equal(parseClaudeEvent('{"type":"stream_event","event":{"type":"content_block_stop"}}'), null);
});

test("a syntactically-valid but unrecognized Claude event type is ignored", () => {
  assert.equal(parseClaudeEvent(JSON.stringify({ type: "assistant" })), null);
});

test("accumulateTokens sums across multiple turns instead of overwriting", () => {
  let total = 0;
  total = accumulateTokens(total, { tokens: 100 });
  total = accumulateTokens(total, { tokens: 50 });
  assert.equal(total, 150);
});

test("accumulateTokens ignores events without a token count", () => {
  assert.equal(accumulateTokens(120, { status: "Evaluating the role" }), 120);
});

test("accumulateTokens ignores a null event (unparseable or unrecognized line)", () => {
  assert.equal(accumulateTokens(120, null), 120);
});

test("completedReportNames filters out RESERVED sentinels", () => {
  const names = completedReportNames(["020-existing.md", "021-RESERVED.md", "readme.txt"]);
  assert.deepEqual([...names].sort(), ["020-existing.md"]);
});

test("replacing a reservation with a report counts as persistence", () => {
  // Given: reserve-report-num.mjs wrote 021-RESERVED.md, which the finished report
  // then REPLACED — so the .md count never changed and a count-delta gate reported
  // "didn't save a report" for an evaluation that saved fine (#2085).
  const before = ["020-existing.md", "021-RESERVED.md"];
  assert.equal(hasNewCompletedReport(before, ["020-existing.md", "021-new-company.md"]), true);
});

test("reservation churn alone does not count as persistence", () => {
  const before = ["020-existing.md", "021-RESERVED.md"];
  assert.equal(hasNewCompletedReport(before, ["020-existing.md", "022-RESERVED.md"]), false);
});

test("codexStreamArgs turns on the JSONL that parseCodexEvent reads", () => {
  // Given/When: the structured-stream argv for a prompt. This is the invocation
  // /api/run uses; CliSpec.args stays plain `["exec", prompt]` because every other
  // surface reads codex's stdout as raw text (envelopes, the planners' JSON array),
  // and JSONL there would corrupt all of them.
  const args = codexStreamArgs("PROMPT");

  // Then: --json produces the events, --color never keeps ANSI out of the strings,
  // and the prompt stays last (a positional, not a flag value).
  assert.deepEqual(args, ["exec", "--json", "--color", "never", "PROMPT"]);
});

test("a codexStreamArgs run's first event is parseable by parseCodexEvent", () => {
  // Given: the argv above, whose whole purpose is that its output parses. Guards the
  // pairing: a change to one of the two must not silently outlive the other.
  assert.ok(codexStreamArgs("p").includes("--json"));
  // When/Then: the JSONL that argv produces maps to a dashboard status.
  assert.deepEqual(parseCodexEvent(JSON.stringify({ type: "thread.started" })), { status: "Agent ready" });
});
