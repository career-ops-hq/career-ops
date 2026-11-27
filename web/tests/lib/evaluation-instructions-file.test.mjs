import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { sweepEvaluationInstructions, writeEvaluationInstructions } from "../../src/lib/evaluation-instructions-file.mjs";
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

test("instructions are published by rename and name the live process", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co instructions-publish-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const text = "Selected instructions";
  const stored = writeEvaluationInstructions(root, text);
  const dir = path.dirname(stored.file);
  const names = fs.readdirSync(dir);
  assert.equal(fs.readFileSync(stored.file, "utf8"), text);
  assert.equal(names.includes("instructions.md"), true);
  assert.equal(names.some((name) => name.endsWith(".tmp")), false);
  const owner = JSON.parse(fs.readFileSync(path.join(dir, "owner.json"), "utf8"));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.host, os.hostname());
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(stored.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(dir, "owner.json")).mode & 0o777, 0o600);
  }
  stored.cleanup();
  assert.deepEqual(fs.readdirSync(root), []);
});

test("a dead run's instruction directory is removed and a live one stays", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co instructions-sweep-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const deadPid = child.pid;
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  let alive = true;
  try {
    process.kill(deadPid, 0);
  } catch (error) {
    alive = error?.code === "EPERM";
  }
  assert.equal(alive, false);

  const deadDir = fs.mkdtempSync(path.join(root, ".evaluation-instructions-"));
  fs.writeFileSync(path.join(deadDir, "owner.json"), `${JSON.stringify({ pid: deadPid })}\n`);
  fs.writeFileSync(path.join(deadDir, "instructions.md"), "secret");

  const liveDir = fs.mkdtempSync(path.join(root, ".evaluation-instructions-"));
  fs.writeFileSync(path.join(liveDir, "owner.json"), `${JSON.stringify({ pid: process.pid })}\n`);
  fs.writeFileSync(path.join(liveDir, "instructions.md"), "live");
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(liveDir, past, past);

  const young = fs.mkdtempSync(path.join(root, ".evaluation-instructions-"));
  fs.writeFileSync(path.join(young, "instructions.md"), "young");

  const old = fs.mkdtempSync(path.join(root, ".evaluation-instructions-"));
  fs.writeFileSync(path.join(old, "instructions.md"), "old");
  fs.utimesSync(old, past, past);

  sweepEvaluationInstructions(root);

  const otherHost = fs.mkdtempSync(path.join(root, ".evaluation-instructions-"));
  fs.writeFileSync(path.join(otherHost, "owner.json"), `${JSON.stringify({ pid: deadPid, host: "other-host.example" })}\n`);
  fs.writeFileSync(path.join(otherHost, "instructions.md"), "elsewhere");

  const otherHostNoPid = fs.mkdtempSync(path.join(root, ".evaluation-instructions-"));
  fs.writeFileSync(path.join(otherHostNoPid, "owner.json"), `${JSON.stringify({ pid: null, host: "other-host.example" })}\n`);
  fs.writeFileSync(path.join(otherHostNoPid, "instructions.md"), "elsewhere-no-pid");
  fs.utimesSync(otherHostNoPid, past, past);

  const sameHostNoPid = fs.mkdtempSync(path.join(root, ".evaluation-instructions-"));
  fs.writeFileSync(path.join(sameHostNoPid, "owner.json"), `${JSON.stringify({ pid: null, host: os.hostname() })}\n`);
  fs.writeFileSync(path.join(sameHostNoPid, "instructions.md"), "same-host");
  fs.utimesSync(sameHostNoPid, past, past);

  sweepEvaluationInstructions(root);

  assert.equal(fs.existsSync(deadDir), false);
  assert.equal(fs.readFileSync(path.join(otherHost, "instructions.md"), "utf8"), "elsewhere");
  assert.equal(fs.readFileSync(path.join(otherHostNoPid, "instructions.md"), "utf8"), "elsewhere-no-pid");
  assert.equal(fs.existsSync(sameHostNoPid), false);
  assert.equal(fs.readFileSync(path.join(liveDir, "instructions.md"), "utf8"), "live");
  assert.equal(fs.existsSync(young), true);
  assert.equal(fs.existsSync(old), false);
});
