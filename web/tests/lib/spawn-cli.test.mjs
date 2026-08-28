// Tests for spawnHeadlessCli() using Node's built-in test runner.
// Imports directly from spawn-cli.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/spawn-cli.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnHeadlessCli } from "../../src/lib/spawn-cli.mjs";
import { CODEX_WINDOWS_LAUNCH_ERROR } from "../../src/lib/cli-launcher.mjs";

test("spawnHeadlessCli closes stdin so a headless CLI can start", async () => {
  // Given: a child that only speaks once its stdin has reached EOF — a stand-in
  // for `codex exec`, which waits on an open stdin pipe for more prompt input
  // and so produces no stdout at all until it is closed (#2085).
  const script = [
    'process.stdin.on("end", () => process.stdout.write("READY"));',
    "process.stdin.resume();",
  ].join("");

  // When: it is spawned through the shared headless spawner.
  const child = spawnHeadlessCli(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    env: process.env,
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });

  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  // If stdin regressed and stayed open, fail fast with a clear message instead
  // of hanging until the test runner's own timeout.
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("child did not close — stdin may not have been closed")), 3000);
  });

  const code = await Promise.race([closed, timedOut]);
  clearTimeout(timer); // don't keep node --test alive 3s after a clean close

  // Then: it saw EOF, spoke, and exited cleanly.
  assert.equal(code, 0);
  assert.equal(stdout, "READY");
});

test("spawnHeadlessCli tolerates a caller that passes stdio itself", async () => {
  // Given: no call site spells stdio today — the typed options omit it so
  // stdout/stderr stay non-null pipes. But an untyped or future caller could
  // pass stdio: ["ignore", …], which makes child.stdin null, and a hard
  // .end() would then throw. This pins the optional call that prevents it.
  const child = spawnHeadlessCli(process.execPath, ["-e", 'process.stdout.write("OK")'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // When: the child runs to completion.
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  // Then: no stdin pipe existed, and the run still succeeded.
  assert.equal(child.stdin, null);
  assert.equal(code, 0);
  assert.equal(stdout, "OK");
});

test("explicit stdin prompt mode writes the large prompt exactly once and closes stdin", async () => {
  const prompt = "MANUAL JOB EVALUATION\n" + "x".repeat(60_000);
  let received = "";
  const script = 'process.stdin.setEncoding("utf8");process.stdin.on("data",d=>process.stdout.write(d));';
  const child = spawnHeadlessCli(process.execPath, ["-e", script, "-"], { cwd: process.cwd(), env: process.env }, { stdinMode: "pipe", stdinInput: prompt });
  child.stdout.on("data", (chunk) => { received += chunk; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(code, 0); assert.equal(received, prompt); assert.equal(received.length, prompt.length);
});

test("Windows Codex E2BIG receives a specific command-size error", async () => {
  const fakeSpawn = () => { const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true; queueMicrotask(() => { const error = new Error("spawn E2BIG"); error.code = "E2BIG"; child.emit("error", error); }); return child; };
  const child = spawnHeadlessCli("C:\\npm\\codex.cmd", ["exec", "-"], { env: { ComSpec: "C:\\Windows\\cmd.exe" } }, { platform: "win32", spawnFn: fakeSpawn, stdinMode: "pipe", stdinInput: "large prompt" });
  const error = await new Promise((resolve) => child.once("error", resolve));
  assert.match(error.message, /command was too large for the Windows launcher/);
});

test("Windows Codex spawn failure surfaces a clear launcher error", async () => {
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    queueMicrotask(() => { const error = new Error("spawn codex.cmd ENOENT"); error.code = "ENOENT"; child.emit("error", error); });
    return child;
  };
  const child = spawnHeadlessCli("C:\\npm\\codex.cmd", ["exec", "prompt"], { env: { ComSpec: "C:\\Windows\\cmd.exe" } }, { platform: "win32", spawnFn: fakeSpawn });
  const error = await new Promise((resolve) => child.once("error", resolve));
  assert.equal(error.message, CODEX_WINDOWS_LAUNCH_ERROR);
});

test("a real Windows cmd shim streams output and preserves its exit code", { skip: process.platform !== "win32" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "co-codex-shim-"));
  const shim = path.join(dir, "codex.cmd");
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" -e "process.stdout.write(process.argv.slice(1).join('|'))" %*\r\nexit /b 7\r\n`);
  try {
    const child = spawnHeadlessCli(shim, ["alpha", "beta"], { cwd: dir, env: process.env });
    let output = ""; child.stdout.on("data", (chunk) => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(output, "alpha|beta");
    assert.equal(code, 7);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a Windows codex.cmd shim receives a 60KB worker prompt through stdin", { skip: process.platform !== "win32" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "co-codex-stdin-"));
  const shim = path.join(dir, "codex.cmd");
  const prompt = "MANUAL JOB EVALUATION\n" + "x".repeat(60_000);
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" -e "process.stdin.pipe(process.stdout)" %*\r\n`);
  try {
    const child = spawnHeadlessCli(shim, ["exec", "-"], { cwd: dir, env: process.env }, { stdinMode: "pipe", stdinInput: prompt });
    let output = ""; child.stdout.on("data", (chunk) => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(code, 0); assert.equal(output, prompt);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
