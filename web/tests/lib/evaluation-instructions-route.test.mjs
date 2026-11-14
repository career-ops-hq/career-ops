import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import "../helpers/web-ts-alias-loader.mjs";

// Exercise the real request handler without discovering or spawning any AI CLI.
const cliStub = `export const resolveCliOrFallback = () => ({ spec: { id: "claude" }, binPath: "/fixture/never-run" });
export const cliSubstitutionNotice = () => null;
export const cliUnavailableError = () => ({ error: "Fixture CLI unavailable" });`;
const spawnStub = `
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export function spawnHeadlessCli(bin, args, options) {
  globalThis.__instructionLaunch = {
    args,
    files: fs.readdirSync(options.cwd).filter(name => name.startsWith(".evaluation-instructions-")).map(name => ({
      path: path.join(options.cwd, name, "instructions.md"),
      text: fs.readFileSync(path.join(options.cwd, name, "instructions.md"), "utf8"),
    })),
  };
  const mode = globalThis.__instructionSpawnMode;
  if (!["close", "cancel", "async-error"].includes(mode)) throw new Error("Fixture spawn failure");
  const child = mode === "async-error"
    ? spawn(path.join(options.cwd, "missing-cli"), [], options)
    : spawn(process.execPath, ["-e", mode === "cancel" ? "setTimeout(() => {}, 10000)" : "process.exit(1)"], options);
  globalThis.__instructionChild = child;
  return child;
}`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/spawn-cli.mjs": spawnStub })};
    if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { POST } = await import("../../src/app/api/run/route.ts");

for (const reason of ["missing file", "incomplete instructions"]) {
  test(`focused instruction ${reason} is logged server-side with a generic 422 response`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-focused-instruction-error-"));
    const previousRoot = process.env.CAREER_OPS_ROOT;
    const previousCode = process.env.CAREER_OPS_CODE_ROOT;
    process.env.CAREER_OPS_ROOT = root;
    // The fixture's modes/ and batch/ are system files, which the route reads from the code root.
    process.env.CAREER_OPS_CODE_ROOT = root;
    t.after(() => {
      if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
      else process.env.CAREER_OPS_ROOT = previousRoot;
      if (previousCode === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
      else process.env.CAREER_OPS_CODE_ROOT = previousCode;
      fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, "modes"));
    fs.writeFileSync(path.join(root, "modes/oferta.md"), "# Fictional mode with missing required sections\n");
    if (reason === "incomplete instructions") {
      fs.mkdirSync(path.join(root, "batch"));
      fs.writeFileSync(path.join(root, "modes/_shared.md"), "# Fictional incomplete shared rules\n");
      fs.writeFileSync(path.join(root, "batch/batch-prompt.md"), "# Fictional incomplete schema\n");
    }
    const errors = [];
    t.mock.method(console, "error", (...args) => errors.push(args));
    const response = await POST(new Request("http://fixture.invalid/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "evaluate", cliId: "claude", input: "https://jobs.example.test/1", evaluationSections: ["summary"] }),
    }));
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: "Could not load the selected evaluation instructions. No AI run was started." });
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /Failed to load focused evaluation instructions/);
    assert.ok(errors[0][1] instanceof Error);
    if (reason === "missing file") {
      assert.equal(errors[0][1].code, "ENOENT");
      assert.equal(errors[0][1].path, path.join(root, "modes/_shared.md"));
    } else assert.match(errors[0][1].message, /incomplete/);
  });
}

for (const mode of ["throw", "close", "cancel", "async-error", "full"]) {
  test(`instruction files are scoped to the run and cleaned after ${mode}`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-focused-launch-"));
    const previousRoot = process.env.CAREER_OPS_ROOT;
    const previousCode = process.env.CAREER_OPS_CODE_ROOT;
    process.env.CAREER_OPS_ROOT = root;
    process.env.CAREER_OPS_CODE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
    globalThis.__instructionSpawnMode = mode;
    t.after(() => {
      if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
      else process.env.CAREER_OPS_ROOT = previousRoot;
      if (previousCode === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
      else process.env.CAREER_OPS_CODE_ROOT = previousCode;
      delete globalThis.__instructionSpawnMode;
      delete globalThis.__instructionLaunch;
      delete globalThis.__instructionChild;
      fs.rmSync(root, { recursive: true, force: true });
    });
    fs.writeFileSync(path.join(root, "cv.md"), "# Fictional candidate\n");
    const response = await POST(new Request("http://fixture.invalid/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "evaluate", cliId: "claude", input: "https://jobs.example.test/1", ...(mode === "full" ? {} : { evaluationSections: ["summary"] }) }),
    }));
    const workerClosed = mode === "async-error" ? new Promise(resolve => globalThis.__instructionChild.once("close", resolve)) : null;
    if (mode === "cancel") {
      const closed = once(globalThis.__instructionChild, "close");
      await response.body.cancel();
      await closed;
    } else await response.text();
    if (workerClosed) await workerClosed;
    const launch = globalThis.__instructionLaunch;
    assert.ok(launch, "route reached the spawn boundary");
    assert.ok(launch.args.join(" ").length < 8000);
    if (mode === "full") assert.deepEqual(launch.files, []);
    else {
      assert.equal(launch.files.length, 1);
      assert.match(launch.files[0].text, /Scoring System/);
      assert.ok(!launch.files[0].text.includes("## Block F"));
      assert.ok(launch.args.some(arg => arg.includes(JSON.stringify(launch.files[0].path))));
    }
    assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith(".evaluation-instructions-")), []);
    assert.equal(response.status, ["close", "cancel", "async-error"].includes(mode) ? 200 : 500);
  });
}
