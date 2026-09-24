// The apply planner runs under the same fence as every other worker (#2507).
//
// #3428 lifted the planner spawn out of api/apply/prefill/route.ts into
// lib/apply/planner.ts, and #2941 made spawnHeadlessCli refuse to start without
// a capability record. The two meet in runPlanner: it declares the planner as
// localReadOnly, lets the fencer translate that for the chosen runtime, and
// turns a fencing refusal into a resolved PlannerRun carrying `refused` — never
// a throw inside the promise executor, which would leave the caller's NDJSON
// stream open forever.
//
// planner.ts is TypeScript and this test is .mjs. Unlike clis-permissions.test.mjs
// (which reads clis.ts as text), the contract here is behaviour, not spelling,
// so the module is imported for real: Node strips the type annotations, and a
// resolve hook maps the `@/` alias that tsconfig gives the app to src/.
//
// Run:  node --test tests/lib/apply-planner-fencing.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

// engines allows Node >=22, but importing a .ts file needs type stripping
// (default from 22.18 / 23.6) and module.registerHooks (22.15 / 23.5). CI runs
// 24; on an older local Node the three cases skip rather than fail — which is
// why registerHooks is looked up at runtime rather than imported by name: a
// static named import of an export that does not exist fails the whole file
// before any skip can run.
const { registerHooks } = await import("node:module");
const canImportTs = Boolean(process.features?.typescript) && typeof registerHooks === "function";
const skip = !canImportTs && "this Node cannot import planner.ts (no type stripping or module.registerHooks)";

if (canImportTs) registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));
      for (const ext of ["", ".ts", ".mjs"]) {
        if (fs.existsSync(base + ext)) return nextResolve(pathToFileURL(base + ext).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  // web/package.json declares no "type", so Node would sniff planner.ts twice
  // and warn; name the format it is.
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) return nextLoad(url, { ...context, format: "module-typescript" });
    return nextLoad(url, context);
  },
});

const { runPlanner } = canImportTs ? await import("../../src/lib/apply/planner.ts") : { runPlanner: null };

/** A runPlanner call with everything but the runtime fixed; returns the run and the log lines. */
async function plan({ cliId, spec, binPath }) {
  const lines = [];
  const run = await runPlanner({
    cliId,
    spec,
    binPath,
    prompt: "PROMPT",
    fieldCount: 1,
    cwd: process.cwd(),
    t0: Date.now(),
    log: (m) => lines.push(m),
  });
  return { run, lines };
}

test("a runtime argv that contradicts the capability record is refused, not spawned", { skip }, async () => {
  // Given: a Codex spec whose argv already spells its own sandbox — the exact
  // shape the fencer exists to refuse — and a binary that must never run.
  const mustNotRun = path.join(os.tmpdir(), `career-ops-planner-must-not-run-${process.pid}`);
  assert.equal(fs.existsSync(mustNotRun), false);
  const spec = {
    id: "codex",
    name: "Codex",
    args: (p) => ["exec", "-c", "sandbox_mode=danger-full-access", p],
  };

  // When: the planner is asked to run it.
  const { run, lines } = await plan({ cliId: "codex", spec, binPath: mustNotRun });

  // Then: the promise resolves (no escaping throw) with the refusal spelled out,
  // nothing was spawned, and the caller gets an empty buffer to close on.
  assert.equal(typeof run.refused, "string");
  assert.match(run.refused, /sandbox_mode=danger-full-access/, "the refusal names the offending token");
  assert.equal(run.buf, "");
  assert.equal(run.code, null);
  assert.equal(run.signal, null);
  assert.ok(lines.some((l) => l.startsWith("spawn refused: ")), `refusal is logged, got ${JSON.stringify(lines)}`);
  // A spawn of a missing binary would log "spawn error: ..." from child.on("error").
  assert.equal(lines.some((l) => l.startsWith("spawn error")), false, "the binary was never spawned");
});

test("a runtime with no verified fencing mechanism runs and the notice reaches the log", { skip }, async () => {
  // Given: gemini has no fencer, so its argv passes through untouched and the
  // run is graded with a notice; a node one-liner stands in for the binary.
  const spec = {
    id: "gemini",
    name: "Gemini CLI",
    args: () => ["-e", "process.stdout.write('PLANNED')"],
  };

  const { run, lines } = await plan({ cliId: "gemini", spec, binPath: process.execPath });

  assert.equal(run.refused, undefined);
  assert.equal(run.buf, "PLANNED");
  assert.equal(run.code, 0);
  assert.ok(
    lines.some((l) => l.includes("Gemini CLI") && l.includes("cannot be permission-restricted")),
    `unfenced-runtime notice is emitted through log(), got ${JSON.stringify(lines)}`,
  );
});

test("the Claude planner argv carries the derived deny list, not a hand-written one", { skip: skip || (process.platform === "win32" && "sh fixture") }, async () => {
  // Given: an executable that echoes its argv, one per line, so the fenced
  // command line the planner actually spawns can be read back.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-planner-argv-"));
  const bin = path.join(dir, "echo-argv");
  fs.writeFileSync(bin, '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n');
  fs.chmodSync(bin, 0o755);
  try {
    // spec.args is what a non-Claude runtime would get; the Claude carve-out in
    // runPlanner builds its own argv from cliId, so this must not be used.
    const spec = { id: "claude", name: "Claude Code", args: () => ["-p", "WRONG"] };
    const { run, lines } = await plan({ cliId: "claude", spec, binPath: bin });

    assert.equal(run.refused, undefined);
    assert.equal(run.code, 0);
    const argv = run.buf.split("\n").filter(Boolean);
    assert.equal(argv.includes("WRONG"), false, "the Claude carve-out builds the argv, spec.args is bypassed");
    assert.ok(argv.includes("--strict-mcp-config"), "a non-writing worker loads no MCP server");
    const disallowed = argv[argv.indexOf("--disallowedTools") + 1];
    const allowed = argv[argv.indexOf("--allowedTools") + 1];
    assert.equal(allowed, "Read,Glob,Grep");
    // Derived from the policy, so every write-capable AND network tool the scope
    // does not grant is denied — including MultiEdit, which the old hand-written
    // list in the route omitted (#2185).
    for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Task"]) {
      assert.ok(disallowed.split(",").includes(tool), `${tool} is denied, got ${disallowed}`);
    }
    // Claude is fully fenceable: no notice.
    assert.equal(lines.some((l) => l.includes("permission-restricted")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
