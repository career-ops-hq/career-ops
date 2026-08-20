// Tests for the CLI fencing capability probe (#2361, #2507).
//
// The probe is a gate: it decides whether the binary on THIS machine supports
// the flags cli-fencing.mjs would restrict it with. Every case here therefore
// asks the same thing from a different angle — does an answer other than a
// verified "yes" come back as "unsupported"? A probe that guessed "supported"
// would hand a user an unsandboxed agent while the UI reported a fenced one.
//
// The flag-semantics cases read helpSatisfiesFencing directly, over help text
// written inline. That is not merely convenient: producing help from a fixture
// needs an executable, and a shebang script is executable on POSIX and inert on
// Windows, so fusing the two would leave the matching rules — the half a review
// has already found bugs in — untested on the platform whose CI runs them.
//
// Run:  node --test tests/lib/cli-fencing-probe.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexFencingSupported, helpSatisfiesFencing } from "../../src/lib/cli-fencing-probe.mjs";
import { CODEX_REQUIRED_EXEC_FLAGS, CODEX_REQUIRED_GLOBAL_FLAGS } from "../../src/lib/cli-fencing.mjs";

const ROUTE_EXEC_FLAGS = ["--ephemeral", "--output-last-message"];

/** Render tokens in the two structured forms Codex's clap help uses. */
const structuredHelp = (tokens) => {
  const values = tokens.filter((token) => !token.startsWith("-"));
  return tokens
    .filter((token) => token.startsWith("-"))
    .flatMap((token) => [
      `  ${token} <VALUE>`,
      ...(token === "--sandbox" && values.length ? [`      [possible values: ${values.join(", ")}]`] : []),
    ])
    .join("\n");
};

/** Help text that declares every token as codex's own does. */
const completeHelp = (overrides = {}) => ({
  globalHelp: structuredHelp(CODEX_REQUIRED_GLOBAL_FLAGS),
  execHelp: structuredHelp([...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS]),
  ...overrides,
});

/**
 * Write an executable stand-in for `codex`, and record every invocation so a
 * test can count actual process spawns.
 *
 * Only the caching cases need this. A real codex is not installed on CI, and
 * pinning these guards to whatever version a developer happens to have would
 * make them pass or fail for reasons unrelated to the code under test.
 */
function stubCodex(t, { globalFlags, execFlags }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fencing-probe-"));
  const bin = path.join(dir, "codex-stub.mjs");
  const callLog = path.join(dir, "calls.log");
  const help = JSON.stringify({
    globalHelp: structuredHelp(globalFlags),
    execHelp: structuredHelp(execFlags),
  });
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
import fs from "node:fs";
const help = ${help};
const isExec = process.argv[2] === "exec";
fs.appendFileSync(${JSON.stringify(callLog)}, (isExec ? "exec" : "global") + "\\n");
process.stdout.write((isExec ? help.execHelp : help.globalHelp) + "\\n");
`,
  );
  fs.chmodSync(bin, 0o755);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const spawnCount = () => {
    try {
      return fs.readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };
  return { bin, spawnCount };
}

// Windows has no shebang support, so a script stub cannot be spawned as a
// binary there. Only the two spawn-counting cases below depend on one; every
// rule they would otherwise cover is asserted against helpSatisfiesFencing,
// which runs everywhere.
const needsSpawnableStub = {
  skip: process.platform === "win32" ? "Windows cannot spawn a shebang script as a binary" : false,
};

test("the flag lists these guards read still look like themselves", () => {
  // Given a suite that derives its fixtures from the exported requirement lists
  // When either is empty, "every required flag is present" holds vacuously
  // Then refuse that before any case below can pass by measuring nothing.
  assert.ok(CODEX_REQUIRED_GLOBAL_FLAGS.length > 0, "global requirements must not be empty");
  assert.ok(CODEX_REQUIRED_EXEC_FLAGS.length > 0, "exec requirements must not be empty");
  assert.ok(CODEX_REQUIRED_GLOBAL_FLAGS.includes("--search"), "web access must still be a requirement");
});

test("help declaring every required flag satisfies the contract", () => {
  // Given help that names everything fencing emits and everything the AI-search
  // route adds
  // When it is evaluated
  // Then the run is allowed to proceed. Without this case the suite could pass
  // with a check hardwired to false, which fails closed but bans Codex entirely.
  assert.equal(helpSatisfiesFencing(completeHelp(), ROUTE_EXEC_FLAGS), true);
});

test("help missing any single required flag does not", () => {
  // Given every requirement in turn removed from an otherwise complete help —
  // flags move between releases, and one absence is all it takes for the fencing
  // flags to be accepted and ignored
  for (const missing of [...CODEX_REQUIRED_GLOBAL_FLAGS, ...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS]) {
    const help = {
      globalHelp: structuredHelp(CODEX_REQUIRED_GLOBAL_FLAGS.filter((f) => f !== missing)),
      execHelp: structuredHelp(
        [...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS].filter((f) => f !== missing),
      ),
    };

    // When it is evaluated
    // Then it fails closed rather than running a weaker invocation.
    assert.equal(
      helpSatisfiesFencing(help, ROUTE_EXEC_FLAGS),
      false,
      `dropping ${missing} must make the binary unsupported`,
    );
  }
});

test("a flag whose name merely CONTAINS a requirement does not satisfy it", () => {
  // Given a codex that renamed --sandbox to --sandbox-mode: a substring check
  // reads the rename as support and hands the user an unsandboxed agent
  const help = completeHelp({
    execHelp: [
      ...CODEX_REQUIRED_EXEC_FLAGS.filter((f) => f !== "--sandbox"),
      "--sandbox-mode <SANDBOX_MODE>",
      ...ROUTE_EXEC_FLAGS,
    ].join("\n"),
  });

  // When it is evaluated
  // Then the requirement is unmet: matching is on the declared token, not on
  // any text that happens to contain it.
  assert.equal(helpSatisfiesFencing(help, ROUTE_EXEC_FLAGS), false);
});

test("a required value is recognised inside codex's possible-values list", () => {
  // Given the sandbox MODES are documented only as `-s`'s accepted values, in
  // the bracketed comma-separated form codex actually prints
  const help = completeHelp({
    execHelp: [
      "-c, --config <key=value>",
      "-s, --sandbox <SANDBOX_MODE>  [possible values: read-only, workspace-write, danger-full-access]",
      ...ROUTE_EXEC_FLAGS,
    ].join("\n"),
  });

  // When it is evaluated
  // Then brackets and commas count as boundaries — tightening the matcher must
  // not start rejecting the real help text, which would disable AI search.
  assert.equal(helpSatisfiesFencing(help, ROUTE_EXEC_FLAGS), true);
});

test("required tokens mentioned only in prose do not satisfy the contract", () => {
  const globalHelp = CODEX_REQUIRED_GLOBAL_FLAGS.map((flag) => `The ${flag} option was removed.`).join("\n");
  const execHelp = [...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS]
    .map((flag) => `This build does not support ${flag}.`)
    .join("\n");

  assert.equal(helpSatisfiesFencing({ globalHelp, execHelp }, ROUTE_EXEC_FLAGS), false);
});

test("sandbox evidence must belong to a structured sandbox declaration", () => {
  const execRequirements = [...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS];

  for (const sandboxEvidence of [
    "--sandbox was removed in this build\n[possible values: read-only, workspace-write]",
    "The old sandbox accepted [possible values: read-only, workspace-write]",
    "--color <COLOR>\n[possible values: read-only, workspace-write]",
  ]) {
    const otherOptions = execRequirements
      .filter((token) => token.startsWith("-") && token !== "--sandbox")
      .map((token) => `${token} <VALUE>`);
    const help = completeHelp({ execHelp: [...otherOptions, sandboxEvidence].join("\n") });

    assert.equal(
      helpSatisfiesFencing(help, ROUTE_EXEC_FLAGS),
      false,
      `${JSON.stringify(sandboxEvidence)} must not prove sandbox support`,
    );
  }
});

test("a flag the caller requires is checked even though fencing never emits it", () => {
  // Given the route's own isolation and output flags, which fencing cannot know
  // about but which break the run just as thoroughly when absent
  const help = completeHelp({ execHelp: structuredHelp(CODEX_REQUIRED_EXEC_FLAGS) });

  // When the same help is evaluated with and without those extra requirements
  // Then the caller's list genuinely discriminates — it is not decoration.
  assert.equal(helpSatisfiesFencing(help, ROUTE_EXEC_FLAGS), false, "a missing caller flag must fail the gate");
  assert.equal(helpSatisfiesFencing(help), true, "the same help satisfies fencing's own requirements");
});

test("a binary that cannot be inspected is refused", async () => {
  // Given a path that does not exist, which is what a broken install or a
  // resolveCli race looks like
  const supported = await codexFencingSupported(path.join(os.tmpdir(), "definitely-not-a-codex-binary"));

  // Then it is unsupported. Statting failure is a reason to refuse, never a
  // reason to assume the flags are there.
  assert.equal(supported, false);
});

test("a binary that exists but cannot be run is refused", async (t) => {
  // Given a file that stats successfully and then fails at spawn — no execute
  // permission on POSIX, an unrunnable script on Windows; either way a
  // half-finished install, and a different code path from the missing one
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fencing-probe-noexec-"));
  const bin = path.join(dir, "codex-stub.mjs");
  fs.writeFileSync(bin, "#!/usr/bin/env node\n");
  fs.chmodSync(bin, 0o644);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // When the probe runs
  const supported = await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });

  // Then the spawn-error path fails closed too — the one branch of readCliHelp
  // that no other case here reaches.
  assert.equal(supported, false);
});

test("help output is read once per binary, whatever the caller asks of it", needsSpawnableStub, async (t) => {
  // Given two process spawns per read, and a Scan tab that calls this on every
  // AI search
  const { bin, spawnCount } = stubCodex(t, {
    globalFlags: [...CODEX_REQUIRED_GLOBAL_FLAGS],
    execFlags: [...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS],
  });

  // When the same binary is probed repeatedly, concurrently, and with different
  // requirement lists
  await Promise.all([
    codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS }),
    codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS }),
  ]);
  assert.equal(await codexFencingSupported(bin), true);
  assert.equal(await codexFencingSupported(bin, { alsoRequiresInExec: ["--not-a-real-flag"] }), false);

  // Then the help was read exactly once — the cache holds the evidence, so a
  // second caller's different requirements are computed from it rather than
  // being answered with the first caller's verdict.
  assert.equal(spawnCount(), 2, "one --help and one `exec --help`, shared by every caller");
});

test("a replaced binary is re-read even if size and mtime are restored", needsSpawnableStub, async (t) => {
  // Given an executable swapped in place — a reinstall, a build writing the same
  // length, a restore putting the timestamp back. Size and mtime can survive
  // that; the file is still a different one.
  const { bin, spawnCount } = stubCodex(t, {
    globalFlags: [...CODEX_REQUIRED_GLOBAL_FLAGS],
    execFlags: [...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS],
  });
  // Pinned to a whole millisecond, because utimesSync cannot restore the
  // sub-millisecond part of a natural mtime — without this the cache would
  // evict on the fractional difference and the case would pass without ever
  // exercising the identity fields it exists for.
  const pinned = new Date(1_700_000_000_000);
  fs.utimesSync(bin, pinned, pinned);
  assert.equal(await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS }), true);
  const afterFirst = spawnCount();

  const before = fs.statSync(bin);
  const replacement = `${bin}.new`;
  fs.writeFileSync(replacement, fs.readFileSync(bin));
  fs.chmodSync(replacement, 0o755);
  fs.renameSync(replacement, bin);
  fs.utimesSync(bin, pinned, pinned);
  assert.equal(fs.statSync(bin).size, before.size, "the fixture must keep its size to be worth asserting");
  assert.equal(fs.statSync(bin).mtimeMs, before.mtimeMs, "and its mtime, or the cache would evict for that reason");

  // When it is probed again
  await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });

  // Then the help was re-read: identity is the whole stat, so a stale answer
  // cannot outlive the binary it described.
  assert.ok(spawnCount() > afterFirst, `expected a re-read, spawns stayed at ${afterFirst}`);
});

// A bound, not a preference: the failure this case guards against is a promise
// that never settles, and asserting on a value cannot catch that — the runner
// would simply wait forever, in CI as much as here. An explicit timeout turns
// the hang into a reported failure. Generous against the probe's own 6s
// deadline (5s help timeout + 1s grace) so slow CI cannot make it flap.
const settlesOrFails = { ...needsSpawnableStub, timeout: 20_000 };

test("a probe settles even when a descendant holds the pipe open", settlesOrFails, async (t) => {
  // Given a binary that spawns a detached child inheriting its stdout and then
  // exits. The direct child is gone, but the WRITE end of the pipe is not, so
  // the "close" event — which waits for the stdio streams, not just the exit —
  // never fires. SIGKILL goes to the direct child, never to a process group, so
  // nothing this module can signal will release that handle.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fencing-probe-holder-"));
  const bin = path.join(dir, "codex-holder.mjs");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
import { spawn } from "node:child_process";
// Inherits stdout, outlives the parent, and says nothing.
spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "ignore"],
}).unref();
`,
  );
  fs.chmodSync(bin, 0o755);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // When the probe runs it
  const supported = await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });

  // Then it still settles, fail-closed. Awaiting the pipe instead would leave
  // this promise pending forever — and it sits on the AI-search request path,
  // so "forever" is a hung request, not a slow one.
  assert.equal(supported, false);
});

test("a binary that says nothing is retried rather than remembered", needsSpawnableStub, async (t) => {
  // Given a probe that produced no help at all: a spawn error, a timeout, a
  // binary killed mid-write. That is a transient condition, not a verdict about
  // the flags — caching it would strand a working Codex until the server
  // restarts.
  const { bin, spawnCount } = stubCodex(t, { globalFlags: [], execFlags: [] });

  // When it is probed twice
  assert.equal(await codexFencingSupported(bin), false);
  const afterFirst = spawnCount();
  assert.equal(await codexFencingSupported(bin), false);

  // Then it fails closed both times, and the second call actually re-read the
  // binary instead of being served from the cache.
  assert.ok(spawnCount() > afterFirst, `expected a re-read, spawns stayed at ${afterFirst}`);
});
