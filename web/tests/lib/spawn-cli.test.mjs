// Tests for spawnHeadlessCli() using Node's built-in test runner.
// Imports directly from spawn-cli.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/spawn-cli.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { spawnHeadlessCli } from "../../src/lib/spawn-cli.mjs";
import { CAPS } from "../../src/lib/worker-capabilities.mjs";

// Fencing is required at every call site (#2507). These cases are about stdin,
// not permissions, so they name a runtime with no verified fencing mechanism:
// its argv is passed through untouched, keeping the spawned command line exactly
// what each case wrote. (claude would be wrong here — it now VERIFIES the argv
// carries a deny list, which a bare `node -e` script does not.)
const PASSTHROUGH = { cliId: "gemini", capabilities: CAPS.localReadOnly };

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
  }, PASSTHROUGH);

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
  }, PASSTHROUGH);

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

test("spawnHeadlessCli applies fencing rather than spawning the raw argv", () => {
  // Given a codex invocation whose argv cli-fencing.mjs cannot place sandbox
  // flags into (no `exec` subcommand), so fencing it throws
  // When it is spawned through the shared spawner
  // Then the throw reaches the caller — which is only possible if the spawner
  // routes its argv through fenceArgs. Without this, a regression that dropped
  // the fencing call would leave every other test here passing: the child would
  // still start, still close stdin, and still be completely unsandboxed.
  assert.throws(
    () =>
      spawnHeadlessCli(process.execPath, ["-e", 'process.stdout.write("")'], { cwd: process.cwd(), env: process.env }, {
        cliId: "codex",
        capabilities: CAPS.localReadOnly,
      }),
    /must contain an "exec" subcommand/,
  );
});

test("spawnHeadlessCli refuses to spawn without a fencing declaration", () => {
  // Given the fencing argument is what applies the worker's permissions, omitting
  // it used to spread `undefined` into nothing — leaving cliId undefined, which
  // matches no fencer, so the raw argv was spawned with no error at all. The
  // docstring's "it does not compile" covers only the .ts call sites: checkJs is
  // off, so a .mjs caller gets no signal from tsc and would have silently run an
  // unrestricted agent.
  // When it is omitted, or supplied incomplete
  // Then the spawn is refused rather than performed unfenced.
  const spawnArgs = [process.execPath, ["-e", ""], { cwd: process.cwd(), env: process.env }];

  assert.throws(() => spawnHeadlessCli(...spawnArgs), /without \{cliId, capabilities\}/);
  assert.throws(() => spawnHeadlessCli(...spawnArgs, {}), /without \{cliId, capabilities\}/);
  assert.throws(() => spawnHeadlessCli(...spawnArgs, { cliId: "gemini" }), /without \{cliId, capabilities\}/);
  assert.throws(() => spawnHeadlessCli(...spawnArgs, { capabilities: CAPS.localReadOnly }), /without \{cliId, capabilities\}/);
});

test("spawnHeadlessCli never lets a child inherit the server's console (windowsHide)", () => {
  // Given: on Windows a child attaches to the parent's console, and a long-lived
  // dev server whose console has gone stale makes EVERY such child die at DLL
  // init with 0xC0000142, in ~20 ms and with no output at all (#3809). The flag
  // is a no-op on POSIX, so the only observable here is the options spawn() is
  // handed: record them instead of starting a process. spawn-cli.mjs holds a
  // live ESM binding to node:child_process, which syncBuiltinESMExports()
  // repoints at the recorder.
  const realSpawn = childProcess.spawn;
  const calls = [];
  childProcess.spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { stdin: { end() {} } };
  };
  syncBuiltinESMExports();
  try {
    // When: a caller spawns through the shared spawner, once with no opinion
    // and once explicitly asking for the console back.
    const base = { cwd: process.cwd(), env: process.env };
    spawnHeadlessCli(process.execPath, ["-e", ""], base, PASSTHROUGH);
    spawnHeadlessCli(process.execPath, ["-e", ""], { ...base, windowsHide: false }, PASSTHROUGH);
  } finally {
    childProcess.spawn = realSpawn;
    syncBuiltinESMExports();
  }

  // Then: both children are started hidden, and the caller's other options
  // still reach spawn() untouched.
  assert.equal(calls.length, 2);
  for (const { options } of calls) {
    assert.equal(options.windowsHide, true);
    assert.equal(options.detached, process.platform !== "win32");
    assert.equal(options.cwd, process.cwd());
    assert.equal(options.env, process.env);
  }
});

test("spawnHeadlessCli detaches on POSIX even when the caller says not to", () => {
  const realSpawn = childProcess.spawn;
  const calls = [];
  childProcess.spawn = (command, args, options) => {
    calls.push(options);
    return { stdin: { end() {} } };
  };
  syncBuiltinESMExports();
  try {
    spawnHeadlessCli(
      process.execPath,
      ["-e", ""],
      { cwd: process.cwd(), env: process.env, detached: false },
      PASSTHROUGH,
    );
  } finally {
    childProcess.spawn = realSpawn;
    syncBuiltinESMExports();
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].detached, process.platform !== "win32");
});

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitDead(pid, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (!pidAlive(pid)) return true;
    await sleep(100);
  }
  return !pidAlive(pid);
}

// Windows child.kill("SIGTERM") ends the process at once. The handler never
// runs, so the "still alive after SIGTERM" assertions fail there.
const skipPosixSignals = process.platform === "win32"
  ? "Windows kill() ends the process immediately, so a SIGTERM handler never runs"
  : false;

test("Stop follows SIGTERM with SIGKILL when the CLI ignores it", { timeout: 20_000, skip: skipPosixSignals }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "co-cli-stop-"));
  const termFile = join(dir, "term");
  const kidFile = join(dir, "kid");
  const kidReady = join(dir, "kid-ready");
  // The ready file is written after the handler. A group SIGTERM before that
  // kills the child with the default action, and the test would blame Stop.
  const ignore = [
    "process.on('SIGTERM', () => {});",
    `require('node:fs').writeFileSync(${JSON.stringify(kidReady)}, 'ready');`,
    "setInterval(() => {}, 500);",
  ].join("");
  const script = [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    `process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(termFile)}, 'term'));`,
    `const kid = spawn(process.execPath, ['-e', ${JSON.stringify(ignore)}], { stdio: 'ignore' });`,
    `fs.writeFileSync(${JSON.stringify(kidFile)}, String(kid.pid));`,
    "setInterval(() => {}, 500);",
  ].join("");
  const child = spawnHeadlessCli(process.execPath, ["-e", script], {
    cwd: dir,
    env: process.env,
    detached: true,
  }, PASSTHROUGH);
  const pids = [child.pid];
  try {
    const started = Date.now();
    while (!pidAlive(child.pid) || !existsSync(kidFile) || !existsSync(kidReady)) {
      if (Date.now() - started > 3000) break;
      await sleep(50);
    }
    const kidPid = Number(readFileSync(kidFile, "utf8"));
    pids.push(kidPid);
    child.kill("SIGTERM");
    await sleep(1000);
    assert.equal(pidAlive(child.pid), true, "the CLI must still be alive after SIGTERM");
    assert.equal(pidAlive(kidPid), true, "a child of that CLI must still be alive after SIGTERM");
    assert.equal(readFileSync(termFile, "utf8"), "term");
    assert.equal(await waitDead(child.pid, 7000), true, "SIGKILL must follow SIGTERM");
    assert.equal(await waitDead(kidPid, 2000), true, "SIGKILL must reach the CLI's own children");
  } finally {
    for (const pid of pids) {
      if (pid && pidAlive(pid)) {
        try { process.kill(-pid, "SIGKILL"); } catch { /* not a group */ }
        try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a detached descendant that ignores SIGTERM still gets the follow-up SIGKILL", { timeout: 20_000, skip: skipPosixSignals }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "co-cli-stop-desc-"));
  const kidFile = join(dir, "kid");
  const kidReady = join(dir, "kid-ready");
  const ignore = [
    "process.on('SIGTERM', () => {});",
    `require('node:fs').writeFileSync(${JSON.stringify(kidReady)}, 'ready');`,
    "setInterval(() => {}, 500);",
  ].join("");
  // The CLI itself keeps the default SIGTERM action and dies. Its child does not.
  const script = [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    `const kid = spawn(process.execPath, ['-e', ${JSON.stringify(ignore)}], { stdio: 'ignore' });`,
    `fs.writeFileSync(${JSON.stringify(kidFile)}, String(kid.pid));`,
    "setInterval(() => {}, 500);",
  ].join("");
  const child = spawnHeadlessCli(process.execPath, ["-e", script], {
    cwd: dir,
    env: process.env,
    detached: true,
  }, PASSTHROUGH);
  const pids = [child.pid];
  try {
    const started = Date.now();
    while (!pidAlive(child.pid) || !existsSync(kidFile) || !existsSync(kidReady)) {
      if (Date.now() - started > 3000) break;
      await sleep(50);
    }
    const kidPid = Number(readFileSync(kidFile, "utf8"));
    pids.push(kidPid);
    child.kill("SIGTERM");
    await sleep(1000);
    assert.equal(pidAlive(child.pid), false, "the CLI should die from SIGTERM");
    assert.equal(pidAlive(kidPid), true, "a descendant that ignores SIGTERM should still be running");
    assert.equal(await waitDead(kidPid, 8000), true, "SIGKILL must still reach that descendant");
  } finally {
    for (const pid of pids) {
      if (pid && pidAlive(pid)) {
        try { process.kill(-pid, "SIGKILL"); } catch { /* not a group */ }
        try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
