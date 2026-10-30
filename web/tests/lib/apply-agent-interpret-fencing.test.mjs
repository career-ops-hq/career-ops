// The agentic interpreter reports whether it LAUNCHED the user's CLI, separately
// from whether it produced fields (#2507, #2941).
//
// session.ts surfaces a "this runtime cannot be permission-restricted" notice
// after the interpreter runs. That notice is about a launch: an agent that ran
// and came back empty still read the page with its default access, while an
// interpreter that stopped before spawning — no CLI installed, no controls to
// interpret, or a fencing refusal — never did. The two used to be conflated
// through the fields array, so an empty result silenced the notice and, keyed
// on the call instead, a never-launched CLI would have raised it.
//
// Same TypeScript import technique as apply-planner-fencing.test.mjs: skipped
// on a Node without type stripping or module.registerHooks.
//
// Run:  node --test tests/lib/apply-agent-interpret-fencing.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const { registerHooks } = await import("node:module");
const canImportTs = Boolean(process.features?.typescript) && typeof registerHooks === "function";
const skip = !canImportTs && "this Node cannot import agent-interpret.ts (no type stripping or module.registerHooks)";

// tsconfig lets app code import "@/lib/clis" and "./extract" without an
// extension; Node's ESM loader does not, so the hook adds the one that exists.
const withExtension = (href) => {
  const file = fileURLToPath(href);
  if (path.extname(file)) return href;
  for (const ext of [".ts", ".mjs", ".js"]) if (fs.existsSync(file + ext)) return pathToFileURL(file + ext).href;
  return href;
};

if (canImportTs) registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(withExtension(pathToFileURL(path.join(SRC, specifier.slice(2))).href), context);
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(withExtension(new URL(specifier, context.parentURL).href), context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) return nextLoad(url, { ...context, format: "module-typescript" });
    return nextLoad(url, context);
  },
});

const { interpretFormWithAgent, agentInterpretForm } = canImportTs
  ? await import("../../src/lib/apply/agent-interpret.ts")
  : { interpretFormWithAgent: null, agentInterpretForm: null };

/** A frame stand-in: the interpreter only calls evaluate() on it. */
const frameOf = (candidates) => ({
  evaluate: async () => {
    if (candidates instanceof Error) throw candidates;
    return candidates;
  },
});

const ONE_CONTROL = [{ n: 0, tag: "input", type: "text", name: "first", placeholder: "", aria: "", req: true, ctx: "First name", opts: [] }];

/**
 * Put a stub `claude` first on PATH that records each launch and prints no
 * JSON, so the interpreter's "launched but nothing usable" path is reachable
 * without a real CLI. Restores PATH and CAREER_OPS_ROOT afterwards.
 */
function withStubClaude(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-agent-interpret-"));
  const log = path.join(dir, "launches.log");
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, `#!/bin/sh\necho launched >> "${log}"\necho "no json here"\n`);
  fs.chmodSync(bin, 0o755);
  const saved = { PATH: process.env.PATH, CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT };
  process.env.PATH = dir;
  process.env.CAREER_OPS_ROOT = dir;
  t.after(() => {
    process.env.PATH = saved.PATH;
    if (saved.CAREER_OPS_ROOT === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = saved.CAREER_OPS_ROOT;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { launches: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0) };
}

test("an unknown CLI id never launches anything and never touches the frame", { skip }, async () => {
  // Given a cliId nobody has registered and a frame that would blow up if asked
  const result = await interpretFormWithAgent(frameOf(new Error("must not be evaluated")), "no-such-cli", "Form");

  // Then: no fields, and — the point — not a launch either
  assert.deepEqual(result, { fields: [], spawned: false });
});

test("a form with no controls is not handed to the CLI: attempted, not launched", { skip: skip || (process.platform === "win32" && "sh fixture") }, async (t) => {
  // Given a resolvable claude (stub) and a frame with nothing to interpret
  const stub = withStubClaude(t);

  const result = await interpretFormWithAgent(frameOf([]), "claude", "Form");

  // Then the interpreter stopped before spawning
  assert.deepEqual(result, { fields: [], spawned: false });
  assert.equal(stub.launches(), 0, "the CLI was never launched");
});

test("a launched CLI that returns nothing usable still reports the launch", { skip: skip || (process.platform === "win32" && "sh fixture") }, async (t) => {
  // Given a resolvable claude (stub that prints no JSON) and one control
  const stub = withStubClaude(t);

  const result = await interpretFormWithAgent(frameOf(ONE_CONTROL), "claude", "Form");

  // Then the fields are empty — the caller falls back — but the launch is
  // reported, which is what the fencing notice in session.ts keys on.
  assert.deepEqual(result.fields, []);
  assert.equal(result.spawned, true);
  assert.equal(stub.launches(), 1, "the CLI was launched exactly once");

  // And the fields-only wrapper keeps its original contract for such a run.
  assert.deepEqual(await agentInterpretForm(frameOf(ONE_CONTROL), "claude", "Form"), []);
  assert.equal(stub.launches(), 2);
});
