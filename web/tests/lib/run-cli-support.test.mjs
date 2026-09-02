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
  isFatalGenericStderr,
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

test("Codex usage subtracts cached input, the opposite of Claude's formula", () => {
  // Given: OpenAI's convention puts cached_input_tokens INSIDE input_tokens, so
  // input + output folds discounted cache reads back into a metric defined as
  // tokens billed at FULL rate — inflating Codex ~4.7x against Claude in the
  // very comparison people use to control cost (formula adapted from #2689).
  const event = parseCodexEvent(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 120, cached_input_tokens: 80, output_tokens: 30 },
  }));
  // Then: (120 − 80) + 30, and no invented cost — Codex reports none.
  assert.deepEqual(event, { tokens: 70, costUsd: null });
});

test("a real captured Codex turn reports full-rate tokens, not the raw input", () => {
  // Given: an actual codex-cli 0.146.0 turn (input 13956 / cached 11008 / output 44).
  const event = parseCodexEvent(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 13956, cached_input_tokens: 11008, output_tokens: 44 },
  }));
  assert.equal(event.tokens, 2992); // not 14000
});

test("fractional and non-finite usage figures are ignored, not counted", () => {
  // Given: a token count is a whole number, so anything else in a usage block is
  // junk from a malformed event and must not reach the running total.
  const event = parseCodexEvent(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 1.5, cached_input_tokens: 0, output_tokens: 10 },
  }));
  assert.deepEqual(event, { tokens: 10, costUsd: null });

  const claude = parseClaudeEvent(JSON.stringify({
    type: "result",
    usage: { input_tokens: 2.7, output_tokens: 10, cache_creation_input_tokens: 5 },
  }));
  assert.deepEqual(claude, { tokens: 15 });

  // And a non-finite figure, which needs RAW JSONL to construct: JSON.stringify
  // turns Infinity into null, so a fixture built the usual way silently tests
  // something else. `1e400` is how an overflow actually arrives on the wire.
  assert.deepEqual(
    parseCodexEvent('{"type":"turn.completed","usage":{"input_tokens":1e400,"output_tokens":10}}'),
    { tokens: 10, costUsd: null },
  );
  assert.deepEqual(
    parseClaudeEvent('{"type":"result","usage":{"input_tokens":1e400,"output_tokens":10}}'),
    { tokens: 10 },
  );
});

test("malformed Codex usage never reports negative tokens", () => {
  // Given: cached exceeding input can only come from a malformed block — the
  // clamp keeps a nonsense figure from becoming a negative one.
  const event = parseCodexEvent(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 10, cached_input_tokens: 999, output_tokens: 5 },
  }));
  assert.deepEqual(event, { tokens: 5, costUsd: null });
});

test("Codex turn.completed without usage is ignored, not zeroed", () => {
  const event = parseCodexEvent(JSON.stringify({ type: "turn.completed" }));
  assert.equal(event, null);
});

test("invalid and irrelevant Codex lines are ignored", () => {
  assert.equal(parseCodexEvent("not json"), null);
  assert.equal(parseCodexEvent('{"type":"item.completed","item":{"type":"command_execution"}}'), null);
});

test("a line that parses to a non-object is ignored, not thrown on", () => {
  // Given: JSON.parse("null") SUCCEEDS and yields null, so the try/catch around
  // the parse never fires and reading .type off it would throw out of the
  // parser and into the route's stdout handler. Same for bare scalars.
  for (const line of ["null", "42", '"a string"', "true", "[]"]) {
    assert.equal(parseCodexEvent(line), null, `codex: ${line}`);
    assert.equal(parseClaudeEvent(line), null, `claude: ${line}`);
  }
});

test("a null nested payload is survived, not thrown on", () => {
  // Given: the root guard above only covers a non-object ROOT. A well-formed
  // event can still carry a null where an object belongs, and reading through it
  // would throw past the parser into the route's stdout handler just the same.
  // The optional chaining that prevents this has no other coverage, so a
  // regression removing one `?.` would go unnoticed.
  assert.equal(parseCodexEvent('{"type":"item.started","item":null}'), null);
  assert.equal(parseCodexEvent('{"type":"item.completed","item":null}'), null);
  assert.equal(parseCodexEvent('{"type":"turn.completed","usage":null}'), null);
  assert.equal(parseClaudeEvent('{"type":"stream_event","event":null}'), null);
  assert.equal(parseClaudeEvent('{"type":"result","usage":null}'), null);

  // A null `error` still yields the default diagnostic rather than throwing —
  // the event announced a failure, so it must not be silently dropped.
  assert.deepEqual(parseCodexEvent('{"type":"error","error":null}'), { error: "Codex failed before finishing" });
});

test("an empty Codex agent message emits nothing", () => {
  // Given: emitting it would put a blank line in the run log and an extra
  // newline inside pdf mode's line-anchored envelope stream.
  const event = parseCodexEvent(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "" },
  }));
  assert.equal(event, null);
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

test("a terminal Claude result surfaces its diagnostic instead of a silent success", () => {
  // Given: is_error is the authoritative flag on a terminal result. Dropping it
  // left the gate inferring failure from the exit code alone — and a run that
  // failed while exiting 0 would then be banked as a confident score.
  const event = parseClaudeEvent(JSON.stringify({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "",
    error: "tool execution failed: permission denied",
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5 },
    total_cost_usd: 0.012,
  }));

  // Then: the diagnostic reaches the run log, AND the tokens and cost it burned
  // are still reported — a failed run costs real money. Asserting the cost here
  // pins it against a refactor that early-returns on the error and drops usage.
  assert.deepEqual(event, {
    tokens: 125,
    costUsd: 0.012,
    error: "tool execution failed: permission denied",
  });
});

test("a failed Claude result names the failure when it carries no diagnostic", () => {
  // Given: the real subtypes are error_max_turns / error_during_execution —
  // never a bare "error" — so the match is by prefix, and the subtype is the
  // last usable description when no error string is supplied.
  const event = parseClaudeEvent(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true }));
  assert.deepEqual(event, { error: "error_max_turns" });
});

test("a successful Claude result is never mistaken for a failure", () => {
  const event = parseClaudeEvent(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "VERDICT: 4.5/5 — strong fit",
    usage: { input_tokens: 10, output_tokens: 2 },
  }));
  assert.deepEqual(event, { tokens: 12 });
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

test("completedReportNames uses the shared predicate, so an unnumbered file is a real report", () => {
  // Given: only a NUMBERED sentinel comes from the reservation path. This is the
  // case where the two former copies of this convention disagreed — career-ops.ts
  // called it a real report, run-cli-support.mjs did not. One definition now.
  const names = completedReportNames(["notes-RESERVED.md", "030-RESERVED.md"]);
  assert.deepEqual([...names], ["notes-RESERVED.md"]);
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

test("the argv keeps --json and the parser reads the JSONL it turns on", () => {
  // Two halves of one contract, asserted separately BY NECESSITY: proving the
  // linkage for real would mean running codex, which a unit test cannot do. So
  // this pins each half — the flag that produces JSONL, and the parser that
  // reads codex's documented first event — and the name says exactly that
  // rather than claiming a round-trip it never performs.
  assert.ok(codexStreamArgs("p").includes("--json"));
  assert.deepEqual(parseCodexEvent(JSON.stringify({ type: "thread.started" })), { status: "Agent ready" });
});

// ── the fallback stderr classifier (#1974) ──────────────────────────────────
//
// Only claude and codex define `stderrIsFatal`, so six of the eight entries in
// KNOWN reach this path. It lived as an inline regex inside route.ts's stream
// closure, where nothing could assert it — which is how `auth` came to match
// inside "author" and a success message came to fail a run.

test("the fallback does not fail a run because a word appeared", () => {
  for (const line of [
    "Authentication successful",      // a SUCCESS message
    "Authorized to work in the US",
    "warning: no author found",       // "auth" inside "author"
    "fetching author metadata",
    "Errors: 0",
    "Logged in as santifer",
    "npm notice New minor version",
  ]) {
    assert.equal(isFatalGenericStderr(line), false, `benign line treated as fatal: ${line}`);
  }
});

test("the fallback still catches every real failure it caught before", () => {
  // Anchoring, not narrowing: this list must not shrink when the regex is edited.
  for (const line of [
    "Error: connection refused",
    "HTTP 401 unauthorized",
    "not authenticated",
    "authentication failed",
    "please log in",
    "invalid api key",
    "missing credentials",
    "quota exceeded",
    "rate limit hit",
    "permission denied",
    "fatal: not a git repository",
    "command not found",
  ]) {
    assert.equal(isFatalGenericStderr(line), true, `real failure no longer detected: ${line}`);
  }
});

// #3124: evaluate runs were killed at 285s (well under the 800s maxDuration) and
// the kill was then misreported as "didn't save a report", blaming the CLI for a
// limit the route imposed. These guard the budget and the honest message.
import { killMsForKind, timeoutMessage, RUN_MAX_DURATION_S } from "../../src/lib/run-cli-support.mjs";

test("evaluate's kill budget gives real headroom, not the old 285s floor (#3124)", () => {
  const ms = killMsForKind("evaluate");
  assert.ok(ms > 285_000, `evaluate must exceed the 285s that killed real runs, got ${ms}ms`);
  assert.ok(ms < RUN_MAX_DURATION_S * 1000, "must stay under maxDuration so the SIGTERM is graceful, not a hard cutoff");
  assert.equal(killMsForKind("pdf"), 600_000, "pdf keeps its post-agent render headroom");
  assert.equal(killMsForKind("fix-portal"), killMsForKind("evaluate"), "non-pdf kinds share the evaluate budget");
});

test("a timed-out run reads as a timeout, never as 'didn't save a report' (#3124)", () => {
  const msg = timeoutMessage(780_000, "evaluate");
  assert.match(msg, /780s time limit/, "the message names the limit it hit");
  assert.match(msg, /re-run|Claude Code/i, "it offers a next step");
  assert.doesNotMatch(msg, /didn't save a report/i, "a timeout must not be blamed on the CLI's ability to write");
});
