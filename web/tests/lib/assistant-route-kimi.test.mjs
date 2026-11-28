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
  const plan = globalThis.__fakeAssistantRun;
  plan.spawned = { args, fencing };
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
const { POST } = await import("../../src/app/api/assistant/route.ts");

async function ask(t, plan) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-kimi-assistant-"));
  const previousRoot = process.env.CAREER_OPS_ROOT;
  const previousCode = process.env.CAREER_OPS_CODE_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = root;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    if (previousCode === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
    else process.env.CAREER_OPS_CODE_ROOT = previousCode;
    delete globalThis.__fakeAssistantRun;
    fs.rmSync(root, { recursive: true, force: true });
  });
  globalThis.__fakeAssistantRun = { stdout: [], stderr: [], code: 0, ...plan };
  const response = await POST(new Request("http://fixture.invalid/api/assistant", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "What should I apply to?", cliId: "kimi", history: [] }),
  }));
  assert.equal(response.status, 200);
  return { text: await response.text(), spawned: globalThis.__fakeAssistantRun.spawned };
}

test("the assistant runs Kimi read-only with plain -p", async (t) => {
  const { spawned } = await ask(t, { stdout: ["ok\n"] });
  assert.equal(spawned.args[0], "-p");
  assert.equal(spawned.args.length, 2);
  assert.equal(spawned.fencing.cliId, "kimi");
  assert.equal(spawned.fencing.capabilities.writes, false);
});

test("the assistant keeps a multibyte character split across stdout chunks", async (t) => {
  const bytes = Buffer.from("• Montréal — Zürich ✓\n");
  const cut = bytes.indexOf(Buffer.from("é")) + 1;
  const { text } = await ask(t, { stdout: [bytes.subarray(0, cut), bytes.subarray(cut)] });
  assert.match(text, /• Montréal — Zürich ✓/);
  assert.equal(text.includes("�"), false);
});

test("the assistant surfaces a Kimi auth error split across stderr chunks", async (t) => {
  const { text } = await ask(t, {
    stderr: ["thinking: the user wants a shortlist\nError: Invalid Auth", "entication\n"],
    code: 1,
  });
  assert.match(text, /\[Kimi Code CLI\] Error: Invalid Authentication/);
  assert.doesNotMatch(text, /thinking: the user wants a shortlist/);
});

test("the assistant surfaces a final Kimi stderr line with no newline", async (t) => {
  const { text } = await ask(t, { stderr: ["Your credit balance", " is insufficient"], code: 1 });
  assert.match(text, /\[Kimi Code CLI\] Your credit balance is insufficient/);
});
