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
 * Write an executable stand-in for `codex` whose --help output we control.
 *
 * A real codex is not installed on CI, and pinning these guards to whatever
 * version a developer happens to have would make them pass or fail for reasons
 * unrelated to the code under test.
 */
function stubCodex(t, { globalFlags, execFlags }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fencing-probe-"));
  const bin = path.join(dir, "codex-stub.mjs");
  const help = JSON.stringify({ globalFlags, execFlags });
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const help = ${help};
const isExec = process.argv[2] === "exec";
process.stdout.write((isExec ? help.execFlags : help.globalFlags).join("\\n") + "\\n");
`,
  );
  fs.chmodSync(bin, 0o755);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return bin;
}

const fullySupported = (t) =>
  stubCodex(t, {
    globalFlags: [...CODEX_REQUIRED_GLOBAL_FLAGS],
    execFlags: [...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS],
  });

test("the flag lists these guards read still look like themselves", async (t) => {
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
  const bin = fullySupported(t);

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
    const bin = stubCodex(t, {
      globalFlags: CODEX_REQUIRED_GLOBAL_FLAGS.filter((f) => f !== missing),
      execFlags: [...CODEX_REQUIRED_EXEC_FLAGS, ...ROUTE_EXEC_FLAGS].filter((f) => f !== missing),
    });

    // When the probe runs
    const supported = await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });

    // Then it fails closed rather than running a weaker invocation.
    assert.equal(supported, false, `dropping ${missing} must make the binary unsupported`);
  }
});

test("a flag the caller requires is checked even though fencing never emits it", async (t) => {
  // Given the route's own isolation and output flags, which fencing cannot know
  // about but which break the run just as thoroughly when absent
  const bin = stubCodex(t, {
    globalFlags: [...CODEX_REQUIRED_GLOBAL_FLAGS],
    execFlags: [...CODEX_REQUIRED_EXEC_FLAGS],
  });

  // When the same binary is probed with and without those extra requirements
  const withExtras = await codexFencingSupported(bin, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });
  const withoutExtras = await codexFencingSupported(bin);

  // Then the caller's list genuinely discriminates — it is not decoration.
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

test("a successful probe is cached, a failed one is retried", async (t) => {
  // Given help output costs two process spawns per request, and AI search is
  // called repeatedly from the Scan tab
  const good = fullySupported(t);
  const bad = stubCodex(t, { globalFlags: [], execFlags: [] });

  // When the same binary is probed twice
  const first = codexFencingSupported(good, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });
  const second = codexFencingSupported(good, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });
  await Promise.all([first, second]);
  const third = codexFencingSupported(good, { alsoRequiresInExec: ROUTE_EXEC_FLAGS });

  // Then concurrent and later callers share one in-flight probe...
  assert.equal(first, second, "concurrent probes must share one in-flight result");
  assert.equal(await third, true);

  // ...while a negative result is dropped once it settles, so a user who
  // upgrades Codex mid-session is not stuck with "unsupported" until the server
  // restarts. (Concurrent callers still share the in-flight failure; it is only
  // the SETTLED negative that is not kept.)
  const failed = codexFencingSupported(bad);
  assert.equal(await failed, false);
  const retried = codexFencingSupported(bad);
  assert.notEqual(retried, failed, "a settled failure must be re-probed, not served from cache");
  assert.equal(await retried, false);
});
