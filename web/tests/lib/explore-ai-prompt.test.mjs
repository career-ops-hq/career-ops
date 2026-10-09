import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as exploreAiPrompt from "../../src/app/api/explore/ai/prompt.ts";

test("AI offer search loads its dedicated web-search mode and keeps the offer envelope contract", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-ai-prompt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "modes"));
  fs.writeFileSync(path.join(root, "modes", "discover.md"), "WRONG ATS BOARD RESOLVER");
  fs.writeFileSync(path.join(root, "modes", "web-search.md"), "DEDICATED REAL-OFFER WEB SEARCH MODE");

  assert.equal(exploreAiPrompt.AI_SEARCH_MODE_FILE, "web-search.md");
  const prompt = exploreAiPrompt.buildAiSearchPrompt({
    root,
    query: "designer em Lisboa",
    memory: "prefere horário diurno",
    knownLines: ["https://example.test/already-known"],
  });
  assert.match(prompt, /DEDICATED REAL-OFFER WEB SEARCH MODE/);
  assert.doesNotMatch(prompt, /WRONG ATS BOARD RESOLVER/);
  assert.match(prompt, /<<offer:\{/);
  assert.match(prompt, /designer em Lisboa/);
  assert.match(prompt, /https:\/\/example\.test\/already-known/);
  assert.doesNotMatch(prompt, /Follow modes\/discover\.md/);
});

test("AI offer search reads its mode from the code root when user data lives elsewhere", (t) => {
  const codeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-ai-code-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-ai-data-"));
  t.after(() => {
    fs.rmSync(codeRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(codeRoot, "modes"));
  fs.writeFileSync(path.join(codeRoot, "modes", "web-search.md"), "MODE FROM CODE ROOT");

  const prompt = exploreAiPrompt.buildAiSearchPrompt({
    cwd: path.join(codeRoot, "web"),
    env: { CAREER_OPS_ROOT: dataRoot, CAREER_OPS_CODE_ROOT: codeRoot },
    query: "freelance em Lisboa",
  });

  assert.match(prompt, /MODE FROM CODE ROOT/);
});
