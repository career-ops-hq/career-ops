import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire, registerHooks } from "node:module";
import * as React from "react";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import { setTimeout as delay } from "node:timers/promises";
import "../helpers/web-ts-alias-loader.mjs";
import { makeAiStreamParser } from "../../src/lib/explore-ai.ts";
import * as exploreAi from "../../src/lib/explore-ai.ts";
import * as explore from "../../src/lib/explore.ts";
import * as exploreState from "../../src/lib/explore-state.mjs";
import * as exploreError from "../../src/lib/explore-error.mjs";

await loadBindings();
const require = createRequire(import.meta.url);
const { code: providerCode } = await transform(fs.readFileSync(new URL('../../src/components/explore/explore-provider.tsx', import.meta.url), 'utf8'), {
  filename:'explore-provider.tsx', jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}}}, module:{type:'commonjs'},
});

async function providerOutcome(t, text) {
  const slots = [];
  let cursor = 0;
  const hooks = { ...React, useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  }, useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = {current:initial};
    return slots[index];
  }, useCallback:fn => fn, useMemo:fn => fn(), useEffect() {} };
  for (const [name, value] of Object.entries({
    sessionStorage:{getItem:() => null}, localStorage:{getItem:() => '{"cliId":"claude"}'},
    window:{history:{replaceState() {}},setTimeout:fn => fn()},
    fetch:async url => url === '/api/explore/ai/known' ? Response.json({urls:[]}) : new Response(text),
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable:true,value});
    t.after(() => descriptor ? Object.defineProperty(globalThis,name,descriptor) : delete globalThis[name]);
  }
  const module = {exports:{}};
  new Function('require','module','exports',providerCode)(id => ({
    react:hooks, 'next/navigation':{useRouter:() => ({refresh() {}})}, '@/lib/explore':explore,
    '@/lib/explore-ai':exploreAi, '@/lib/explore-state.mjs':exploreState, '@/lib/explore-error.mjs':exploreError,
    '@/lib/whats-new.mjs':{},
  }[id] ?? require(id)),module,module.exports);
  const render = () => { cursor = 0; return module.exports.ExploreProvider({children:null}).props.value; };
  render().setAiIntent('Synthetic public search');
  await render().discoverAI();
  return render();
}

// The existing alias loader handles @/. The route also imports ./prompt without
// an extension, which Next resolves but Node's ESM loader does not.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !path.extname(specifier) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (fs.existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { POST } = await import("../../src/app/api/explore/ai/route.ts");
const seenCwds = new Set();
const agents = [
  { id: "claude", bin: "claude", name: "Claude Code" },
  { id: "codex", bin: "codex", name: "Codex" },
];
const blockedAgents = [
  { id: "gemini", bin: "gemini", name: "Gemini CLI", reason: /plan|pol[ií]tica/i },
  { id: "cursor", bin: "agent", name: "Cursor Agent", reason: /hook/i },
];
const unsupportedAgents = [
  { id: "opencode", bin: "opencode", name: "OpenCode" },
  { id: "qwen", bin: "qwen", name: "Qwen CLI" },
];
const offer = { url: "https://example.test/jobs/42", title: "Designer", company: "Synthetic", location: "Lisboa", source: "ai-search", verification: "unconfirmed" };
const envelope = `<<offer:${JSON.stringify(offer)}>>`;

function fixture(t, behavior = "success") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-ai-route-test-")));
  const bins = path.join(root, "bin");
  const data = path.join(root, "data");
  const code = path.join(root, "checkout");
  for (const dir of [bins, data, path.join(code, "modes")]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(code, "modes", "web-search.md"), "SYNTHETIC WEB SEARCH MODE");
  for (const dir of [code, data]) fs.writeFileSync(path.join(dir, "sentinel.txt"), "PRESERVE");
  const recordFile = path.join(root, "invocations.jsonl");
  // Real OS processes exercise the real resolver, probe, fencer, stream and
  // cleanup. Only the external model binaries are replaced.
  for (const { id, bin } of [...agents, ...unsupportedAgents, ...blockedAgents]) {
    const script = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write("--ask-for-approval <POLICY>\\n--search\\n--config <KEY>\\n--sandbox <MODE> [possible values: read-only, workspace-write]\\n--strict-config\\n--ignore-user-config\\n--ephemeral\\n--skip-git-repo-check\\n--output-last-message <FILE>\\n");
  process.exit(0);
}
const resultPath = args[args.indexOf("--output-last-message") + 1];
const resultDir = args.includes("--output-last-message") ? fs.realpathSync(require("node:path").dirname(resultPath)) : null;
const behavior = ${JSON.stringify(behavior)};
if (behavior === "ignore-term") process.on("SIGTERM", () => {});
fs.appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify({ id: ${JSON.stringify(id)}, args, cwd: process.cwd(), pid: process.pid, resultDir, home: process.env.HOME }) + "\\n");
process.stderr.write("fatal SECRET_FROM_STDERR query=PRIVATE_PROMPT\\n");
if (behavior === "empty") {
  process.exitCode = 0;
} else if (behavior === "hang" || behavior === "ignore-term") {
  setInterval(() => {}, 1000);
} else if (behavior === "failure" || behavior === "whitespace-failure") {
  if (behavior === "whitespace-failure") process.stdout.write("   ");
  process.exitCode = 7;
} else {
  const text = behavior === "partial-failure" ? 'Searching... <<offer:{"url":"https://example.test/jobs/42"' : behavior === "invalid-failure" ? '<<offer:{"url":"not-a-url","title":"Designer","company":"Synthetic"}>>' : ${JSON.stringify(envelope)};
  if (${JSON.stringify(id)} === "codex") {
    fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], text);
    process.stdout.write("PRIVATE_CODEX_TRANSCRIPT");
  } else if (${JSON.stringify(id)} === "claude") {
    process.stdout.write(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { text } } }) + "\\n");
  } else process.stdout.write(text);
  if (["success-nonzero", "partial-failure", "invalid-failure"].includes(behavior)) process.exitCode = 7;
}
`;
    fs.writeFileSync(path.join(bins, bin), script, { mode: 0o755 });
  }
  const values = { PATH: bins, CAREER_OPS_ROOT: data, CAREER_OPS_DATA_DIR: data, CAREER_OPS_CODE_ROOT: code };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    if (fs.existsSync(recordFile)) {
      for (const record of records()) {
        try { process.kill(record.pid, "SIGKILL"); } catch { /* already reaped */ }
        if (record.cwd.startsWith(path.join(fs.realpathSync(os.tmpdir()), "career-ops-")) && record.cwd !== root && !record.cwd.startsWith(root + path.sep)) {
          fs.rmSync(record.cwd, { recursive: true, force: true });
        }
      }
    }
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const records = () => fs.existsSync(recordFile) ? fs.readFileSync(recordFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  return { root, bins, code, data, records };
}

function invoke(cliId) {
  return POST(new Request("http://localhost/api/explore/ai", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cliId, query: "designer em Lisboa" }),
  }));
}

async function waitFor(predicate, message) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

function assertPreserved(f) {
  for (const dir of [f.code, f.data]) assert.equal(fs.readFileSync(path.join(dir, "sentinel.txt"), "utf8"), "PRESERVE");
  assert.deepEqual(fs.readdirSync(f.data), ["sentinel.txt"]);
  assert.deepEqual(fs.readdirSync(f.code).sort(), ["modes", "sentinel.txt"]);
}

for (const { id, name } of agents) {
  test(`${id}: requested binary runs in a fresh isolated cwd with read-only flags and a usable offer`, async (t) => {
    const f = fixture(t);
    const response = await invoke(id);
    assert.equal(response.status, 200);
    const text = await response.text();
    const [record] = f.records();
    assert.equal(f.records().length, 1, "no CLI substitution or extra agent invocation");
    assert.equal(record.id, id);
    assert.ok(!record.cwd.startsWith(f.root + path.sep), "cwd must be outside the synthetic checkout and data root");
    assert.ok(!seenCwds.has(record.cwd), "each invocation needs a fresh directory");
    seenCwds.add(record.cwd);
    assert.equal(fs.existsSync(record.cwd), false, "completion removes the invocation directory");
    assert.equal(record.home, process.env.HOME, "authenticated HOME must survive");
    const args = record.args;
    if (id === "claude") {
      assert.ok(args.includes("--strict-mcp-config"));
      assert.ok(!args.includes("--mcp-config"));
      assert.equal(args[args.indexOf("--allowedTools") + 1], "Read,WebFetch,WebSearch,Glob,Grep");
      const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
      for (const tool of ["Write", "Edit", "MultiEdit", "Bash", "NotebookEdit", "Task"]) assert.ok(denied.includes(tool));
    } else if (id === "codex") {
      assert.ok(args.includes("sandbox_mode=read-only"));
      assert.ok(args.includes("--search"));
      assert.equal(args[args.indexOf("--ask-for-approval") + 1], "never");
      for (const flag of ["--strict-config", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check"]) assert.ok(args.includes(flag));
      assert.equal(record.resultDir, record.cwd);
      assert.doesNotMatch(text, /PRIVATE_CODEX_TRANSCRIPT/);
    }
    assert.doesNotMatch(text, /SECRET_FROM_STDERR|PRIVATE_PROMPT/);
    const parsed = makeAiStreamParser().feed(text);
    assert.equal(parsed.filter((chunk) => chunk.kind === "offer").length, 1);
    assert.equal(parsed.find((chunk) => chunk.kind === "offer").offer.url, offer.url);
    assert.equal(parsed.find(chunk => chunk.kind === 'terminal')?.status, 'success');
    assertPreserved(f);
  });

  test(`${id}: non-zero exit emits a bounded agent diagnostic without stderr`, async (t) => {
    const f = fixture(t, "failure");
    const response = await invoke(id);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes(name));
    assert.match(text, /(?:code|código) 7/);
    assert.ok(text.length < 400, "diagnostics are bounded");
    assert.doesNotMatch(text, /SECRET_FROM_STDERR|PRIVATE_PROMPT/);
    assert.equal(fs.existsSync(f.records()[0].cwd), false);
    assertPreserved(f);
    const outcome = await providerOutcome(t, text);
    assert.equal(outcome.phase, 'failed');
    assert.match(outcome.error, /(?:code|código) 7/);
  });

  test(`${id}: stream cancellation terminates the child and removes its directory`, async (t) => {
    const f = fixture(t, "hang");
    const response = await invoke(id);
    assert.equal(response.status, 200);
    await waitFor(() => f.records().length === 1, "fixture never started");
    const { cwd, pid } = f.records()[0];
    await response.body.cancel();
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "cancelled child remains alive");
    assert.equal(fs.existsSync(cwd), false, "cancel must clean up without relying on a subsequent close");
    assertPreserved(f);
  });

  test(`${id}: timeout kills a child ignoring SIGTERM and removes its directory`, { timeout: 10_000 }, async (t) => {
    const f = fixture(t, "ignore-term");
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const response = await invoke(id);
    assert.equal(response.status, 200);
    await waitFor(() => f.records().length === 1, "fixture never started");
    t.mock.timers.tick(480_000);
    t.mock.timers.tick(5_000);
    const text = await response.text();
    const { pid } = f.records()[0];
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "timed-out child remains alive");
    assert.match(text, /tempo limite/);
    assert.doesNotMatch(text, /SECRET_FROM_STDERR|PRIVATE_PROMPT/);
    assert.equal(fs.existsSync(f.records()[0].cwd), false, "timeout must remove cwd");
    assertPreserved(f);
    const outcome = await providerOutcome(t, text);
    assert.equal(outcome.phase, 'failed');
    assert.match(outcome.error, /tempo limite/);
  });

  test(`${id}: spawn error removes the temporary directory and exposes no raw error`, async (t) => {
    const f = fixture(t);
    const agent = agents.find((agent) => agent.id === id);
    // Resolver still sees an executable; spawn then fails because its interpreter
    // is absent. Codex's real capability probe stays available through its cache.
    if (id === "codex") await (await invoke(id)).text();
    const realMkdtemp = fs.mkdtempSync;
    let cwd;
    t.mock.method(fs, "mkdtempSync", (...args) => { cwd = realMkdtemp(...args); return cwd; });
    if (id !== "codex") fs.writeFileSync(path.join(f.bins, agent.bin), "#!/nonexistent/PRIVATE_INTERPRETER\n");
    else {
      // Delete after the cached probe stat, immediately after creating cwd.
      t.mock.method(fs, "mkdtempSync", (...args) => { cwd = realMkdtemp(...args); fs.unlinkSync(path.join(f.bins, agent.bin)); return cwd; });
    }
    const response = await invoke(id);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes(name));
    assert.doesNotMatch(text, /PRIVATE_INTERPRETER|SECRET_FROM_STDERR|PRIVATE_PROMPT/);
    assert.ok(cwd && !fs.existsSync(cwd), "spawn error must clean the invocation directory");
    assertPreserved(f);
    const outcome = await providerOutcome(t, text);
    assert.equal(outcome.phase, 'failed');
    assert.match(outcome.error, /iniciar/);
  });
}

for (const { id } of agents) {
  test(`${id}: whitespace output does not hide a non-zero diagnostic`, async (t) => {
    fixture(t, "whitespace-failure");
    const text = await (await invoke(id)).text();
    assert.match(text, /(?:code|código) 7/);
  });

  test(`${id}: a usable result survives a non-zero exit with a structured partial receipt`, async (t) => {
    fixture(t, "success-nonzero");
    const text = await (await invoke(id)).text();
    assert.match(text, /<<offer:/);
    const parsed = makeAiStreamParser().feed(text);
    assert.equal(parsed.find(chunk => chunk.kind === 'terminal')?.status, 'partial');
    assert.doesNotMatch(parsed.filter(chunk => chunk.kind === 'narration').map(chunk => chunk.text).join(''), /(?:code|código) 7|SECRET_FROM_STDERR/);
    const outcome = await providerOutcome(t, text);
    assert.equal(outcome.phase, 'results');
    assert.equal(outcome.offers.length, 1);
    assert.equal(outcome.partial, true);
    assert.match(outcome.error, /(?:code|código) 7/);
  });

  test(`${id}: successful zero remains empty with a structured success receipt`, async t => {
    fixture(t, 'empty');
    const text = await (await invoke(id)).text();
    const parsed = makeAiStreamParser().feed(text);
    assert.equal(parsed.find(chunk => chunk.kind === 'terminal')?.status, 'success');
    const outcome = await providerOutcome(t, text);
    assert.equal(outcome.phase, 'empty-loose');
    assert.equal(outcome.error, '');
  });
}

test("Claude: invocation disables user hooks without replacing authenticated HOME", async (t) => {
  const f = fixture(t);
  const response = await invoke("claude");
  assert.equal(response.status, 200);
  await response.text();
  const [record] = f.records();
  const settingsIndex = record.args.indexOf("--settings");
  assert.notEqual(settingsIndex, -1, "user hooks need an explicit per-invocation override");
  assert.equal(JSON.parse(record.args[settingsIndex + 1]).disableAllHooks, true);
  assert.equal(record.home, process.env.HOME);
  assertPreserved(f);
});

for (const { id, name } of agents) {
  for (const behavior of ["partial-failure", "invalid-failure"]) {
    test(`${id}: ${behavior} cannot hide a non-zero diagnostic`, async (t) => {
      const f = fixture(t, behavior);
      const response = await invoke(id);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(text.includes(name));
      assert.match(text, /(?:code|código) 7/);
      assert.doesNotMatch(text, /SECRET_FROM_STDERR|PRIVATE_PROMPT|PRIVATE_CODEX_TRANSCRIPT/);
      assert.equal(fs.existsSync(f.records()[0].cwd), false);
      assertPreserved(f);
    });
  }
}

for (const { id, name } of unsupportedAgents) {
  test(`${id}: assisted search rejects an uncertified runtime before creating a workspace or spawning`, async (t) => {
    const f = fixture(t);
    const mkdtemp = t.mock.method(fs, "mkdtempSync", () => assert.fail("uncertified runtime must not create a workspace"));
    const response = await invoke(id);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "CLI_UNFENCED");
    assert.ok(body.error.includes(name));
    assert.equal(mkdtemp.mock.callCount(), 0);
    assert.deepEqual(f.records(), []);
    assertPreserved(f);
  });
}

for (const { id, name, reason } of blockedAgents) {
  test(`${id}: unsafe runtime is refused before prompt reads, temporary workspace and spawn`, async (t) => {
    const f = fixture(t);
    const readFile = fs.readFileSync;
    let promptReads = 0;
    t.mock.method(fs, "readFileSync", (file, ...args) => {
      if (String(file) === path.join(f.code, "modes", "web-search.md")) promptReads++;
      return readFile(file, ...args);
    });
    const mkdtemp = t.mock.method(fs, "mkdtempSync", () => assert.fail("unsafe runtime must not create a workspace"));
    const response = await invoke(id);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "CLI_UNFENCED");
    assert.ok(body.error.includes(name));
    assert.match(body.error, reason);
    assert.match(body.error, /Claude|Codex/);
    assert.equal(promptReads, 0, "blocked agent must not load the search prompt");
    assert.equal(mkdtemp.mock.callCount(), 0);
    assert.deepEqual(f.records(), []);
    assertPreserved(f);
  });
}
