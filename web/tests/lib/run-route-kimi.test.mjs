import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const clisUrl = pathToFileURL(path.join(import.meta.dirname, "../../src/lib/clis.ts")).href;
const cliStub = `import { KNOWN } from ${JSON.stringify(clisUrl)};
export const resolveCliOrFallback = (id) => {
  const spec = KNOWN.find((cli) => cli.id === id);
  return spec ? { spec, binPath: "/fixture/never-run" } : null;
};
export const cliSubstitutionNotice = () => null;
export const cliUnavailableError = () => ({ error: "Fixture CLI unavailable" });`;
const spawnStub = `import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
export function spawnHeadlessCli(binPath, args, options, fencing) {
  const plan = globalThis.__fakeCliRun;
  plan.spawned = { binPath, args, fencing };
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = null;
  child.pid = 0;
  child.kill = () => true;
  setTimeout(() => {
    for (const chunk of plan.stdout) child.stdout.write(chunk);
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

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-kimi-route-"));
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
  fs.writeFileSync(path.join(root, "verify-portals.mjs"), "");
  fs.writeFileSync(path.join(root, "cv.md"), "# Fictional candidate\n");
}

function post(body) {
  return POST(new Request("http://fixture.invalid/api/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function kimiEvaluation(t, plan) {
  fixtureRoot(t);
  globalThis.__fakeCliRun = { stdout: [], stderr: [], code: 0, ...plan };
  const response = await post({ kind: "evaluate", cliId: "kimi", input: "https://jobs.example.test/1" });
  assert.equal(response.status, 200);
  const events = (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { events, spawned: globalThis.__fakeCliRun.spawned };
}

const line = (record) => `${JSON.stringify(record)}\n`;

test("an evaluation on Kimi spawns stream-json with no approval flags and a read-only fence", async (t) => {
  const { spawned } = await kimiEvaluation(t, { stdout: [line({ role: "assistant", content: "ok" })] });
  assert.equal(spawned.binPath, "/fixture/never-run");
  assert.deepEqual(spawned.args.slice(0, 3), ["--output-format", "stream-json", "-p"]);
  assert.equal(spawned.args.length, 4);
  assert.equal(spawned.fencing.cliId, "kimi");
  assert.equal(spawned.fencing.capabilities.writes, false);
});

test("Kimi stream-json becomes text and tool events, with UTF-8 split across chunks", async (t) => {
  const text = line({ role: "assistant", content: "Reading the posting — café ✓" });
  const bytes = Buffer.from(text);
  const cut = bytes.indexOf(Buffer.from("é")) + 1;
  const { events } = await kimiEvaluation(t, {
    stdout: [
      line({ type: "session.resume_hint", session_id: "sess-fixture" }),
      line({ role: "assistant", content: "", tool_calls: [{ function: { name: "FetchURL", arguments: "{}" } }] }),
      line({ role: "tool", content: "a large fetched page" }),
      bytes.subarray(0, cut),
      bytes.subarray(cut),
    ],
    stderr: ["thinking: the posting looks like a fit\n"],
  });
  const status = events.find((event) => event.type === "status");
  assert.match(status.label, /^Kimi Code CLI cannot be permission-restricted/);
  assert.deepEqual(events.filter((event) => event.type === "tool").map((event) => event.name), ["FetchURL"]);
  const streamed = events.filter((event) => event.type === "text").map((event) => event.text).join("");
  assert.match(streamed, /Reading the posting — café ✓\n/);
  assert.doesNotMatch(streamed, /a large fetched page|sess-fixture|thinking/);
  assert.equal(streamed.includes("�"), false);
});

test("a Kimi auth failure with a nonzero exit is reported and never marked done", async (t) => {
  const { events } = await kimiEvaluation(t, { stderr: ["not authenticated, run `kimi login`\n"], code: 1 });
  const error = events.find((event) => event.type === "error");
  assert.ok(error, `expected an error event, got ${JSON.stringify(events)}`);
  assert.match(error.msg, /exited with an error/);
  assert.match(error.msg, /not authenticated/);
  assert.equal(events.some((event) => event.type === "done"), false);
});

test("a Kimi quota failure reports Kimi's own wording", async (t) => {
  const { events } = await kimiEvaluation(t, { stderr: ["Error code: 429 - Your credit balance is insufficient\n"], code: 1 });
  const error = events.find((event) => event.type === "error");
  assert.ok(error, `expected an error event, got ${JSON.stringify(events)}`);
  assert.match(error.msg, /credit balance is insufficient/);
  assert.equal(events.some((event) => event.type === "done"), false);
});

test("a Kimi run that printed text but exited nonzero is not recorded as a result", async (t) => {
  const { events } = await kimiEvaluation(t, {
    stdout: [line({ role: "assistant", content: "partial answer" })],
    stderr: ["Insufficient account balance\n"],
    code: 1,
  });
  assert.equal(events.some((event) => event.type === "done"), false);
  assert.ok(events.some((event) => event.type === "error"), JSON.stringify(events));
});

test("Kimi is refused for the pdf worker before anything spawns", async (t) => {
  fixtureRoot(t);
  globalThis.__fakeCliRun = { stdout: [], stderr: [], code: 0 };
  const response = await post({ kind: "pdf", cliId: "kimi", input: "1" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /cannot run worker 'pdf': it cannot be kept from running shell commands/);
  assert.equal(globalThis.__fakeCliRun.spawned, undefined);
});

test("Kimi is refused for the write-capable portal repair worker before anything spawns", async (t) => {
  fixtureRoot(t);
  globalThis.__fakeCliRun = { stdout: [], stderr: [], code: 0 };
  const response = await post({ kind: "fix-portal", cliId: "kimi", input: "Fixture Co" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /cannot run write-capable worker 'fix-portal'/);
  assert.equal(globalThis.__fakeCliRun.spawned, undefined);
});
