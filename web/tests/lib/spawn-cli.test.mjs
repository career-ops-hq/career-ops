// Tests for spawnHeadlessCli() using Node's built-in test runner.
// Imports directly from spawn-cli.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/spawn-cli.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
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
