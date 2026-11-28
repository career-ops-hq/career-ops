import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, classifySession, costUsd, summarizeSession, usageParts } from "../../src/lib/usage-report.mjs";

const line = (o) => JSON.stringify(o);

test("classifies sessions by their first prompt", () => {
  assert.equal(classifySession("Process this job offer in single-pass CV match mode.", "sdk-cli"), "batch");
  assert.equal(classifySession("You are running the OFFICIAL career-ops job evaluation, HEADLESS", "sdk-cli"), "evaluation");
  assert.equal(classifySession("You are the career-ops assistant. You can make a PDF.", "sdk-cli"), "assistant");
  assert.equal(classifySession("Write a cover letter for this role", "sdk-cli"), "documents");
  assert.equal(classifySession("why is the scan slow?", "cli"), "chat");
});

test("prices cache writes by TTL", () => {
  const t = usageParts({ input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 1e6 } });
  // haiku: 0.1 + 0.5 + 0.01 + 0.1*1.25 + 0.1*2
  assert.ok(Math.abs(costUsd("haiku", t) - 0.935) < 1e-9);
});

test("counts a streamed message once and labels the job from its report", () => {
  const usage = { input_tokens: 10, output_tokens: 5 };
  const text = [
    line({ type: "user", entrypoint: "sdk-cli", timestamp: "2026-11-25T01:00:00Z", message: { content: "Process this job offer in single-pass CV match mode. batch-jd-3" } }),
    line({ type: "assistant", timestamp: "2026-11-25T01:00:10Z", requestId: "r1", message: { id: "m1", model: "claude-haiku-5-5", usage: { ...usage, output_tokens: 1 } } }),
    line({ type: "assistant", timestamp: "2026-11-25T01:00:20Z", requestId: "r1", message: { id: "m1", model: "claude-haiku-5-5", usage, content: [{ type: "tool_use", input: { file_path: "/x/reports/012-acme-2026-01-02.md" } }] } }),
  ].join("\n");
  const s = summarizeSession(text, "abc");
  assert.equal(s.kind, "batch");
  assert.equal(s.label, "Acme · #012");
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].total, 15);
  assert.equal(s.end - s.start, 20_000);

  const report = buildReport([s], { range: "7d", now: Date.parse("2026-11-25T12:00:00Z") });
  assert.equal(report.runCount, 1);
  assert.equal(report.scored, 1);
  assert.equal(report.totals.total, 15);
  assert.equal(report.byKind[0].kind, "batch");
});

test("a session with no model answer is a failed run", () => {
  const text = [
    line({ type: "user", entrypoint: "sdk-cli", timestamp: "2026-11-25T01:00:00Z", message: { content: "You are running the OFFICIAL career-ops job evaluation" } }),
    line({ type: "assistant", timestamp: "2026-11-25T01:00:01Z", message: { id: "x", model: "<synthetic>", usage: { input_tokens: 0 } } }),
  ].join("\n");
  const s = summarizeSession(text, "f");
  assert.equal(s.failed, true);
  const report = buildReport([s], { range: "7d", now: Date.parse("2026-11-25T12:00:00Z") });
  assert.equal(report.failed, 1);
  assert.equal(report.scored, 0);
});
