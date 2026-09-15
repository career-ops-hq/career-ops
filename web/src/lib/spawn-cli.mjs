import { spawn } from "node:child_process";
import { resolveNpmShim } from "./resolve-npm-shim.mjs";

// Plain .mjs (same pattern as tracker-table.mjs/clean-chips.mjs) so
// tests/lib/spawn-cli.test.mjs can import it directly under Node. Import it with the
// .mjs extension included (e.g. "@/lib/spawn-cli.mjs") — unlike .ts files,
// which TypeScript resolves without an extension, ESM specifiers for plain
// JS modules must be fully specified.

/**
 * Spawn a headless agent CLI with stdin closed.
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
 * @param {string} binPath
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptionsWithoutStdio} options
 */
export function spawnHeadlessCli(binPath, args, options) {
  // An npm-installed CLI on Windows resolves to a shim that spawn() cannot run
  // without a shell (#2375). Swap it for the real entrypoint here, at the one
  // spawn boundary, so no route has to know shims exist — and `shell` stays off.
  const { file, prefixArgs } = resolveNpmShim(binPath);
  // windowsHide: on Windows a child normally attaches to the parent's console.
  // A long-lived dev server whose console has gone stale then kills EVERY child
  // at DLL init with 0xC0000142 (STATUS_DLL_INIT_FAILED) — measured: node.exe,
  // cmd.exe and where.exe all failed identically, while the same spawns with
  // windowsHide (CREATE_NO_WINDOW) or detached succeeded. Nothing here needs a
  // console, so never inherit one. No-op on POSIX.
  const child = spawn(file, [...prefixArgs, ...args], { ...options, windowsHide: true });
  child.stdin?.end();
  return child;
}
