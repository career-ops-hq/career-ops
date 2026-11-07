import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import "../helpers/web-ts-alias-loader.mjs";

// The helper tests in run-cli-support.test.mjs call noOutputError() directly, so they
// would still pass if the route stopped handing it the captured stderr line. This goes
// through the real request handler with a stand-in CLI that prints one stderr line, no
// stdout, and exits 0 (what Antigravity does when headless mode auto-denies a tool).
const cliStub = `export const resolveCliOrFallback = () => ({ spec: { id: "claude" }, binPath: "/fixture/never-run" });
export const cliSubstitutionNotice = () => null;
export const cliUnavailableError = () => ({ error: "Fixture CLI unavailable" });`;
const spawnStub = `import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
export function spawnHeadlessCli() {
  const plan = globalThis.__fakeCliRun;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = null;
  child.pid = 0;
  child.kill = () => true;
  setTimeout(() => {
    for (const chunk of plan.stderr) child.stderr.write(chunk);
    child.stdout.end();
    child.stderr.end();
    setTimeout(() => child.emit("close", plan.code, null), 20);
  }, 5);
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

const AGY_LINE =
  'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json.\n';

/** Run one evaluation against a fake CLI and return the streamed events. */
async function streamedEvents(t, { stderr, code }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-stderr-handoff-"));
  const previousRoot = process.env.CAREER_OPS_ROOT;
  const previousCode = process.env.CAREER_OPS_CODE_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = root;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    if (previousCode === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
    else process.env.CAREER_OPS_CODE_ROOT = previousCode;
    delete globalThis.__fakeCliRun;
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "modes"));
  fs.writeFileSync(path.join(root, "modes/oferta.md"), "# Fictional evaluation mode\n");
  fs.writeFileSync(path.join(root, "cv.md"), "# Fictional candidate\n");
  globalThis.__fakeCliRun = { stderr, code };
  const response = await POST(new Request("http://fixture.invalid/api/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "evaluate", cliId: "claude", input: "https://jobs.example.test/1" }),
  }));
  assert.equal(response.status, 200);
  return (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("a clean exit with no stdout streams the CLI's own stderr reason through /api/run", async (t) => {
  const events = await streamedEvents(t, { stderr: [AGY_LINE], code: 0 });
  const error = events.find((event) => event.type === "error");
  assert.ok(error, `expected an error event, got ${JSON.stringify(events)}`);
  assert.match(error.msg, /^The CLI produced no output — is it installed and authenticated\? \(jetski: no output produced/);
  assert.match(error.msg, /headless mode cannot prompt for/);
  assert.equal(events.some((event) => event.type === "done"), false, "a run with no output is never reported as done");
});

test("a clean exit with no stdout and no stderr keeps the generic message", async (t) => {
  const events = await streamedEvents(t, { stderr: [], code: 0 });
  const error = events.find((event) => event.type === "error");
  assert.ok(error, `expected an error event, got ${JSON.stringify(events)}`);
  assert.equal(
    error.msg,
    "The CLI produced no output — is it installed and authenticated? (career-ops is best on Claude Code.)",
  );
});
