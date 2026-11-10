import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentTextJoiner, parseGrokEvent } from "../../src/lib/run-cli-support.mjs";
import { createCvEnvelopeFilter } from "../../src/lib/cv-envelope.mjs";

const html = '<!DOCTYPE html>\n<html lang="en"><body><h1>Jordan Rivera</h1></body></html>';
const grokLines = [
  { type: "text", data: "I'll tailor from the title, then check the HTML against the fact gate." },
  { type: "tool_call", toolName: "run_terminal_command" },
  { type: "tool_call", toolName: "read_file" },
  { type: "text", data: '<<cv-html format="letter">>\n' },
  { type: "text", data: `${html}\n` },
  { type: "text", data: "<</cv-html>>\nVERDICT: 5/5 — Letter CV tailored for Monarch AI" },
].map((e) => JSON.stringify(e));

function runPdfStream(lines) {
  const join = createAgentTextJoiner();
  const filter = createCvEnvelopeFilter();
  let log = "";
  for (const line of lines) {
    const text = join(parseGrokEvent(line));
    if (text) log += filter.push(text);
  }
  log += filter.flush();
  return { log, envelope: filter.result() };
}

test("a cv envelope that opens a new grok message after a tool call is parsed", () => {
  const { log, envelope } = runPdfStream(grokLines);
  assert.deepEqual(envelope, { ok: true, html, format: "letter", warnings: [] });
  assert.equal(log, "I'll tailor from the title, then check the HTML against the fact gate.\nVERDICT: 5/5 — Letter CV tailored for Monarch AI");
});

test("text deltas inside one message are joined without breaks", () => {
  const join = createAgentTextJoiner();
  assert.deepEqual([{ text: "Read" }, { text: "ing the CV" }, null, { tokens: 5 }].map(join), ["Read", "ing the CV", "", ""]);
});
