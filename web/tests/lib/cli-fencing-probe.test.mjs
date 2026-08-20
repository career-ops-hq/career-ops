// Tests for the CLI fencing capability probe (#2361, #2507).
//
// The probe is a gate: it decides whether the binary on THIS machine supports
// the flags cli-fencing.mjs would restrict it with. Every case here therefore
// asks the same thing from a different angle — does an answer other than a
// verified "yes" come back as "unsupported"? A probe that guessed "supported"
// would hand a user an unsandboxed agent while the UI reported a fenced one.
//
// Run:  node --test tests/lib/cli-fencing-probe.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexFencingSupported } from "../../src/lib/cli-fencing-probe.mjs";
import { CODEX_REQUIRED_EXEC_FLAGS, CODEX_REQUIRED_GLOBAL_FLAGS } from "../../src/lib/cli-fencing.mjs";

const ROUTE_EXEC_FLAGS = ["--ephemeral", "--output-last-message"];

/**
 * Write an executable stand-in for `codex` whose --help output we control, and
 * which records every invocation so a test can count actual process spawns.
 *
 * A real codex is not installed on CI, and pinning these guards to whatever
 * version a developer happens to have would make them pass or fail for reasons
 * unrelated to the code under test.
 */
function stubCodex(t, { globalFlags, execFlags }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fencing-probe-"));
  const bin = path.join(dir, "codex-stub.mjs");
  const callLog = path.join(dir, "calls.log");
  const help = JSON.stringify({ globalFlags, execFlags });
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
import fs from "node:fs";
const help = ${help};
const isExec = process.argv[2] === "exec";
fs.appendFileSync(${JSON.stringify(callLog)}, (isExec ? "exec" : "global") + "\\n");
process.stdout.write((isExec ? help.execFlags : help.globalFlags).join("\\n") + "\\n");
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

const fullySupported = (t) =>
  stubCodex(t, {
    globalFlags: [...CODEX_REQUIRED_GLOBAL_FLAGS],
    execFlags: [...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS],
  });

test("the flag lists these guards read still look like themselves", async () => {
  // Given a suite that derives its fixtures from the exported requirement lists
  // When either is empty, "every required flag is present" holds vacuously
  // Then refuse that before any case below can pass by measuring nothing.
  assert.ok(CODEX_REQUIRED_GLOBAL_FLAGS.length > 0, "global requirements must not be empty");
  assert.ok(CODEX_REQUIRED_EXEC_FLAGS.length > 0, "exec requirements must not be empty");
  assert.ok(CODEX_REQUIRED_GLOBAL_FLAGS.includes("--search"), "web access must still be a requirement");
});

test("a binary documenting every required flag is supported", async (t) => {
  // Given a codex whose help lists everything fencing emits and everything the
  // AI-search route adds
  const { bin } = fullySupported(t);

  // When the probe runs
  const supported = await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });

  // Then the run is allowed to proceed. Without this case the suite could pass
  // with a probe hardwired to false, which fails closed but bans Codex entirely.
  assert.equal(supported, true);
});

test("a binary missing any single required flag is refused", async (t) => {
  // Given every requirement in turn removed from an otherwise complete help —
  // flags move between releases, and one absence is all it takes for the fencing
  // flags to be accepted and ignored
  for (const missing of [...CODEX_REQUIRED_GLOBAL_FLAGS, ...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS]) {
    const { bin } = stubCodex(t, {
      globalFlags: CODEX_REQUIRED_GLOBAL_FLAGS.filter((f) => f !== missing),
      execFlags: [...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS].filter((f) => f !== missing),
    });

    // When the probe runs
    const supported = await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });

    // Then it fails closed rather than running a weaker invocation.
    assert.equal(supported, false, `dropping ${missing} must make the binary unsupported`);
  }
});

test("a flag whose name merely CONTAINS a requirement does not satisfy it", async (t) => {
  // Given a codex that renamed --sandbox to --sandbox-mode: a substring check
  // reads the rename as support and hands the user an unsandboxed agent
  const { bin } = stubCodex(t, {
    globalFlags: [...CODEX_REQUIRED_GLOBAL_FLAGS],
    execFlags: [
      ...CODEX_REQUIRED_EXEC_FLAGS.filter((f) => f !== "--sandbox"),
      "--sandbox-mode <SANDBOX_MODE>",
      ...ROUTE_EXEC_FLAGS,
    ],
  });

  // When the probe runs
  const supported = await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });

  // Then the requirement is unmet: matching is on the declared token, not on
  // any text that happens to contain it.
  assert.equal(supported, false);
});

test("a required value is recognised inside codex's possible-values list", async (t) => {
  // Given the sandbox MODES are documented only as `-s`'s accepted values, in
  // the bracketed comma-separated form codex actually prints
  const { bin } = stubCodex(t, {
    globalFlags: [...CODEX_REQUIRED_GLOBAL_FLAGS],
    execFlags: [
      "-c, --config <key=value>",
      "-s, --sandbox <SANDBOX_MODE>  [possible values: read-only, workspace-write, danger-full-access]",
      ...ROUTE_EXEC_FLAGS,
    ],
  });

  // When the probe runs
  const supported = await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });

  // Then brackets and commas count as boundaries — tightening the matcher must
  // not start rejecting the real help text, which would disable AI search.
  assert.equal(supported, true);
});

test("a flag the caller requires is checked even though fencing never emits it", async (t) => {
  // Given the route's own isolation and output flags, which fencing cannot know
  // about but which break the run just as thoroughly when absent
  const { bin } = stubCodex(t, {
    globalFlags: [...CODEX_REQUIRED_GLOBAL_FLAGS],
    execFlags: [...CODEX_REQUIRED_EXEC_FLAGS],
  });

  // When the same binary is probed with and without those extra requirements
  const withExtras = await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });
  const withoutExtras = await codexFencingSupported(bin);

  // Then the caller's list genuinely discriminates — it is not decoration, and
  // the second answer is computed rather than inherited from the first.
  assert.equal(withExtras, false, "a missing caller flag must fail the gate");
  assert.equal(withoutExtras, true, "the same binary satisfies fencing's own requirements");
});

test("a binary that cannot be inspected is refused", async () => {
  // Given a path that does not exist, which is what a broken install or a
  // resolveCli race looks like
  const supported = await codexFencingSupported(path.join(os.tmpdir(), "definitely-not-a-codex-binary"));

  // Then it is unsupported. Statting failure is a reason to refuse, never a
  // reason to assume the flags are there.
  assert.equal(supported, false);
});

test("a binary that exists but cannot be executed is refused", async (t) => {
  // Given a file that stats successfully and then fails at spawn (EACCES) —
  // a half-finished install, and a different code path from the missing one
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

test("help output is read once per binary, whatever the caller asks of it", async (t) => {
  // Given two process spawns per read, and a Scan tab that calls this on every
  // AI search
  const { bin, spawnCount } = fullySupported(t);

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

test("a binary that says nothing is retried rather than remembered", async (t) => {
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
