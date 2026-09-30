// opencode-stream.test.mjs — opencode's worker NDJSON contract.
//
// Every fixture here is a real `opencode run --format json` event captured
// against this repo, not a shape invented for the test. The two-step run is the
// one that caught the token bug: 10278 then 11352, true total 21630.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  opencodeStreamMeta,
  opencodeStreamText,
  opencodeWorkerArgs,
  usesOpencodeNdjson,
} from "../../src/lib/opencode-stream.mjs";

const stepStart = { type: "step_start", sessionID: "ses_1", part: { type: "step-start", id: "prt_a" } };
const textEvent = { type: "text", sessionID: "ses_1", part: { type: "text", text: "OK", time: { start: 1, end: 2 } } };
const toolEvent = {
  type: "tool_use",
  sessionID: "ses_1",
  part: {
    type: "tool",
    tool: "read",
    callID: "81866c2f",
    state: { status: "completed", input: { filePath: "/tmp/opencode" }, output: "<path/>", title: "tmp/opencode" },
  },
};
const finish = (total, cost) => ({
  type: "step_finish",
  sessionID: "ses_1",
  part: { type: "step-finish", reason: "stop", tokens: { total, input: total, output: 1, reasoning: 0, cache: { write: 0, read: 0 } }, cost },
});

test("NDJSON is opt-in for the worker surface only", () => {
  assert.equal(usesOpencodeNdjson("opencode", "worker"), true);
  assert.equal(usesOpencodeNdjson("opencode", "default"), false, "assistant + cv/ingest must stay on raw stdout");
  assert.equal(usesOpencodeNdjson("claude", "worker"), false, "claude is handled by cli-stream's own branch");
  assert.equal(usesOpencodeNdjson("codex", "worker"), false);
});

test("cv/ingest PDF capability gate is unchanged", () => {
  // cv/ingest rejects PDF/DOCX upload when !usesStreamJson(cliId). Because the
  // opencode opt-in is surface-gated, the default surface still reads false, so
  // opencode keeps getting the clean 400 rather than a /tmp permission failure.
  assert.equal(usesOpencodeNdjson("opencode") === false, true);
});

test("worker args request NDJSON", () => {
  assert.deepEqual(opencodeWorkerArgs("PROMPT"), ["run", "PROMPT", "--format", "json"]);
});

test("text events carry whole parts, not deltas", () => {
  assert.equal(opencodeStreamText(textEvent), "OK");
  assert.equal(opencodeStreamText(stepStart), null);
  assert.equal(opencodeStreamText(toolEvent), null, "a tool event is not prose");
  assert.equal(opencodeStreamText({ type: "text", part: { type: "text" } }), null, "no text field → null, not empty string");
  assert.equal(opencodeStreamText({ type: "text" }), null, "no part at all");
});

test("tool events use the raw tool name, never the title", () => {
  const meta = opencodeStreamMeta(toolEvent);
  assert.equal(meta.toolName, "read");
  assert.equal(
    "title" in meta,
    false,
    "part.state.title carries file paths and must not reach the card",
  );
});

test("step_finish reports tokens as a DELTA, not a replacement", () => {
  const m = opencodeStreamMeta(finish(11352, 0));
  assert.equal(m.tokens, 11352);
  assert.equal(m.tokensMode, "delta");
});

test("per-step deltas must be summed, not overwritten", () => {
  // The bug this guards: a 2-step run emitting 10278 then 11352. Overwriting
  // with the last event reports 11352 and under-counts every real evaluation.
  let lastTokens = 0;
  for (const total of [10278, 11352]) {
    const meta = opencodeStreamMeta(finish(total, 0));
    if (meta.tokens != null) {
      lastTokens = meta.tokensMode === "delta" ? lastTokens + meta.tokens : meta.tokens;
    }
  }
  assert.equal(lastTokens, 21630);
});

test("a single-step run is unaffected by delta mode", () => {
  let lastTokens = 0;
  const meta = opencodeStreamMeta(finish(16005, 0));
  lastTokens = meta.tokensMode === "delta" ? lastTokens + meta.tokens : meta.tokens;
  assert.equal(lastTokens, 16005);
});

test("cost 0 is omitted, never rendered as $0.00", () => {
  assert.equal("costUsd" in opencodeStreamMeta(finish(100, 0)), false);
});

test("a real cost is surfaced", () => {
  const meta = opencodeStreamMeta({ ...finish(100, 0), part: { ...finish(100, 0).part, cost: 0.000115 } });
  assert.equal(meta.costUsd, 0.000115);
});

test("step_start emits no status (it fires per step, not per init)", () => {
  assert.equal(opencodeStreamMeta(stepStart), null, "else every turn adds a duplicate 'Agent ready' chip");
});

test("unknown and malformed events degrade to null, never throw", () => {
  for (const obj of [{}, { type: "nope" }, { type: "step_finish" }, { type: "step_finish", part: {} }]) {
    assert.equal(opencodeStreamMeta(obj), null);
    assert.equal(opencodeStreamText(obj), null);
  }
});

test("a truncated stream loses tokens but never corrupts them", () => {
  // Killed mid-run: no step_finish at all. lastTokens stays 0, and the route's
  // non-clean-exit path already refuses to call that a confident result.
  let lastTokens = 0;
  for (const ev of [stepStart, toolEvent]) {
    const meta = opencodeStreamMeta(ev);
    if (meta?.tokens != null) lastTokens += meta.tokens;
  }
  assert.equal(lastTokens, 0);
});
