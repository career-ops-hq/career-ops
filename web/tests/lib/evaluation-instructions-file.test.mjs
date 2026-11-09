import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeEvaluationInstructions } from "../../src/lib/evaluation-instructions-file.mjs";
import { selectedEvaluationInstructions, FULL_EVALUATION } from "../../src/lib/evaluation-options.mjs";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";

const code = new URL("../../../", import.meta.url);
const read = name => fs.readFileSync(new URL(name, code), "utf8");
const source = { mode: read("modes/oferta.md"), canonicalMode: read("modes/oferta.md"), shared: read("modes/_shared.md"), batch: read("batch/batch-prompt.md") };

test("every partial selection keeps real instructions off the command line", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co instructions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let mask = 0; mask < (1 << FULL_EVALUATION.length) - 1; mask++) {
    const sections = FULL_EVALUATION.filter((_, i) => mask & (1 << i));
    const instructions = selectedEvaluationInstructions({ ...source, sections });
    const stored = writeEvaluationInstructions(root, instructions);
    try {
      const prompt = buildPrompt({ kind: "evaluate", input: "https://jobs.example.test/1", today: "2026-11-08", memory: "", evaluationInstructions: stored.reference });
      assert.ok(prompt.length < 8000, `selection ${sections}: ${prompt.length}`);
      assert.ok(!prompt.includes(instructions));
      const dirs = fs.readdirSync(root);
      assert.equal(dirs.length, 1);
      assert.equal(fs.readFileSync(path.join(root, dirs[0], "instructions.md"), "utf8"), instructions);
    } finally {
      stored.cleanup();
    }
    assert.deepEqual(fs.readdirSync(root), []);
  }
});

test("concurrent workers read distinct Unicode files inside their data root", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co instructions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const text = "Selected instructions 日本語 é 🚀\n".repeat(4000);
  const first = writeEvaluationInstructions(root, text);
  const second = writeEvaluationInstructions(root, "Other selected sections");
  const files = fs.readdirSync(root).map(dir => path.join(root, dir, "instructions.md"));
  const file = files.find(file => fs.readFileSync(file, "utf8") === text);
  const child = spawnSync(
  process.execPath,
  ["-e", "process.stdout.write(require('node:fs').readFileSync(process.env.EVALUATION_TEST_FILE, 'utf8'))"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, EVALUATION_TEST_FILE: file },
  },
);
  assert.equal(child.stdout, text);
  first.cleanup();
  assert.equal(fs.readdirSync(root).length, 1);
  second.cleanup();
  first.cleanup();
  assert.deepEqual(fs.readdirSync(root), []);
});
