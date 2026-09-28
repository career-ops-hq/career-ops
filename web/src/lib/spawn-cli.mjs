import { spawn } from "node:child_process";
import { fenceArgs } from "./cli-fencing.mjs";
import { resolveNpmShim } from "./resolve-npm-shim.mjs";

// Plain .mjs (same pattern as tracker-table.mjs/clean-chips.mjs) so
// tests/lib/spawn-cli.test.mjs can import it directly under Node. Import it with the
// .mjs extension included (e.g. "@/lib/spawn-cli.mjs") — unlike .ts files,
// which TypeScript resolves without an extension, ESM specifiers for plain
// JS modules must be fully specified.

/**
 * Spawn a headless agent CLI with stdin closed, under the worker's permissions.
 *
 * CLIs such as `codex exec` read additional prompt text from stdin when a pipe
 * is left open. A web request never supplies that extra input, so leaving the
 * default pipe open makes Codex wait forever without producing stdout. This is
 * the ONLY spawn path for CLI-invoking routes — every call site should use it
 * instead of `node:child_process`'s `spawn` directly, so the fix can't drift.
 *
 * It also replaces the `stdio: ["ignore", ...]` the apply planners used to spell
 * for the same reason — one mechanism means one place for this to be right.
 * The options type omits `stdio` on purpose: stdout/stderr must stay pipes for
 * every caller's stream handlers, and TypeScript keeps `child.stdout` non-null
 * only under that contract. `stdin` is still optional-chained so an untyped
 * caller passing `stdio` anyway degrades safely (null stdin) instead of throwing.
 *
 * `fencing` is REQUIRED, and that is the point (#2507). Permission used to be
 * applied per route, so it reached only the one route that remembered — every
 * other CLI ran unrestricted. Demanding it here means a new route cannot spawn an
 * unfenced agent by omission: it does not compile. Declare what the worker needs
 * (worker-capabilities.mjs) and this translates it for whichever runtime the user
 * picked (cli-fencing.mjs); a runtime with no verified mechanism is passed
 * through untouched, and fencingReport() grades the run so the UI can say so
 * rather than pretending.
 *
 * The one thing that legitimately spawns a CLI without coming through here is
 * cli-fencing-probe.mjs, which runs `--help` to ask whether the binary supports
 * the flags it would be fenced with. That executes no prompt, no model and no
 * tools, so there is nothing to fence — and it cannot import this module anyway
 * without making the two a cycle.
 *
 * @param {string} binPath
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptionsWithoutStdio} options
 * @param {{cliId: string, capabilities: import("./worker-capabilities.mjs").Capabilities}} fencing
 */
export function spawnHeadlessCli(binPath, args, options, fencing) {
  // Fail fast rather than spawn unfenced. Omitting `fencing` used to spread
  // `undefined` into nothing, leaving cliId undefined — which matches no fencer,
  // so the raw argv was spawned with no error at all. The docstring's "it does
  // not compile" holds only for the .ts call sites: `checkJs` is off, so a .mjs
  // caller gets no signal from tsc. A silently unrestricted agent is precisely
  // the outcome this parameter exists to prevent, so refuse to start.
  if (!fencing?.cliId || !fencing?.capabilities) {
    throw new Error(
      `spawnHeadlessCli: refusing to spawn ${binPath} without {cliId, capabilities}. ` +
        "Declare what the worker needs (worker-capabilities.mjs) so its permissions can be applied.",
    );
  }
  const { args: fencedArgs } = fenceArgs({ ...fencing, args });
  // An npm-installed CLI on Windows resolves to a shim that spawn() cannot run
  // without a shell (#2375). Swap it for the real entrypoint here, at the one
  // spawn boundary, so no caller has to know shims exist — and `shell` stays off,
  // which keeps the fenced argv an argv and never a command line.
  const { file, prefixArgs } = resolveNpmShim(binPath);
  // windowsHide: on Windows a child normally attaches to the parent's console.
  // A long-lived dev server whose console has gone stale then kills EVERY child
  // at DLL init with 0xC0000142 (STATUS_DLL_INIT_FAILED) — measured: node.exe,
  // cmd.exe and where.exe all failed identically, while the same spawns with
  // windowsHide (CREATE_NO_WINDOW) or detached succeeded. Nothing here needs a
  // console, so never inherit one. No-op on POSIX (#3809).
  const child = spawn(file, [...prefixArgs, ...fencedArgs], { ...options, windowsHide: true });
  child.stdin?.end();
  return child;
}
