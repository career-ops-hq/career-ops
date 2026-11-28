import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";
import {
  codexStreamArgs,
  isFatalCodexStderr,
  isFatalGenericStderr,
  isFatalKimiStderr,
  kimiStderrErrors,
  kimiStreamArgs,
  parseCodexEvent,
  parseKimiEvent,
} from "../../src/lib/run-cli-support.mjs";
import { fenceArgs, fencingReport, isCliAllowedForCapabilities } from "../../src/lib/cli-fencing.mjs";
import { capabilitiesFor } from "../../src/lib/worker-capabilities.mjs";

const { KNOWN, detectClis, findBin, resolveCli } = await import("../../src/lib/clis.ts");

const kimi = KNOWN.find((cli) => cli.id === "kimi");
const AUTO_APPROVE = ["--yolo", "-y", "--yes", "--auto", "--auto-approve", "--plan"];

test("Kimi Code CLI is registered with its documented one-shot invocation", () => {
  assert.ok(kimi, "KNOWN is missing the kimi entry");
  assert.equal(kimi.name, "Kimi Code CLI");
  assert.equal(kimi.bin, "kimi");
  assert.equal(kimi.run, "kimi -p");
  assert.equal(kimi.url, "https://www.kimi.com/code/docs/en/");
  assert.deepEqual(kimi.args("hello"), ["-p", "hello"]);
  assert.equal(kimi.streamArgs, kimiStreamArgs);
  assert.equal(kimi.parseEvent, parseKimiEvent);
  assert.equal(kimi.stderrIsFatal, isFatalKimiStderr);
});

test("Kimi argv keeps the prompt as one last element and never grants approval", () => {
  const prompt = '--yolo; rm -rf ~ && echo "$(whoami)" `id` | tee out';
  for (const args of [kimi.args(prompt), kimi.streamArgs(prompt)]) {
    assert.equal(args.at(-1), prompt);
    assert.equal(args.at(-2), "-p");
    assert.equal(args.filter((arg) => arg === prompt).length, 1);
    assert.deepEqual(args.slice(0, -1).filter((arg) => AUTO_APPROVE.includes(arg)), []);
  }
  assert.deepEqual(kimiStreamArgs("hi"), ["--output-format", "stream-json", "-p", "hi"]);
});

test("Kimi is passed through fencing untouched and reported as unrestricted", () => {
  const args = kimiStreamArgs("hi");
  for (const kind of ["pdf", "research", "evaluate", "cover"]) {
    assert.deepEqual(fenceArgs({ cliId: "kimi", args, capabilities: capabilitiesFor(kind) }).args, args);
  }
  const report = fencingReport({ cliId: "kimi", cliName: kimi.name, capabilities: capabilitiesFor("research") });
  assert.equal(report.level, "none");
  assert.match(report.notice, /^Kimi Code CLI cannot be permission-restricted/);
});

test("Kimi is refused for write-capable workers and kept for the others", () => {
  assert.equal(isCliAllowedForCapabilities("kimi", capabilitiesFor("fix-portal")), false);
  assert.equal(isCliAllowedForCapabilities("kimi", { writes: true, network: false }), false);
  for (const kind of ["pdf", "research", "evaluate", "cover"]) {
    assert.equal(isCliAllowedForCapabilities("kimi", capabilitiesFor(kind)), true, kind);
  }
});

test("the write gate is unchanged for every other runtime", () => {
  const writer = capabilitiesFor("fix-portal");
  assert.equal(isCliAllowedForCapabilities("hermes", writer), false);
  for (const cli of KNOWN.filter((c) => c.id !== "kimi" && c.id !== "hermes")) {
    assert.equal(isCliAllowedForCapabilities(cli.id, writer), true, cli.id);
  }
});

test("parses Kimi assistant text, string or structured, as one finished line", () => {
  assert.deepEqual(parseKimiEvent(JSON.stringify({ role: "assistant", content: "Checking the posting" })), {
    text: "Checking the posting\n",
  });
  assert.deepEqual(
    parseKimiEvent(JSON.stringify({ role: "assistant", content: [{ type: "text", text: "one" }, { type: "image" }, { type: "text", text: " two\n" }] })),
    { text: "one two\n" },
  );
  assert.deepEqual(parseKimiEvent(JSON.stringify({ role: "assistant", content: "Ünïcödé — 日本語 ✓" })), {
    text: "Ünïcödé — 日本語 ✓\n",
  });
});

test("reports a Kimi tool call when the message carries no text", () => {
  assert.deepEqual(
    parseKimiEvent(JSON.stringify({ role: "assistant", content: "", tool_calls: [{ function: { name: "ReadFile", arguments: "{}" } }] })),
    { tool: "ReadFile" },
  );
  assert.deepEqual(parseKimiEvent(JSON.stringify({ role: "assistant", content: [], tool_calls: [{}, { name: " Shell " }] })), { tool: "Shell" });
  assert.deepEqual(parseKimiEvent(JSON.stringify({ role: "assistant", content: "Reading it", tool_calls: [{ name: "ReadFile" }] })), {
    text: "Reading it\n",
  });
});

test("drops Kimi tool results, session hints and malformed lines", () => {
  assert.equal(parseKimiEvent(JSON.stringify({ role: "tool", content: "a large tool result" })), null);
  assert.equal(parseKimiEvent(JSON.stringify({ type: "session.resume_hint", session_id: "sess-fixture" })), null);
  assert.equal(parseKimiEvent(JSON.stringify({ role: "assistant", content: "   ", tool_calls: [] })), null);
  assert.equal(parseKimiEvent(JSON.stringify({ role: "assistant", content: { text: "not a part list" } })), null);
  for (const line of ["", "not json", "null", "42", '"text"', "[]", '{"role":"assistant"'])
    assert.equal(parseKimiEvent(line), null, line);
});

test("Kimi stderr is fatal only for authentication, quota and balance failures", () => {
  for (const line of [
    "Error: unauthorized",
    "not authenticated, run `kimi login`",
    "please log in to continue",
    "quota exceeded for this account",
    "rate limit reached",
    "Insufficient account balance",
    "Error code: 401 - The API Key appears to be invalid or may have expired",
    "Invalid Authentication",
    "You've reached your 5-hour usage limit",
    "You've reached your monthly usage limit for this billing cycle",
    "Your credit balance is insufficient",
  ]) assert.equal(isFatalKimiStderr(line), true, line);
  for (const line of [
    "thinking: the error handling here looks fine",
    "Using tool ReadFile",
    "rate limit hit, retrying in 5s",
    "Authentication successful",
    "We're receiving too many requests at the moment",
    "The engine is currently overloaded",
    "thinking: check the usage limits section of the posting",
  ]) assert.equal(isFatalKimiStderr(line), false, line);
});

test("kimiStderrErrors keeps only the actionable lines of a stderr chunk", () => {
  assert.equal(kimiStderrErrors("thinking about the error path\nnot authenticated\r\nUsing tool Shell\n"), "not authenticated");
  assert.equal(kimiStderrErrors("thinking: denied access is a fatal error in prose\n"), "");
  assert.equal(kimiStderrErrors(""), "");
});

test("the Codex and generic paths are unchanged by the Kimi parser", () => {
  assert.deepEqual(codexStreamArgs("hi"), ["exec", "--json", "--color", "never", "hi"]);
  assert.deepEqual(parseCodexEvent(JSON.stringify({ type: "thread.started" })), { status: "Agent ready" });
  assert.equal(isFatalCodexStderr("Error: unauthorized"), true);
  assert.equal(isFatalGenericStderr("fatal: boom"), true);
  assert.equal(parseKimiEvent(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "codex" } })), null);
  const byId = Object.fromEntries(KNOWN.map((c) => [c.id, c]));
  assert.deepEqual(byId.claude.args("p"), ["-p", "p"]);
  assert.deepEqual(byId.codex.args("p"), ["exec", "p"]);
  assert.deepEqual(byId.grok.streamArgs("p"), ["-p", "p", "--output-format", "streaming-json"]);
  assert.equal(byId.gemini.parseEvent, undefined);
});

function isolatedHome(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-kimi-home-"));
  const emptyPath = path.join(root, "empty-path");
  fs.mkdirSync(emptyPath);
  const saved = {};
  for (const key of ["HOME", "USERPROFILE", "PATH", "LOCALAPPDATA", "APPDATA"]) saved[key] = process.env[key];
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.PATH = emptyPath;
  process.env.LOCALAPPDATA = path.join(root, "AppData", "Local");
  process.env.APPDATA = path.join(root, "AppData", "Roaming");
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

const SYSTEM_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

test("finds Kimi in the Kimi Code install directory without it being on PATH", (t) => {
  const home = isolatedHome(t);
  const binDir = path.join(home, ".kimi-code", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const exe = path.join(binDir, process.platform === "win32" ? "kimi.exe" : "kimi");
  fs.writeFileSync(exe, "");
  fs.chmodSync(exe, 0o755);

  assert.equal(resolveCli("kimi")?.binPath, exe);
  const entry = detectClis().find((cli) => cli.id === "kimi");
  assert.deepEqual(entry, { id: "kimi", name: "Kimi Code CLI", run: "kimi -p", url: "https://www.kimi.com/code/docs/en/", installed: true, path: exe });
});

test("finds Kimi on PATH like every other runtime", (t) => {
  const home = isolatedHome(t);
  const exe = path.join(process.env.PATH, process.platform === "win32" ? "kimi.exe" : "kimi");
  fs.writeFileSync(exe, "");
  fs.chmodSync(exe, 0o755);
  assert.ok(home);
  assert.equal(resolveCli("kimi")?.binPath, exe);
});

test("reports Kimi as unavailable when the binary is missing", (t) => {
  isolatedHome(t);
  if (findBin("kimi", SYSTEM_DIRS)) {
    t.skip("a kimi binary is installed system-wide on this machine");
    return;
  }
  assert.equal(resolveCli("kimi"), null);
  const entry = detectClis().find((cli) => cli.id === "kimi");
  assert.equal(entry.installed, false);
  assert.equal(entry.path, null);
});

test("a non-executable kimi file is not reported as installed", { skip: process.platform === "win32" && "POSIX permission bits only" }, (t) => {
  const home = isolatedHome(t);
  if (findBin("kimi", SYSTEM_DIRS)) {
    t.skip("a kimi binary is installed system-wide on this machine");
    return;
  }
  const binDir = path.join(home, ".kimi-code", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "kimi"), "");
  fs.chmodSync(path.join(binDir, "kimi"), 0o644);
  assert.equal(resolveCli("kimi"), null);
});
