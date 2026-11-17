// A form-interpreter prompt too long for the command line reaches the CLI through a file.
//
// The apply agentic fallback (lib/apply/agent-interpret.ts) lists every
// interactive control of the live form in its prompt, one line each with up
// to 220 characters of context and twelve options, and passes the prompt as
// one argv element. Nothing caps the number of controls, so a long
// application form takes the launch past the Windows command line (32,767
// UTF-16 units) and the spawn fails with an opaque `spawn ENAMETOOLONG`. The
// launch now goes through spillOversizedPrompt, as the pre-fill planner
// (#7150) and /api/run (#6743) do: an oversized prompt is written under the
// data root, argv carries a short pointer to it, and the file is removed on
// every exit path. A prompt that fits is passed as before.
//
// The fixture form has 300 controls, about 554 characters each and 166,000 in
// all: over both platform limits (the Windows command line, and the POSIX
// 128 KiB per-argument cap), so the spill happens on every OS. On Windows a
// form of about 60 such controls is already too long. The CLI lookup and the spawn
// are stubbed, as in evaluation-instructions-route.test.mjs, and the frame is
// a stand-in that returns the captured controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import "../helpers/web-ts-alias-loader.mjs";

const cliStub = `export const resolveCli = () => ({ spec: { id: "claude", name: "Fixture CLI", args: (p) => ["-p", p] }, binPath: "/fixture/never-run" });`;
// Records the argv and the spilled prompt files present at spawn time, then
// runs a child that answers with an empty interpretation.
const spawnStub = `
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export function spawnHeadlessCli(bin, args, options) {
  globalThis.__interpretLaunch = {
    args,
    files: fs.readdirSync(options.cwd).filter(name => name.startsWith(".evaluation-instructions-")).map(name =>
      fs.readFileSync(path.join(options.cwd, name, "instructions.md"), "utf8")),
  };
  if (globalThis.__interpretSpawnMode === "throw") throw new Error("Fixture spawn failure");
  return spawn(process.execPath, ["-e", "process.stdout.write('[]')"], options);
}`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/spawn-cli.mjs": spawnStub })};
    if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { interpretFormWithAgent } = await import("../../src/lib/apply/agent-interpret.ts");

/** `count` select controls, each with a full context line and twelve options. */
function controls(count) {
  return Array.from({ length: count }, (_, n) => ({
    n,
    tag: "select",
    type: "select",
    name: `question_${n}`,
    placeholder: "",
    aria: "",
    req: true,
    ctx: `QUESTION-${n} ${"Which of these fictional teams would you join and why".repeat(5)}`.slice(0, 220),
    opts: Array.from({ length: 12 }, (_, i) => `Fictional option ${i + 1}`),
  }));
}

/** A stand-in frame: the capture returns `cands`, the re-tag does nothing. */
const frameWith = (cands) => ({ evaluate: async (_fn, arg) => (arg === undefined ? cands : undefined) });

/** A data root for one test, with careerOpsRoot() pointed at it. */
function useRoot(t, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-interpret-spill-"));
  const previous = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  globalThis.__interpretSpawnMode = mode;
  t.after(() => {
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous;
    delete globalThis.__interpretSpawnMode;
    delete globalThis.__interpretLaunch;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

const spillDirs = (root) => fs.readdirSync(root).filter(name => name.startsWith(".evaluation-instructions-"));

test("a form too long for the command line reaches the CLI through a file, removed once it closes", async t => {
  const root = useRoot(t, "close");
  const result = await interpretFormWithAgent(frameWith(controls(300)), "claude", "Fixture application");
  assert.deepEqual(result, { fields: [], spawned: true });
  const launch = globalThis.__interpretLaunch;
  assert.ok(launch, "the interpreter reached the spawn boundary");
  assert.ok(launch.args.join(" ").length < 8000, `argv still carries the controls: ${launch.args.join(" ").length} chars`);
  assert.equal(launch.files.length, 1, "the prompt went to one file under the data root");
  assert.match(launch.files[0], /\[0\] tag=select type=select required name="question_0"/);
  assert.match(launch.files[0], /\[299\] tag=select .*QUESTION-299/);
  assert.deepEqual(spillDirs(root), [], "the file is removed when the CLI closes");
});

test("the spilled prompt is removed when the spawn throws, which still rejects", async t => {
  const root = useRoot(t, "throw");
  await assert.rejects(interpretFormWithAgent(frameWith(controls(300)), "claude", "Fixture application"), /Fixture spawn failure/);
  assert.equal(globalThis.__interpretLaunch.files.length, 1);
  assert.deepEqual(spillDirs(root), []);
});

test("a form that fits is passed in argv as before, and nothing is written", async t => {
  const root = useRoot(t, "close");
  const result = await interpretFormWithAgent(frameWith(controls(5)), "claude", "Fixture application");
  assert.deepEqual(result, { fields: [], spawned: true });
  const launch = globalThis.__interpretLaunch;
  assert.deepEqual(launch.files, []);
  assert.equal(launch.args[0], "-p");
  assert.match(launch.args[1], /\[4\] tag=select .*QUESTION-4/);
  assert.deepEqual(spillDirs(root), []);
});
