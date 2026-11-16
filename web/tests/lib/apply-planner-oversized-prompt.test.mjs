// A planner prompt that would not fit on the command line travels through a file.
//
// The apply planner (lib/apply/planner.ts) hands its whole prompt to the CLI as
// one argv element, and that prompt inlines the user's durable notes. Windows
// caps the entire command line at 32,767 UTF-16 units, and libuv reports a
// longer launch as `spawn ENAMETOOLONG`, so every pre-fill failed once the notes
// grew. runPlanner now reuses spillOversizedPrompt (lib/oversized-prompt.mjs):
// an oversized prompt is written under the data root, argv carries a short
// pointer to it, and the file is removed on every exit path. A prompt that fits
// is passed through untouched and nothing is written.
//
// The contract is behaviour, so a stand-in binary reports the argv it really
// received and what the pointed-to file held while it ran. `platform: "win32"`
// makes the size decision use the Windows limit on every OS, so the suite means
// the same thing on Linux CI and on Windows.
//
// planner.ts is TypeScript and this test is .mjs: the import boilerplate below
// is the same as apply-planner-fencing.test.mjs.
//
// Run:  node --experimental-strip-types --test tests/lib/apply-planner-oversized-prompt.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

// See apply-planner-fencing.test.mjs: importing a .ts file needs type stripping
// and module.registerHooks, so an older local Node skips instead of failing.
const { registerHooks } = await import("node:module");
const canImportTs = Boolean(process.features?.typescript) && typeof registerHooks === "function";
const skip = !canImportTs && "this Node cannot import planner.ts (no type stripping or module.registerHooks)";

if (canImportTs) registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(path.join(SRC, specifier.slice(2))).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) return nextLoad(url, { ...context, format: "module-typescript" });
    return nextLoad(url, context);
  },
});

const { runPlanner } = canImportTs ? await import("../../src/lib/apply/planner.ts") : { runPlanner: null };
const { WIN32_COMMAND_LINE_LIMIT, launchIsOversized } = await import("../../src/lib/oversized-prompt.mjs");

const SPILL_LINE = "too long for the command line";

// Reports the argv it received and, when that argv quotes a file path, what the
// file held at that moment (the planner's own view of the spilled prompt).
const STAND_IN = `
const arg = process.argv[2] || "";
const m = arg.match(/"(?:[^"\\\\]|\\\\.)*"/);
let file = null;
let content = null;
if (m) {
  try {
    file = JSON.parse(m[0]);
    content = require("node:fs").readFileSync(file, "utf8");
  } catch {
    content = null;
  }
}
process.stdout.write(JSON.stringify({ arg, file, content }));
`;

/** A temp directory removed when the test ends. */
function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The stand-in script (kept outside the data root) and the spec that launches it. */
function standIn(t) {
  const dir = tempDir(t, "career-ops-planner-stand-in-");
  const script = path.join(dir, "stand-in.cjs");
  fs.writeFileSync(script, STAND_IN);
  const spec = { id: "gemini", name: "Gemini CLI", args: (p) => [script, p] };
  return { spec, script };
}

/** Multi-line synthetic prompt; distinctive first and last lines. */
function bigPrompt() {
  const lines = ["PLANNER-PROMPT-FIRST-LINE"];
  for (let i = 0; i < 600; i++) lines.push(`- durable note ${String(i).padStart(4, "0")} ${"x".repeat(60)}`);
  lines.push("PLANNER-PROMPT-LAST-LINE");
  return lines.join("\n");
}

async function plan({ spec, binPath = process.execPath, prompt, root }) {
  const lines = [];
  const run = await runPlanner({
    cliId: spec.id,
    spec,
    binPath,
    prompt,
    fieldCount: 1,
    cwd: root,
    t0: Date.now(),
    log: (m) => lines.push(m),
    platform: "win32",
  });
  return { run, lines };
}

test("an oversized prompt reaches the planner through a file and argv fits the Windows limit", { skip }, async (t) => {
  const root = tempDir(t, "career-ops-planner-root-");
  const { spec } = standIn(t);
  const prompt = bigPrompt();
  assert.ok(prompt.length > WIN32_COMMAND_LINE_LIMIT, "precondition: the prompt alone exceeds the limit");

  const { run, lines } = await plan({ spec, prompt, root });

  assert.equal(run.refused, undefined, `the planner started, got ${run.refused}`);
  assert.equal(run.code, 0);
  const out = JSON.parse(run.buf);
  assert.notEqual(out.arg, prompt);
  assert.equal(out.arg.includes("durable note 0300"), false, "the prompt body is not on the command line");
  assert.equal(launchIsOversized(process.execPath, spec.args(out.arg), "win32"), false);
  assert.ok(out.file, "argv carries a quoted file path");
  const rel = path.relative(root, out.file);
  assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel), `the file lives under the data root, got ${out.file}`);
  assert.equal(out.content, prompt, "the file held the full prompt while the planner ran");
  assert.deepEqual(fs.readdirSync(root), [], "the spilled file is removed once the planner closes");
  assert.ok(lines.some((l) => l.includes(SPILL_LINE)), `the move to a file is logged, got ${JSON.stringify(lines)}`);
});

test("a prompt that fits is passed through unchanged and nothing is written", { skip }, async (t) => {
  const root = tempDir(t, "career-ops-planner-root-");
  const { spec } = standIn(t);
  const prompt = "Fill the form.\nUse only the notes on file.\nKeep answers short.";

  const { run, lines } = await plan({ spec, prompt, root });

  assert.equal(run.refused, undefined);
  const out = JSON.parse(run.buf);
  assert.equal(out.arg, prompt);
  assert.equal(out.file, null);
  assert.deepEqual(fs.readdirSync(root), []);
  assert.equal(lines.some((l) => l.includes(SPILL_LINE)), false);
});

test("the spilled prompt is removed when the planner binary cannot be started", { skip }, async (t) => {
  const root = tempDir(t, "career-ops-planner-root-");
  const { spec } = standIn(t);
  const missingDir = tempDir(t, "career-ops-planner-missing-");
  const binPath = path.join(missingDir, "no-such-planner");

  const { run, lines } = await plan({ spec, binPath, prompt: bigPrompt(), root });

  assert.ok(lines.some((l) => l.includes(SPILL_LINE)), `the prompt was moved to a file, got ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.startsWith("spawn error")), `the failed start is logged, got ${JSON.stringify(lines)}`);
  assert.equal(run.code, null);
  assert.deepEqual(fs.readdirSync(root), [], "the spilled file does not outlive a failed start");
});

test("the spilled prompt is removed when spawn throws", { skip }, async (t) => {
  const root = tempDir(t, "career-ops-planner-root-");
  const { spec } = standIn(t);
  // A NUL byte in the executable path makes Node's spawn throw synchronously,
  // after the prompt has already been written to its file.
  const binPath = path.join(os.tmpdir(), "planner\0bin");

  const { run, lines } = await plan({ spec, binPath, prompt: bigPrompt(), root });

  assert.ok(lines.some((l) => l.includes(SPILL_LINE)), `the prompt was moved to a file, got ${JSON.stringify(lines)}`);
  assert.equal(typeof run.refused, "string");
  assert.equal(run.buf, "");
  assert.deepEqual(fs.readdirSync(root), [], "the spilled file does not outlive a synchronous spawn failure");
});
