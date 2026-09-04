// Tests for the evaluate-mode report envelope parser. Imports directly from
// report-envelope.mjs so the test and production code cannot drift.
//
// The envelope exists so the evaluate-mode agent needs NO write access: it
// emits the report inline and the backend persists it. Every case here is a
// security case as much as a parsing one.
//
// Run:  node --test tests/lib/report-envelope.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReportEnvelope, createReportEnvelopeFilter } from "../../src/lib/report-envelope.mjs";

const SUMMARY = `## Machine Summary
\`\`\`yaml
company: Acme
role: Engineer
score: 4.2
\`\`\``;

const REPORT = `# Evaluation: Acme — Engineer

${SUMMARY}

## A) Role Summary
A role.`;

function envelope(body) {
  return `<<report-md>>\n${body}\n<</report-md>>`;
}

test("parseReportEnvelope: extracts markdown from a well-formed envelope", () => {
  const text = `Scoring done.\n\n${envelope(REPORT)}\n\nVERDICT: 4.2/5 — strong fit`;
  const result = parseReportEnvelope(text);

  assert.equal(result.ok, true);
  assert.equal(result.markdown, REPORT);
});

test("parseReportEnvelope: refuses a missing envelope", () => {
  const result = parseReportEnvelope("VERDICT: 4.2/5 — no envelope here");
  assert.equal(result.ok, false);
  assert.match(result.error, /no <<report-md>> envelope/i);
});

test("parseReportEnvelope: refuses two envelopes rather than guessing", () => {
  const result = parseReportEnvelope(`${envelope(REPORT)}\n${envelope(REPORT)}`);
  assert.equal(result.ok, false);
  assert.match(result.error, /2 <<report-md>> envelopes/i);
});

test("parseReportEnvelope: refuses an unclosed envelope", () => {
  const result = parseReportEnvelope(`<<report-md>>\n${REPORT}\n`);
  assert.equal(result.ok, false);
  assert.match(result.error, /never closed/i);
});

test("parseReportEnvelope: refuses an empty envelope", () => {
  const result = parseReportEnvelope("<<report-md>>\n\n<</report-md>>");
  assert.equal(result.ok, false);
  assert.match(result.error, /empty/i);
});

test("parseReportEnvelope: refuses a body with no title", () => {
  const result = parseReportEnvelope(envelope(SUMMARY));
  assert.equal(result.ok, false);
  assert.match(result.error, /no markdown title/i);
});

test("parseReportEnvelope: refuses a body with no Machine Summary", () => {
  const result = parseReportEnvelope(envelope("# Evaluation: Acme — Engineer\n\nNo YAML."));
  assert.equal(result.ok, false);
  assert.match(result.error, /Machine Summary/i);
});

test("parseReportEnvelope: a mention in prose is not a marker", () => {
  const text = `Use a <<report-md>> envelope.\n\n${envelope(REPORT)}`;
  const result = parseReportEnvelope(text);
  assert.equal(result.ok, true);
  assert.equal(result.markdown, REPORT);
});

test("createReportEnvelopeFilter: hides the body from the run log", () => {
  const filter = createReportEnvelopeFilter();
  const visible = [
    filter.push("Working.\n<<report-md>>\n"),
    filter.push(`${REPORT}\n`),
    filter.push("<</report-md>>\nVERDICT: 4.2/5 — done\n"),
  ].join("");
  const tail = filter.flush();

  assert.ok(!visible.includes("Machine Summary"), "body must not reach the log");
  assert.match(visible + tail, /Working/);
  assert.match(visible + tail, /VERDICT: 4.2\/5/);
  const result = filter.result();
  assert.equal(result.ok, true);
  assert.equal(result.markdown, REPORT);
});
