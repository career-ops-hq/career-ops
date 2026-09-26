// The launcher must not be startable in a way that quietly binds every interface.
//
// An earlier version of this suite asserted that tokens appeared in server.mjs's
// source text. Review showed that catches nothing: hardcoding `"-H", "0.0.0.0"`
// left it green, and so did dropping -H from argv entirely while keeping the
// literal alive in an unused constant. Substring checks cannot see what the
// launcher does.
//
// So it is run for real, against a stub `next` in a temp directory that prints
// the argv it was handed. No installed Next, no socket, no network — the whole
// bind decision is observable from the child's stdout, and the startup notice
// from its stderr.
//
// Lives in tests/lib/ rather than mirroring server.mjs's position at the web
// root because test-all.mjs's web-suite parity check fails any web suite outside
// tests/lib.
//
// Run:  node --test tests/lib/server-launcher.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A throwaway web/ whose `next` runs `body` instead of serving.
 *
 * @param {object} [options]
 * @param {string} [options.body]     the stub next's source; defaults to printing its argv
 * @param {boolean} [options.install] false to omit node_modules/next entirely
 */
function stubbedWebRoot({ body, install = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "career-ops-launcher-"));
  cpSync(join(WEB_ROOT, "server.mjs"), join(root, "server.mjs"));
  cpSync(join(WEB_ROOT, "src", "lib"), join(root, "src", "lib"), { recursive: true });
  if (!install) return root;

  const nextDir = join(root, "node_modules", "next");
  mkdirSync(join(nextDir, "dist", "bin"), { recursive: true });
  // No `exports` map, so the launcher's resolve of package.json + bin.next works
  // the same way it does against the real package.
  writeFileSync(
    join(nextDir, "package.json"),
    JSON.stringify({ name: "next", version: "0.0.0-stub", bin: { next: "./dist/bin/next.js" } }),
  );
  writeFileSync(
    join(nextDir, "dist", "bin", "next.js"),
    body ?? "console.log(JSON.stringify(process.argv.slice(2)));\n",
  );
  return root;
}

/** Run the launcher in a stub tree and report what `next` actually received. */
function launch({ args = ["dev"], env = {}, ...stub } = {}) {
  const root = stubbedWebRoot(stub);
  try {
    const result = spawnSync(process.execPath, [join(root, "server.mjs"), ...args], {
      encoding: "utf8",
      timeout: 30_000,
      // Explicit env: the developer running the suite may have the variable set.
      env: { PATH: process.env.PATH, ...env },
    });
    assert.equal(result.error, undefined, `launcher failed to run: ${result.error?.message}`);
    return {
      status: result.status,
      signal: result.signal,
      stderr: result.stderr,
      argv: result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- the bind next is actually told to use --------------------------------

test("with no opt-in, next is told to bind loopback", () => {
  // Given a default developer run
  // When the launcher starts next
  const run = launch({ args: ["dev"] });
  // Then nothing outside the machine can open a connection, and the notice names
  // the address — asserting only the phrase let a notice that announced the
  // resolved bind while next opened every interface pass unnoticed.
  assert.deepEqual(run.argv, ["dev", "-H", "127.0.0.1"]);
  assert.ok(run.stderr.includes("binding 127.0.0.1"), `stderr was: ${run.stderr}`);
  assert.ok(run.stderr.includes("loopback only"), "a loopback bind should be stated plainly");
});

test("a blank opt-in is not an opt-in", () => {
  // Given a variable that is set but names nothing
  // When the launcher starts next
  const run = launch({ args: ["dev"], env: { CAREER_OPS_WEB_ALLOWED_HOSTS: " , " } });
  // Then the bind is unchanged
  assert.deepEqual(run.argv, ["dev", "-H", "127.0.0.1"]);
});

test("an opt-in naming only loopback does not widen the bind", () => {
  // Given the value that used to open every interface while granting nothing
  // When the launcher starts next
  const run = launch({ args: ["dev"], env: { CAREER_OPS_WEB_ALLOWED_HOSTS: "localhost" } });
  // Then the socket stays on loopback
  assert.deepEqual(run.argv, ["dev", "-H", "127.0.0.1"], "a loopback-only opt-in must not widen");
  assert.ok(!run.stderr.includes("reachable from your network"), "and must not claim exposure");
});

test("an opt-in naming a real host widens the bind and says so", () => {
  // Given a hostname, which the launcher cannot resolve to one address
  // When the launcher starts next
  const run = launch({ args: ["start"], env: { CAREER_OPS_WEB_ALLOWED_HOSTS: "nas.local" } });
  // Then next binds every interface and the user is told, with the reason
  assert.deepEqual(run.argv, ["start", "-H", "0.0.0.0"]);
  assert.ok(run.stderr.includes("binding 0.0.0.0"), `stderr was: ${run.stderr}`);
  assert.ok(run.stderr.includes("reachable from your network"), "widening must be announced");
  assert.ok(run.stderr.includes("nas.local"), "the notice should name what widened it");
});

test("an opt-in naming one address binds that address alone", () => {
  // Given a single LAN address. Binding 0.0.0.0 here would also publish the
  // dashboard on a VPN tunnel or a phone hotspot nobody opted in to.
  const run = launch({ args: ["dev"], env: { CAREER_OPS_WEB_ALLOWED_HOSTS: "192.168.1.50" } });
  // When the launcher starts next
  // Then only that interface is published, and the cost is stated: one socket
  // carries one address, so localhost stops answering
  assert.deepEqual(run.argv, ["dev", "-H", "192.168.1.50"]);
  assert.ok(run.stderr.includes("binding 192.168.1.50"), `stderr was: ${run.stderr}`);
  assert.ok(!run.stderr.includes("binding 0.0.0.0"), "every interface must not be published");
  assert.ok(run.stderr.includes("http://localhost:PORT will not answer"), "the cost must be stated");
});

test("naming a loopback host alongside an address opts back into every interface", () => {
  // Given the documented escape hatch for keeping localhost working
  const run = launch({
    args: ["dev"],
    env: { CAREER_OPS_WEB_ALLOWED_HOSTS: "192.168.1.50, localhost" },
  });
  // When the launcher starts next
  // Then the wider bind is taken deliberately, and not reported as costing loopback
  assert.deepEqual(run.argv, ["dev", "-H", "0.0.0.0"]);
  assert.ok(!run.stderr.includes("will not answer"), "0.0.0.0 still answers on loopback");
});

test("a value that reads as a switch refuses the run instead of widening", () => {
  // Given someone turning exposure off the way the variable's name suggests.
  // Every such word is a valid hostname, so this used to bind every interface.
  const run = launch({ args: ["dev"], env: { CAREER_OPS_WEB_ALLOWED_HOSTS: "off" } });
  // When the launcher runs
  // Then next never starts, and the message explains what the variable is
  assert.equal(run.status, 1);
  assert.equal(run.argv, null, "next must not run on an unreadable opt-in");
  assert.ok(run.stderr.includes("is not a switch"), `stderr was: ${run.stderr}`);
});

// --- a caller's own -H ----------------------------------------------------

test("a caller's -H is forwarded alone, with no injected bind to resolve against", () => {
  // Given the override that used to widen the socket in silence. The launcher
  // used to append it after its own -H and rely on commander keeping the last
  // value — a bet against a dependency, asserted only against this stub.
  const run = launch({ args: ["dev", "-H", "0.0.0.0"] });
  // When the launcher starts next
  // Then argv carries exactly what the caller wrote: no duplicate flag exists,
  // so no assumption about how commander resolves one is load-bearing
  assert.deepEqual(run.argv, ["dev", "-H", "0.0.0.0"]);
  // And the run is reported as possibly exposed rather than claimed as loopback
  assert.ok(run.stderr.includes("next chooses the bind"), `stderr was: ${run.stderr}`);
  assert.ok(run.stderr.includes("may be reachable from your network"), "an -H must warn");
  assert.ok(!run.stderr.includes("loopback only"), "it must not claim loopback");
  // And the combination with no honest reading is called out specifically
  assert.ok(
    run.stderr.includes("names no host beyond loopback"),
    "an open socket whose filter names nobody must be flagged",
  );
});

test("the attached short form -H0.0.0.0 is not reported as loopback", () => {
  // Given commander's attached spelling, which next honours. This exact argv
  // once printed "binding 127.0.0.1 — loopback only" while opening every
  // interface, and a LAN client spoofing Host: localhost was served. Presence
  // detection, unlike value parsing, cannot miss a spelling of the value.
  for (const args of [["dev", "-H0.0.0.0"], ["dev", "-p", "4000", "-H0.0.0.0"], ["dev", "--hostname=0.0.0.0"]]) {
    // When the launcher starts next
    const run = launch({ args });
    // Then the flag reaches next untouched, and no loopback claim is made
    assert.deepEqual(run.argv, args, `${args.join(" ")} must be forwarded untouched`);
    assert.ok(!run.stderr.includes("loopback only"), `${args.join(" ")} must not claim loopback`);
    assert.ok(run.stderr.includes("next chooses the bind"), `stderr was: ${run.stderr}`);
  }
});

test("a loopback-only allow-list with an override is flagged, not silently passed", () => {
  // Given a non-empty allow-list that names nobody the guard could not already
  // serve — the state a length check mistook for a meaningful opt-in
  const run = launch({
    args: ["dev", "-H", "0.0.0.0"],
    env: { CAREER_OPS_WEB_ALLOWED_HOSTS: "localhost" },
  });
  // When the launcher starts next
  // Then the user is told the filter would protect nobody on an open port
  assert.ok(
    run.stderr.includes("names no host beyond loopback"),
    `a loopback-only list must not silence the notice; stderr was: ${run.stderr}`,
  );
});

test("an -H alongside an opt-in still hands the bind to next", () => {
  // Given an opt-in that would have widened, plus a caller pulling it back down
  const run = launch({
    args: ["dev", "-H", "127.0.0.1"],
    env: { CAREER_OPS_WEB_ALLOWED_HOSTS: "nas.local" },
  });
  // When the launcher starts next
  // Then the resolved 0.0.0.0 is neither injected nor announced: the caller's
  // flag is the only bind in argv, and the launcher does not claim to know it
  assert.deepEqual(run.argv, ["dev", "-H", "127.0.0.1"]);
  assert.ok(!run.stderr.includes("binding 0.0.0.0"), "the unused resolved bind must not be announced");
});

// --- forwarding and failure modes -----------------------------------------

test("unrelated flags are forwarded untouched", () => {
  // Given a caller passing next's own options through npm's `--`
  // When the launcher starts next
  const run = launch({ args: ["dev", "-p", "4000", "--turbopack"] });
  // Then they arrive in order, after the bind
  assert.deepEqual(run.argv, ["dev", "-H", "127.0.0.1", "-p", "4000", "--turbopack"]);
});

test("a missing next install is reported as a missing install", () => {
  // Given a checkout where npm ci has not been run
  // When the launcher tries to start
  const run = launch({ args: ["dev"], install: false });
  // Then the message names the fix, rather than reporting a generic resolve error
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes("run `npm ci` in web/"), `stderr was: ${run.stderr}`);
  // And the bind was still announced first, so a broken install does not hide
  // the fact that this run would have been network-reachable
  assert.ok(run.stderr.includes("loopback only"), "the bind is reported before next is resolved");
});

test("the child's exit code is forwarded", () => {
  // Given a next that fails with a distinctive status
  // When the launcher wraps it
  const run = launch({ args: ["dev"], body: "process.exit(3);\n" });
  // Then the caller sees next's status, not a flattened 1
  assert.equal(run.status, 3);
});

test("a terminated child returns a non-zero platform-native status", () => {
  // Given a next killed by a signal rather than exiting
  // When the launcher wraps it
  const run = launch({ args: ["dev"], body: "process.kill(process.pid, 'SIGTERM');\n" });
  // Windows has no POSIX signal delivery: Node emulates SIGTERM as forced
  // termination, so only a non-zero native status is portable there. Unix
  // reports a real signal, which the launcher converts to 128+signal.
  if (process.platform === "win32") {
    assert.equal(run.signal, null, "the launcher exits normally after Windows terminates its child");
    assert.notEqual(run.status, 0, "a terminated child must not look successful");
    return;
  }
  assert.equal(run.status, 128 + os.constants.signals.SIGTERM);
  assert.notEqual(run.status, 1, "a killed server must not look like a failed launch");
});

test("an unknown command prints usage and exits 1 without starting next", () => {
  // Given argv naming no next subcommand
  // When the launcher runs
  const run = launch({ args: ["--probe-not-a-command"] });
  // Then nothing is spawned and the caller is told how to invoke it
  assert.equal(run.status, 1);
  assert.equal(run.argv, null, "next must not run for an unknown command");
  assert.ok(run.stderr.includes("Usage: node server.mjs"), "usage should be printed");
});

// --- the scripts that reach it --------------------------------------------

const pkg = JSON.parse(readFileSync(join(WEB_ROOT, "package.json"), "utf8"));
const scripts = pkg.scripts ?? {};

/** A script handing `next dev`/`next start` its own argv, bypassing the launcher. */
const CALLS_NEXT_DIRECTLY = /(^|&&|\|\||\s)next\s+(dev|start)\b/;

test("the dev and start scripts route through the launcher", () => {
  // Given the two scripts a developer actually runs
  // When each is read
  // Then both reach next only via server.mjs — `startsWith`, so that adding a
  // flag to the script is not mistaken for bypassing it
  assert.ok(scripts.dev?.startsWith("node server.mjs dev"), `dev script was: ${scripts.dev}`);
  assert.ok(scripts.start?.startsWith("node server.mjs start"), `start script was: ${scripts.start}`);
});

test("no script starts next on its own", () => {
  // Given every script in the package, not just the two above
  // When each is scanned for a direct next invocation
  const offenders = Object.entries(scripts)
    .filter(([, command]) => CALLS_NEXT_DIRECTLY.test(command))
    .map(([name]) => name);
  // Then none bypasses the bind decision — this catches a re-added `"dev": "next dev"`
  // and equally a new `"dev:lan": "next dev -H 0.0.0.0"` nobody thought to review
  assert.deepEqual(offenders, []);
});

test("the bypass check actually fires", () => {
  // Given the shapes it exists to catch, and one it must not
  // When each is tested
  // Then the guard discriminates — an unfalsifiable guard is a hypothesis
  assert.equal(CALLS_NEXT_DIRECTLY.test("next dev"), true);
  assert.equal(CALLS_NEXT_DIRECTLY.test("rm -rf .next && next start -H 0.0.0.0"), true);
  assert.equal(CALLS_NEXT_DIRECTLY.test("node server.mjs dev"), false);
});
