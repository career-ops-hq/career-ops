import { spawn } from "node:child_process";
import path from "node:path";
import { CODEX_WINDOWS_LAUNCH_ERROR, prepareCliSpawn } from "./cli-launcher.mjs";

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
 * @param {{platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, findExecutable?: (name: string) => string|null, spawnFn?: typeof spawn}} [runtime]
 * @returns {import("node:child_process").ChildProcessWithoutNullStreams}
 */
export function spawnHeadlessCli(binPath, args, options, runtime = {}) {
  const platform = runtime.platform || process.platform;
  const prepared = prepareCliSpawn(binPath, args, { platform, env: runtime.env || options.env || process.env, findExecutable: runtime.findExecutable });
  const spawnFn = runtime.spawnFn || spawn;
  const child = /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */ (spawnFn(prepared.command, prepared.args, { ...options, ...prepared.options }));
  if (platform === "win32" && path.basename(binPath).toLowerCase().startsWith("codex")) {
    child.prependOnceListener("error", (error) => { error.message = CODEX_WINDOWS_LAUNCH_ERROR; });
  }
  child.stdin?.end();
  return child;
}
