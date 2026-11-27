import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  windowsCommandLineLength,
  launchIsOversized,
  spillOversizedPrompt,
  WIN32_COMMAND_LINE_LIMIT,
  POSIX_ARG_LIMIT,
} from "../../src/lib/oversized-prompt.mjs";

import { claudeCliArgs } from "../../src/lib/claude-invocation.mjs";
import { capabilitiesFor } from "../../src/lib/worker-capabilities.mjs";

// Real claude argv for an evaluate run, so fencing validation passes as in the route.
const fencing = { cliId: "claude", capabilities: capabilitiesFor("evaluate") };
const buildArgs = prompt => claudeCliArgs({ kind: "evaluate", prompt });
const promptOf = args => args[args.indexOf("-p") + 1];

test("windows quoting follows libuv rules", () => {
  assert.equal(windowsCommandLineLength("a", ["b"]), "a b".length);
  assert.equal(windowsCommandLineLength("a", ["b c"]), `a "b c"`.length);
  assert.equal(windowsCommandLineLength("a", [""]), `a ""`.length);
  // a quote is escaped, and the arg is wrapped because it contains one
  assert.equal(windowsCommandLineLength("a", ['x"y']), `a "x\\"y"`.length);
  // backslashes before a quote are doubled, and again before the closing quote
  assert.equal(windowsCommandLineLength("a", ['x\\"y z\\']), `a "x\\\\\\"y z\\\\"`.length);
});

test("win32: a prompt just under the limit is not oversized, just over is", () => {
  const under = "x".repeat(WIN32_COMMAND_LINE_LIMIT - 2000);
  const over = "x".repeat(WIN32_COMMAND_LINE_LIMIT + 10);
  assert.equal(launchIsOversized("claude", buildArgs(under), "win32"), false);
  assert.equal(launchIsOversized("claude", buildArgs(over), "win32"), true);
});

test("win32: quote escaping counts toward the limit", () => {
  const quotes = '"'.repeat(Math.ceil(WIN32_COMMAND_LINE_LIMIT / 2));
  assert.equal(quotes.length < WIN32_COMMAND_LINE_LIMIT, true);
  assert.equal(launchIsOversized("claude", buildArgs(quotes), "win32"), true);
  // the same length without quotes fits, so the escaping is what pushed it over
  assert.equal(launchIsOversized("claude", buildArgs("x".repeat(quotes.length)), "win32"), false);
});

test("posix: the single-argument byte cap applies, not the total", () => {
  const big = "x".repeat(POSIX_ARG_LIMIT + 1);
  const ok = "x".repeat(40000);
  assert.equal(launchIsOversized("claude", buildArgs(ok), "linux"), false);
  assert.equal(launchIsOversized("claude", buildArgs(big), "linux"), true);
  // multibyte: 3 bytes per char
  assert.equal(launchIsOversized("claude", buildArgs("€".repeat(POSIX_ARG_LIMIT / 3 + 10)), "linux"), true);
});

test("a prompt that fits is returned untouched with no file", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-spill-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = spillOversizedPrompt({ prompt: "short", buildArgs, binPath: "claude", fencing, root, platform: "win32" });
  assert.equal(r.spilled, false);
  assert.deepEqual(r.args, buildArgs("short"));
  assert.equal(r.cleanup, undefined);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("an oversized prompt is written whole to a file and argv references it", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-spill-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prompt = `Posting: ${JSON.stringify("https://jobs.example.test/1")}\n` + "p".repeat(40000);
  const r = spillOversizedPrompt({ prompt, buildArgs, binPath: "claude", fencing, root, platform: "win32" });
  assert.equal(r.spilled, true);
  assert.equal(launchIsOversized("claude", r.args, "win32"), false);
  assert.ok(!r.args.join(" ").includes("pppppppp"));
  const dirs = fs.readdirSync(root);
  assert.equal(dirs.length, 1);
  const file = path.join(root, dirs[0], "instructions.md");
  assert.equal(fs.readFileSync(file, "utf8"), prompt);
  assert.ok(promptOf(r.args).includes(JSON.stringify(file)));
  assert.match(promptOf(r.args), /completely/);
  r.cleanup();
  assert.deepEqual(fs.readdirSync(root), []);
});

test("a launch still oversized after spilling throws and leaves no file behind", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-spill-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // every argv this builder makes is oversized, including the short pointer prompt
  const alwaysHuge = prompt => buildArgs(prompt + "z".repeat(WIN32_COMMAND_LINE_LIMIT));
  assert.throws(
    () => spillOversizedPrompt({ prompt: "p".repeat(40000), buildArgs: alwaysHuge, binPath: "claude", fencing, root, platform: "win32" }),
    /too long even after moving the prompt to a file/,
  );
  assert.deepEqual(fs.readdirSync(root), []);
});
