// Exercise the same agent-text → outcome → persistence/stream boundaries as
// /api/run, with synthetic output and fake subprocesses only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { basename } from "node:path";
import { createReportEnvelopeFilter } from "../../src/lib/report-envelope.mjs";
import { evaluateRunOutcome, evaluationOutcomeEvent, persistEvaluation } from "../../src/lib/report-persist.mjs";
import { readJobStream } from "../../src/lib/job-stream.mjs";

const report = `<<report-md>>
# Evaluation: Fixture — Analyst

## Machine Summary
\`\`\`yaml
company: Fixture
role: Analyst
score: 4.2
via: null
\`\`\`

## A) Role Summary
Synthetic report.
<</report-md>>`;
const stopped = `Stopped before Block A.
needs_confirmation: dealbreaker "location" - rerun with "evaluate anyway" to evaluate
VERDICT: N/A/5 — The location conflicts with the candidate's rule.`;
const dedicated = `<<evaluation-gate>>
{"status":"needs_confirmation","reason":"agency_confirmation","message":"Confirm the intermediary."}
<</evaluation-gate>>
VERDICT: N/A/5 — Agency confirmation required.`;

async function replay(text, { cleanExit = true, sawError = false, noOutputMessage = null } = {}) {
  const filter = createReportEnvelopeFilter();
  const calls = [];
  const spawnFn = (_execPath, args) => {
    calls.push(basename(args[0]));
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write() {}, end() {} };
    queueMicrotask(() => {
      if (calls.at(-1) === "reserve-report-num.mjs" && args.length === 1) child.stdout.emit("data", "001\n");
      child.emit("close", 0);
    });
    return child;
  };
  const events = [];
  // A marker split at a transport chunk boundary must retain the same outcome.
  for (const chunk of [text.slice(0, 9), text.slice(9)]) {
    const visible = filter.push(chunk);
    if (visible) events.push({ type: "text", text: visible });
  }
  const tail = filter.flush(); if (tail) events.push({ type: "text", text: tail });
  if (sawError) events.push({ type: "error", msg: "Provider unavailable" });
  const envelope = filter.result();
  const outcome = evaluateRunOutcome({ envelope, text, cleanExit, sawError, noOutputMessage });
  const terminalEvent = evaluationOutcomeEvent(outcome, { tokens: 42, costUsd: 0.003 });
  if (outcome.ok) {
    const saved = await persistEvaluation({ spawnFn, execPath: process.execPath, root: "/synthetic-gated-evaluation", markdown: envelope.markdown, url: "https://example.invalid/fixture", today: "2026-11-04" });
    assert.equal(saved.ok, true);
    events.push({ type: "done", reportN: Number(saved.num) });
  } else events.push(terminalEvent);
  const stream = new ReadableStream({ start(controller) { for (const event of events) controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n")); controller.close(); } });
  return { outcome, calls, terminalEvent, completion: await readJobStream(stream, () => {}) };
}

test("a clean explicit stop reaches the client as gated and never touches artifact persistence", async () => {
  for (const text of [stopped, dedicated]) {
    const result = await replay(text);
    assert.equal(result.outcome.gated, true);
    assert.equal(result.completion.status, "gated");
    assert.equal(result.completion.reportN, undefined);
    assert.deepEqual(result.terminalEvent, { type: "gated", reason: result.outcome.reason, message: result.outcome.message, confirmationRequired: true, tokens: 42, costUsd: 0.003 });
    assert.equal(result.completion.tokens, 42);
    assert.equal(result.completion.costUsd, 0.003);
    assert.deepEqual(result.calls, []);
  }
});

test("process errors and absent output remain errors even after an explicit stop", async () => {
  for (const signals of [{ cleanExit: false }, { sawError: true }, { noOutputMessage: "CLI produced no output" }]) {
    const result = await replay(dedicated, signals);
    assert.equal(result.outcome.gated, undefined);
    assert.equal(result.completion.status, "error");
    assert.deepEqual(result.terminalEvent, { type: "error", msg: result.outcome.message });
    assert.deepEqual(result.calls, []);
  }
});

test("a stop before a scored report cannot allocate a number or write/merge artifacts", async () => {
  const result = await replay(`${dedicated}\n${report}\nVERDICT: 4.2/5 — Strong match.`);
  assert.equal(result.completion.status, "error");
  assert.match(result.completion.message, /both a report and a confirmation stop/);
  assert.deepEqual(result.calls, []);
});

test("a legacy stop after a report cannot allocate or persist artifacts", async () => {
  const result = await replay(`${report}\n${stopped}`);
  assert.equal(result.completion.status, "error");
  assert.match(result.completion.message, /both a report and a confirmation stop/);
  assert.deepEqual(result.calls, []);
});

test("a fenced dedicated example cannot hide a later stop from persistence", async () => {
  const result = await replay(`${report}\n\`\`\`text\n${dedicated}\n\`\`\`\n${stopped}`);
  assert.equal(result.completion.status, "error");
  assert.match(result.completion.message, /both a report and a confirmation stop/);
  assert.deepEqual(result.calls, []);
});

test("an info string cannot close an example and falsely block a valid report", async () => {
  const result = await replay(`${report}\n\`\`\`text\n${dedicated}\n\`\`\`yaml\n${stopped}`);
  assert.equal(result.completion.status, "done");
  assert.deepEqual(result.calls, ["reserve-report-num.mjs", "persist-evaluation-report.mjs", "merge-tracker.mjs", "reserve-report-num.mjs"]);
});

test("Unicode fence info cannot hide a terminal stop and authorize persistence", async () => {
  for (const separator of ["\u2028", "\u2029"]) {
    const result = await replay(`${report}\n\`\`\`text${separator}info\nExample data.\n\`\`\`\n${stopped}`);
    assert.equal(result.completion.status, "error");
    assert.match(result.completion.message, /both a report and a confirmation stop/);
    assert.deepEqual(result.calls, []);
  }
});

test("a bare-CR closing fence cannot hide a real stop and authorize persistence", async () => {
  for (const marker of ["```", "~~~~"]) {
    const result = await replay(`${report}\n${marker}text\r${marker}\n${stopped}`);
    assert.equal(result.completion.status, "error");
    assert.match(result.completion.message, /both a report and a confirmation stop/);
    assert.deepEqual(result.calls, []);
  }
});

test("a valid scored report still reaches real persistence once and returns its report number", async () => {
  const result = await replay(report);
  assert.equal(result.terminalEvent, null, "only successful persistence may declare report success");
  assert.deepEqual(result.completion, { status: "done", reportN: 1 });
  assert.deepEqual(result.calls, ["reserve-report-num.mjs", "persist-evaluation-report.mjs", "merge-tracker.mjs", "reserve-report-num.mjs"]);
});
