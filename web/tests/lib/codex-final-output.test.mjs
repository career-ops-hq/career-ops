import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectCodexFinalOutput, recoverCodexFinalOutput } from "../../src/lib/codex-final-output.mjs";
import { createCvEnvelopeFilter, validateRoleResumeWorkerResponse } from "../../src/lib/cv-envelope.mjs";

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

const MARKDOWN = "# Lavasier Joyner\n\n**Senior Software Engineer**";
const templateHtml = fs.readFileSync(new URL("../../../templates/cv-template.html", import.meta.url), "utf8")
  .replace(/{{PHOTO}}/g, "")
  .replace(/{{[^}]+}}/g, "Filled");
const completedHtml = RESPONSE.replace("<!DOCTYPE html><html><body>CV</body></html>", templateHtml);
function mergedResponse(jsonlText, finalText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-final-"));
  const file = path.join(dir, "final.txt");
  try {
    fs.writeFileSync(file, finalText);
    const filter = createCvEnvelopeFilter();
    filter.push(jsonlText + "\n");
    const recovered = inspectCodexFinalOutput(file, filter.rawText());
    if (recovered.addition) filter.push(recovered.addition + "\n");
    return { raw: filter.rawText(), recovered };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test("valid terminal envelope wins when JSONL contains intermediate Markdown", () => {
  const merged = mergedResponse(MARKDOWN, completedHtml);
  assert.equal(merged.recovered.containsOpenMark, true);
  assert.equal(validateRoleResumeWorkerResponse(merged.raw).ok, true);
});
test("Markdown in JSONL and terminal output remains a controlled no-envelope failure", () => {
  const merged = mergedResponse(MARKDOWN, MARKDOWN);
  const result = validateRoleResumeWorkerResponse(merged.raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /no <<cv-html>> envelope/);
});
test("an exact terminal duplicate of the JSONL envelope is not appended twice", () => {
  const merged = mergedResponse(completedHtml, completedHtml);
  assert.equal(merged.recovered.duplicate, true);
  assert.equal((merged.raw.match(/<<cv-html/g) || []).length, 1);
  assert.equal(validateRoleResumeWorkerResponse(merged.raw).ok, true);
});
test("recovered terminal envelope with an em-dash VERDICT validates", () => {
  const emDashEnvelope = completedHtml.replace("VERDICT: 5/5 - complete", "VERDICT: 5/5 — complete");
  assert.equal(validateRoleResumeWorkerResponse(mergedResponse("Agent working", emDashEnvelope).raw).ok, true);
});
