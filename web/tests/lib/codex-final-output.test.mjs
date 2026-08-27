import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recoverCodexFinalOutput } from "../../src/lib/codex-final-output.mjs";
import { createCvEnvelopeFilter } from "../../src/lib/cv-envelope.mjs";

const RESPONSE = '<<cv-html format="letter">>\n<!DOCTYPE html><html><body>CV</body></html>\n<</cv-html>>\nVERDICT: 5/5 - complete';
test("Codex final assistant output reaches the shared envelope parser", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-final-"));
  const file = path.join(dir, "final.txt");
  try {
    fs.writeFileSync(file, RESPONSE);
    const filter = createCvEnvelopeFilter();
    filter.push("Agent working\n");
    filter.push(recoverCodexFinalOutput(file, filter.rawText()) + "\n");
    assert.equal(filter.result().ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("final-output recovery does not duplicate an assistant response already seen in JSONL", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-final-"));
  const file = path.join(dir, "final.txt");
  try { fs.writeFileSync(file, RESPONSE); assert.equal(recoverCodexFinalOutput(file, RESPONSE), ""); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
